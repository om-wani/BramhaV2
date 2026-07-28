/**
 * LangGraph turn graph for the 8-persona AI council.
 *
 * Nodes: select → retrieve → respond → delegate? → finalize
 *
 * Intentionally free of @bramha/db and @bramha/event-bus imports.
 * All DB and event-bus side effects are injected via callbacks.
 */

import { Annotation, StateGraph, START, END, MemorySaver } from '@langchain/langgraph';
import type { PersonaSlug, KnowledgeChunk, ValidatedCitation } from '@bramha/shared';
import { PERSONAS, scorePersonas } from './index.js';
import { getModelRouter } from './model-router.js';
import type { PersonaScore } from './relevance.js';
import type { PersonaConfig } from './personas/index.js';
import { buildSystemPrompt } from './prompt-builder.js';
import { parseCitations, validateCitations } from './citation-parser.js';
import { detectArtifact, stripArtifactBlock } from './artifact-detector.js';
import { webSearch } from './providers/web-search.js';
import { parseDelegationSignal, type PendingDelegation } from './delegation-parser.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type { KnowledgeChunk, ValidatedCitation } from '@bramha/shared';

export interface AgentResponse {
  persona: PersonaSlug;
  nodeId: string; // 'pending' until finalize sets real id
  content: string;
}

/** Injected callback for persisting agent responses to the DB. */
export type PersistResponseFn = (params: {
  projectId: string;
  roomId: string;
  branchId: string;
  userNodeId: string;
  responses: Array<{ persona: string; content: string; metadata: Record<string, unknown> }>;
}) => Promise<Array<{ persona: string; nodeId: string }>>;

/** Injected callback for emitting streaming token events. */
export type EmitStreamingFn = (params: {
  projectId: string;
  roomId: string;
  nodeId: string; // 'pending-${persona}' placeholder
  seq: number;
  text: string;
}) => void;

/** Injected callback for emitting persona selection events. */
export type EmitSelectionFn = (params: {
  projectId: string;
  roomId: string;
  userNodeId: string;
  scores: Array<{ persona: PersonaSlug; score: number; selected: boolean }>;
}) => void;

/** Injected callback for hybrid RAG search — avoids @bramha/db import in this package. */
export type SearchFn = (
  projectId: string,
  embedding: number[],
  query: string,
  k?: number,
) => Promise<KnowledgeChunk[]>;

/** Injected callback for notifying the caller about delegation signals detected in responses. */
export type EmitDelegationFn = (
  roomId: string,
  info: { fromPersona: PersonaSlug; toPersona: PersonaSlug; task: string },
) => void;

// ---------------------------------------------------------------------------
// State annotation
// ---------------------------------------------------------------------------

// NB: all channels use replace-semantics (last-write-wins). This is correct for
// a linear graph with no fan-out — each node replaces the channel wholesale.
const TurnStateAnnotation = Annotation.Root({
  projectId: Annotation<string>(),
  roomId: Annotation<string>(),
  triggerUserId: Annotation<string | undefined>(),
  enableWebSearch: Annotation<boolean | undefined>(),
  branchId: Annotation<string>(),
  orgName: Annotation<string>(),
  userNodeId: Annotation<string>(),
  userMessage: Annotation<string>(),
  messageEmbedding: Annotation<number[]>(),
  selected: Annotation<PersonaScore[]>(),
  chunks: Annotation<KnowledgeChunk[]>(),
  responses: Annotation<AgentResponse[]>(),
  domainEmbeddings: Annotation<Map<string, number[]>>(),
  recentSpeakers: Annotation<PersonaSlug[]>(),
  roomKind: Annotation<'council' | 'one_on_one'>(),
  boundPersona: Annotation<PersonaSlug | undefined>(),
  // P5 delegation sets this to true so respondNode omits the DELEGATE_TO instruction
  isDelegated: Annotation<boolean>(),
  // Injected RAG search callback — avoids @bramha/db import in this package
  searchFn: Annotation<SearchFn>(),
  // P5: delegation signals found in responses; consumed by AgentsService to insert delegation_tasks rows
  pendingDelegations: Annotation<PendingDelegation[]>(),
  // P5: optional callback injected by AgentsService to react to delegation signals during delegateNode
  emitDelegationFn: Annotation<EmitDelegationFn | undefined>(),
});

