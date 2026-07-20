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
import { detectArtifact } from './artifact-detector.js';

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

// ---------------------------------------------------------------------------
// State annotation
// ---------------------------------------------------------------------------

// NB: all channels use replace-semantics (last-write-wins). This is correct for
// a linear graph with no fan-out — each node replaces the channel wholesale.
const TurnStateAnnotation = Annotation.Root({
  projectId: Annotation<string>(),
  roomId: Annotation<string>(),
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
    const chunks = await state.searchFn(
      state.projectId,
      state.messageEmbedding,
      state.userMessage,
      6,
    );
    return { chunks };
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
        persona: slug,
        messages,
        system,
        maxTokens: 700,
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
  // delegate? node: stub — real impl in P5 (returns {} = no state change)
  // -------------------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function delegateNode(_state: TurnState): Partial<TurnState> {
    return {};
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
      return { persona: r.persona, content: r.content, metadata };
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
  persistFn: PersistResponseFn;
  emitStreamingFn: EmitStreamingFn;
  emitSelectionFn: EmitSelectionFn;
  searchFn: SearchFn;
}

export async function invokeTurnGraph(params: TurnGraphParams): Promise<AgentResponse[]> {
  const graph = createTurnGraph(params.persistFn, params.emitStreamingFn, params.emitSelectionFn);
  const threadId = `${params.roomId}:${params.branchId}`;

  const initialState: Record<string, unknown> = {
    projectId: params.projectId,
    roomId: params.roomId,
    branchId: params.branchId,
    orgName: params.orgName,
    userNodeId: params.userNodeId,
    userMessage: params.userMessage,
    messageEmbedding: [],
    selected: [],
    chunks: [],
    responses: [],
    domainEmbeddings: params.domainEmbeddings,
    recentSpeakers: params.recentSpeakers,
    roomKind: params.roomKind,
    isDelegated: false, // P5 sub-graph will pass true for delegated prompts
    searchFn: params.searchFn,
  };

  if (params.boundPersona !== undefined) {
    initialState['boundPersona'] = params.boundPersona;
  }

   
  const result = await graph.invoke(initialState, { configurable: { thread_id: threadId } });

   
  return result.responses as AgentResponse[];
}