type TurnState = typeof TurnStateAnnotation.State;

// ---------------------------------------------------------------------------
// Graph factory
// ---------------------------------------------------------------------------

 
export function createTurnGraph(
  persistFn: PersistResponseFn,
  emitStreamingFn: EmitStreamingFn,
  emitSelectionFn: EmitSelectionFn,
) {
  const router = getModelRouter();
  const allPersonas = Object.values(PERSONAS);

  // -------------------------------------------------------------------------
  // select node: embed message, score all 8 personas, emit selection event
  // -------------------------------------------------------------------------
  async function selectNode(state: TurnState): Promise<Partial<TurnState>> {
    const embeddings = await router.embed({
      projectId: state.projectId,
      ...(state.triggerUserId !== undefined ? { userId: state.triggerUserId } : {}),
      inputs: [state.userMessage],
    });

    const messageEmbedding = embeddings[0] ?? [];

    // Build options without boundPersona if it's undefined (exactOptionalPropertyTypes)
    const scoringOptions =
      state.boundPersona !== undefined
        ? {
            threshold: 0.35,
            maxSelected: 4,
            roomKind: state.roomKind,
            boundPersona: state.boundPersona,
          }
        : {
            threshold: 0.35,
            maxSelected: 4,
            roomKind: state.roomKind,
          };

    const scores = scorePersonas(
      {
        messageText: state.userMessage,
        messageEmbedding,
        recentSpeakers: state.recentSpeakers,
      },
      state.domainEmbeddings as Map<PersonaSlug, number[]>,
      allPersonas,
      scoringOptions,
    );

    // Emit ALL 8 scores (not just selected)
    emitSelectionFn({
      projectId: state.projectId,
      roomId: state.roomId,
      userNodeId: state.userNodeId,
      scores: scores.map((s) => ({ persona: s.persona, score: s.score, selected: s.selected })),
    });

    return { messageEmbedding, selected: scores };
  }

  // -------------------------------------------------------------------------
  // retrieve node: hybrid RRF knowledge retrieval (P4.3)
  // Reuses messageEmbedding computed in selectNode — no extra embed call.
  // -------------------------------------------------------------------------
  async function retrieveNode(state: TurnState): Promise<Partial<TurnState>> {
    const docChunks = await state.searchFn(
      state.projectId,
      state.messageEmbedding,
      state.userMessage,
      6,
    );
    // Optional live web results, merged into the same context/citation path.
    // filename = source domain, so agents cite as [Source: domain #n].
    const webChunks = state.enableWebSearch ? await webSearch(state.userMessage, 4) : [];
    return { chunks: [...docChunks, ...webChunks] };
  }

  // -------------------------------------------------------------------------
  // respond node: sequential LLM streaming for each selected persona
  // -------------------------------------------------------------------------
  async function respondNode(state: TurnState): Promise<Partial<TurnState>> {
    const selectedPersonas = state.selected.filter((s) => s.selected);
    const responses: AgentResponse[] = [];

    for (const personaScore of selectedPersonas) {
      const slug = personaScore.persona;
      // eslint-disable-next-line security/detect-object-injection
      const personaConfig = PERSONAS[slug];
      if (personaConfig === undefined) continue;

      const system = buildSystemPrompt({
        persona: personaConfig,
        orgName: state.orgName,
        peers: responses
          .map((r) => PERSONAS[r.persona])
          .filter((p): p is PersonaConfig => p !== undefined),
        chunks: state.chunks,
        isDelegated: state.isDelegated,
      });

      // Build messages: earlier peer responses this turn as assistant messages + user message
      const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

      for (const prevResponse of responses) {
         
        const prevConfig = PERSONAS[prevResponse.persona];
        const speakerLabel =
          prevConfig !== undefined
            ? `${prevConfig.name} (${prevConfig.title})`
            : prevResponse.persona;
        messages.push({
          role: 'assistant',
          content: `[${speakerLabel}]: ${prevResponse.content}`,
        });
      }

      messages.push({ role: 'user', content: state.userMessage });

      let fullContent = '';
      let seq = 0;

      const stream = router.stream({
        projectId: state.projectId,
        roomId: state.roomId,
        ...(state.triggerUserId !== undefined ? { userId: state.triggerUserId } : {}),
        persona: slug,
        // Delegated executor turns run on the light/fast model tier
        purpose: state.isDelegated ? 'delegation' : 'turn',
        messages,
        system,
      });

      for await (const chunk of stream) {
        emitStreamingFn({
          projectId: state.projectId,
          roomId: state.roomId,
          nodeId: `pending-${slug}`,
          seq,
          text: chunk,
        });
        seq += 1;
        fullContent += chunk;
      }

      responses.push({ persona: slug, nodeId: 'pending', content: fullContent });
    }

    return { responses };
  }

  // -------------------------------------------------------------------------
  // delegate? node: detect DELEGATE_TO signals, strip from content, emit
  // Single-hop enforcement: if state.isDelegated === true, skip (already in
  // a delegated sub-graph, so further delegation is suppressed).
  // -------------------------------------------------------------------------
  function delegateNode(state: TurnState): Partial<TurnState> {
    // Single-hop guard: delegated prompts cannot themselves delegate
    if (state.isDelegated) return {};

    const found: Array<{
      responseIndex: number;
      fromSlug: PersonaSlug;
      toSlug: PersonaSlug;
      task: string;
      strippedContent: string;
    }> = [];

    for (let i = 0; i < state.responses.length; i++) {
      const response = state.responses[i];
      if (!response) continue;
      const result = parseDelegationSignal(response.content);
      if (result) {
        found.push({
          responseIndex: i,
          fromSlug: response.persona,
          toSlug: result.signal.toSlug,
          task: result.signal.task,
          strippedContent: result.strippedContent,
        });
      }
    }

    if (found.length === 0) return {};

    // Strip delegation signal lines from response content
    const updatedResponses = state.responses.map((r, i) => {
      const d = found.find((f) => f.responseIndex === i);
      if (!d) return r;
      return { ...r, content: d.strippedContent };
    });

    // Notify via injected callback (if provided)
    if (state.emitDelegationFn !== undefined) {
      for (const d of found) {
        state.emitDelegationFn(state.roomId, {
          fromPersona: d.fromSlug,
          toPersona: d.toSlug,
          task: d.task,
        });
      }
    }

    const pendingDelegations: PendingDelegation[] = found.map((d) => ({
      fromSlug: d.fromSlug,
      toSlug: d.toSlug,
      task: d.task,
    }));

    return {
      responses: updatedResponses,
      pendingDelegations,
    };
  }

  // -------------------------------------------------------------------------
  // finalize node: persist to DB, set real nodeIds
  // -------------------------------------------------------------------------
  async function finalizeNode(state: TurnState): Promise<Partial<TurnState>> {
    // Build per-response citations and metadata before persisting
    const responsesWithMeta = state.responses.map((r) => {
      const parsed = parseCitations(r.content);
      const citations: ValidatedCitation[] = validateCitations(parsed, state.chunks);
      const artifact = detectArtifact(r.content);
      const metadata: Record<string, unknown> = {
        ...(citations.length > 0 ? { citations } : {}),
        ...(artifact !== null ? { artifact } : {}),
      };
      // Artifact renders as its own card — strip the raw block from the prose
      const content = artifact !== null ? stripArtifactBlock(r.content) : r.content;
      return { persona: r.persona, content, metadata };
    });

    const persistResults = await persistFn({
      projectId: state.projectId,
      roomId: state.roomId,
      branchId: state.branchId,
      userNodeId: state.userNodeId,
      responses: responsesWithMeta,
    });

    // Guard: persistFn must return one result per response
    if (persistResults.length !== state.responses.length) {
      throw new Error(
        `finalize: persistFn returned ${persistResults.length} results for ${state.responses.length} responses — partial persist detected, aborting`,
      );
    }

    // Map persisted nodeIds back into responses
    const updatedResponses: AgentResponse[] = state.responses.map((r) => {
      const persisted = persistResults.find((p) => p.persona === r.persona);
      return {
        persona: r.persona,
        nodeId: persisted?.nodeId ?? 'unknown',
        content: r.content,
      };
    });

    return { responses: updatedResponses };
  }

  // -------------------------------------------------------------------------
  // Build the graph
  // -------------------------------------------------------------------------
  const builder = new StateGraph(TurnStateAnnotation)
    .addNode('select', selectNode)
    .addNode('retrieve', retrieveNode)
    .addNode('respond', respondNode)
    .addNode('delegate', delegateNode)
    .addNode('finalize', finalizeNode)
    .addEdge(START, 'select')
    .addEdge('select', 'retrieve')
    .addEdge('retrieve', 'respond')
    .addEdge('respond', 'delegate')
    .addEdge('delegate', 'finalize')
    .addEdge('finalize', END);

  return builder.compile({ checkpointer: new MemorySaver() });
}

// ---------------------------------------------------------------------------
// Public invocation API
// ---------------------------------------------------------------------------

export interface TurnGraphParams {
  triggerUserId?: string;
  enableWebSearch?: boolean;
  projectId: string;
  roomId: string;
  branchId: string;
  orgName: string;
  userNodeId: string;
  userMessage: string;
  roomKind: 'council' | 'one_on_one';
  boundPersona?: PersonaSlug;
  recentSpeakers: PersonaSlug[];
  domainEmbeddings: Map<string, number[]>;
  isDelegated?: boolean;
  persistFn: PersistResponseFn;
  emitStreamingFn: EmitStreamingFn;
  emitSelectionFn: EmitSelectionFn;
  emitDelegationFn?: EmitDelegationFn;
  searchFn: SearchFn;
}

export interface TurnGraphResult {
  responses: AgentResponse[];
  pendingDelegations: PendingDelegation[];
}

export async function invokeTurnGraph(params: TurnGraphParams): Promise<TurnGraphResult> {
  const graph = createTurnGraph(params.persistFn, params.emitStreamingFn, params.emitSelectionFn);
  const threadId = `${params.roomId}:${params.branchId}`;

  const initialState: Record<string, unknown> = {
    projectId: params.projectId,
    roomId: params.roomId,
    branchId: params.branchId,
    orgName: params.orgName,
    userNodeId: params.userNodeId,
    ...(params.triggerUserId !== undefined ? { triggerUserId: params.triggerUserId } : {}),
    ...(params.enableWebSearch !== undefined ? { enableWebSearch: params.enableWebSearch } : {}),
    userMessage: params.userMessage,
    messageEmbedding: [],
    selected: [],
    chunks: [],
    responses: [],
    domainEmbeddings: params.domainEmbeddings,
    recentSpeakers: params.recentSpeakers,
    roomKind: params.roomKind,
    isDelegated: params.isDelegated ?? false,
    searchFn: params.searchFn,
    pendingDelegations: [],
  };

  if (params.boundPersona !== undefined) {
    initialState['boundPersona'] = params.boundPersona;
  }

  if (params.emitDelegationFn !== undefined) {
    initialState['emitDelegationFn'] = params.emitDelegationFn;
  }


  const result = await graph.invoke(initialState, { configurable: { thread_id: threadId } });

  return {
    responses: result.responses as AgentResponse[],
    pendingDelegations: (result.pendingDelegations ?? []) as PendingDelegation[],
  };
}
