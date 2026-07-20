import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  PERSONAS,
  computeDomainEmbeddings,
  getModelRouter,
  invokeTurnGraph,
  type AgentResponse,
  type PersistResponseFn,
  type PendingDelegation,
} from '@bramha/agents';
import { getDb, conversationNodes, branches, delegationTasks, projects, searchKnowledge } from '@bramha/db';
import { eq, and } from 'drizzle-orm';
import { eventBus } from '@bramha/event-bus';
import type { ConversationNodeRow } from '@bramha/db';
import type { PersonaSlug } from '@bramha/shared';

// PA lite types
export interface OpenLoop {
  roomId: string;
  persona: string;
  text: string;
  nodeId: string;
  createdAt: string;
}

export interface ProjectWorkingMemory {
  open_loops: OpenLoop[];
  lastProactiveAt?: string;
}

@Injectable()
export class AgentsService implements OnModuleInit {
  private readonly logger = new Logger(AgentsService.name);
  private domainEmbeddings: Map<string, number[]> = new Map();

  get publicDomainEmbeddings(): Map<string, number[]> {
    return this.domainEmbeddings;
  }

  async onModuleInit(): Promise<void> {
    try {
      const router = getModelRouter();
      const allPersonas = Object.values(PERSONAS);
      this.domainEmbeddings = await computeDomainEmbeddings(allPersonas, router, 'system');
      this.logger.log('Domain embeddings computed for all personas');
    } catch (err) {
      // Don't crash server if embeddings fail (e.g. no API key in dev)
      this.logger.warn(`Domain embeddings skipped: ${String(err)}`);
    }
  }

  async triggerAgentTurn(params: {
    projectId: string;
    roomId: string;
    branchId: string;
    orgName: string;
    userNodeId: string;
    userMessage: string;
    roomKind: 'council' | 'one_on_one';
    boundPersona?: PersonaSlug;
    thread: ConversationNodeRow[];
  }): Promise<AgentResponse[]> {
    // Warn if domain embeddings were never computed (e.g. no API key in dev).
    // Scoring will degrade to lexical-only (all expertise scores = 0).
    if (this.domainEmbeddings.size === 0) {
      this.logger.warn('Domain embeddings not available — relevance scoring is lexical-only');
    }

    // Extract last 3 agent persona slugs from thread history.
    // getThreadAncestry() returns nodes oldest-to-newest; slice(-3) gives the 3 most recent.
    const recentSpeakers: PersonaSlug[] = params.thread
      .filter((n) => n.authorType === 'agent' && n.persona !== null && n.persona !== undefined)
      .slice(-3)
      .map((n) => n.persona as PersonaSlug);

    const persistFn: PersistResponseFn = async (persistParams) => {
      const db = await getDb();
      const results: Array<{ persona: string; nodeId: string }> = [];

      // Insert all agent nodes (all are children of userNodeId)
      for (const response of persistParams.responses) {
        const [node] = await db
          .insert(conversationNodes)
          .values({
            roomId: persistParams.roomId,
            projectId: persistParams.projectId,
            parentId: persistParams.userNodeId,
            authorType: 'agent',
            persona: response.persona,
            content: response.content,
            metadata: response.metadata,
          })
          .returning();

        if (!node) throw new Error('agent node insert failed');
        results.push({ persona: response.persona, nodeId: node.id });
      }

      // Advance branch head once after all inserts, to the last agent node.
      // Multi-persona turns produce sibling nodes (all children of userNodeId).
      // The head pointer moves to the last inserted sibling — this is an MVP
      // simplification; P5 delegation will need to handle the sibling case explicitly.
      // Optimistic: WHERE head_node_id = userNodeId so concurrent turns don't
      // silently overwrite each other's work. If 0 rows updated, another turn
      // already moved the head — log a warning but don't throw (nodes are safe).
      const lastNodeId = results[results.length - 1]?.nodeId;
      if (lastNodeId !== undefined) {
        const headUpdated = await db
          .update(branches)
          .set({ headNodeId: lastNodeId })
          .where(
            and(
              eq(branches.id, persistParams.branchId),
              eq(branches.projectId, persistParams.projectId),
              eq(branches.headNodeId, persistParams.userNodeId),
            ),
          )
          .returning();

        if (headUpdated.length === 0) {
          this.logger.warn(
            `Branch head advance conflict on branch ${persistParams.branchId} — another turn moved the head concurrently`,
          );
        }
      }

      // Emit node.created for each persisted agent node
      for (const r of results) {
        eventBus.emit({
          type: 'node.created',
          projectId: persistParams.projectId,
          roomId: persistParams.roomId,
          nodeId: r.nodeId,
          branchId: persistParams.branchId,
        });
      }

      return results;
    };

    const { responses, pendingDelegations } = await invokeTurnGraph({
      projectId: params.projectId,
      roomId: params.roomId,
      branchId: params.branchId,
      orgName: params.orgName,
      userNodeId: params.userNodeId,
      userMessage: params.userMessage,
      roomKind: params.roomKind,
      ...(params.boundPersona !== undefined ? { boundPersona: params.boundPersona } : {}),
      recentSpeakers,
      domainEmbeddings: this.domainEmbeddings,
      persistFn,
      searchFn: (projectId, embedding, query, k) =>
        searchKnowledge(projectId, embedding, query, k),
      emitStreamingFn: (streamParams) => {
        eventBus.emit({
          type: 'node.streaming',
          projectId: streamParams.projectId,
          roomId: streamParams.roomId,
          nodeId: streamParams.nodeId,
          seq: streamParams.seq,
          text: streamParams.text,
        });
      },
      emitSelectionFn: (selectionParams) => {
        eventBus.emit({
          type: 'turn.selection',
          projectId: selectionParams.projectId,
          roomId: selectionParams.roomId,
          userNodeId: selectionParams.userNodeId,
          scores: selectionParams.scores,
        });
      },
      emitDelegationFn: (roomId, info) => {
        this.logger.debug(
          `[delegation] room=${roomId} from=${info.fromPersona} to=${info.toPersona} task="${info.task}"`,
        );
      },
    });

    // P5.2: insert delegation_tasks rows with .returning() to get IDs for status updates,
    // then execute each delegation as a sub-turn-graph.
    if (pendingDelegations.length > 0) {
      const db = await getDb();

      const insertedRows: Array<{
        id: string;
        delegatingNodeId: string;
        delegation: PendingDelegation;
      }> = [];

      for (const delegation of pendingDelegations) {
        // Use the delegating agent's actual nodeId (not the user node)
        const delegatingNodeId =
          responses.find((r) => r.persona === delegation.fromSlug)?.nodeId ?? params.userNodeId;

        const [row] = await db
          .insert(delegationTasks)
          .values({
            roomId: params.roomId,
            projectId: params.projectId,
            sourceNodeId: delegatingNodeId,
            fromPersona: delegation.fromSlug,
            toPersona: delegation.toSlug,
            task: delegation.task,
            status: 'pending',
          })
          .returning();

        if (row?.id) {
          insertedRows.push({ id: row.id, delegatingNodeId, delegation });
        }
      }

      this.logger.log(
        `Inserted ${insertedRows.length} delegation_tasks row(s) for room ${params.roomId}`,
      );

      // Execute each delegation as a sub-turn-graph
      for (const { id: taskId, delegatingNodeId, delegation } of insertedRows) {
        // Mark running
        await db
          .update(delegationTasks)
          .set({ status: 'running' })
          .where(eq(delegationTasks.id, taskId));

        try {
          // Build context string from last 10 thread nodes
          const contextNodes = params.thread.slice(-10);
          const contextText = contextNodes
            .map((n) => {
              const speaker =
                n.authorType === 'user' ? 'User' : (n.persona ?? 'Agent');
              return `[${speaker}]: ${n.content}`;
            })
            .join('\n\n');

          const delegatedMessage = contextText
            ? `## Recent conversation\n${contextText}\n\n## Your task\n${delegation.task}`
            : delegation.task;

          // Delegated persistFn: inserts node as child of the delegating agent node.
          // No branch head advance — delegated node is a side-branch in the DAG.
          const delegatedPersistFn: PersistResponseFn = async (persistParams) => {
            const db2 = await getDb();
            const results: Array<{ persona: string; nodeId: string }> = [];

            for (const response of persistParams.responses) {
              const [node] = await db2
                .insert(conversationNodes)
                .values({
                  roomId: persistParams.roomId,
                  projectId: persistParams.projectId,
                  parentId: delegatingNodeId,
                  authorType: 'agent',
                  persona: response.persona,
                  content: response.content,
                  metadata: {
                    ...(response.metadata as Record<string, unknown>),
                    delegatedFrom: delegation.fromSlug,
                  },
                })
                .returning();

              if (!node) throw new Error('delegated node insert failed');
              results.push({ persona: response.persona, nodeId: node.id });

              eventBus.emit({
                type: 'node.created',
                projectId: persistParams.projectId,
                roomId: persistParams.roomId,
                nodeId: node.id,
                branchId: persistParams.branchId,
              });
            }

            return results;
          };

          const subResult = await invokeTurnGraph({
            projectId: params.projectId,
            roomId: params.roomId,
            branchId: params.branchId,
            orgName: params.orgName,
            userNodeId: delegatingNodeId,
            userMessage: delegatedMessage,
            roomKind: params.roomKind,
            boundPersona: delegation.toSlug,
            recentSpeakers,
            domainEmbeddings: this.domainEmbeddings,
            isDelegated: true,
            persistFn: delegatedPersistFn,
            searchFn: (projectId, embedding, query, k) =>
              searchKnowledge(projectId, embedding, query, k),
            emitStreamingFn: (streamParams) => {
              eventBus.emit({
                type: 'node.streaming',
                projectId: streamParams.projectId,
                roomId: streamParams.roomId,
                nodeId: streamParams.nodeId,
                seq: streamParams.seq,
                text: streamParams.text,
              });
            },
            emitSelectionFn: (selectionParams) => {
              eventBus.emit({
                type: 'turn.selection',
                projectId: selectionParams.projectId,
                roomId: selectionParams.roomId,
                userNodeId: selectionParams.userNodeId,
                scores: selectionParams.scores,
              });
            },
          });

          const resultNodeId = subResult.responses[0]?.nodeId;

          await db
            .update(delegationTasks)
            .set({ status: 'done', ...(resultNodeId !== undefined ? { resultNodeId } : {}) })
            .where(eq(delegationTasks.id, taskId));

          this.logger.log(
            `Delegation ${delegation.fromSlug}→${delegation.toSlug} done, nodeId=${resultNodeId ?? 'none'}`,
          );
        } catch (err) {
          // Failure path: mark failed, never rethrow — main turn already succeeded
          this.logger.error(
            `Delegation ${delegation.fromSlug}→${delegation.toSlug} failed: ${String(err)}`,
          );
          await db
            .update(delegationTasks)
            .set({ status: 'failed' })
            .where(eq(delegationTasks.id, taskId));
        }
      }
    }

    // PA lite capture — only in 1:1 rooms
    if (params.roomKind === 'one_on_one' && responses.length > 0) {
      const OPEN_LOOP_RE = /\?$|I'll follow up|next step|let me know/im;
      for (const response of responses) {
        const lines = response.content.split('\n');
        const matchedLine = lines.find((l) => OPEN_LOOP_RE.test(l));
        if (!matchedLine) continue;

        const db2 = await getDb();
        const [projectRow] = await db2
          .select({ workingMemory: projects.workingMemory })
          .from(projects)
          .where(eq(projects.id, params.projectId));

        const wm = (projectRow?.workingMemory as ProjectWorkingMemory | null) ?? { open_loops: [] };
        const newLoop: OpenLoop = {
          roomId: params.roomId,
          persona: response.persona,
          text: matchedLine.trim(),
          nodeId: response.nodeId,
          createdAt: new Date().toISOString(),
        };
        // FIFO — keep most recent 10
        wm.open_loops = [...wm.open_loops.slice(-9), newLoop];

        await db2.update(projects).set({ workingMemory: wm }).where(eq(projects.id, params.projectId));
        this.logger.debug(`[pa-lite] captured open loop in room ${params.roomId} from ${response.persona}`);
        break; // one capture per turn
      }
    }

    return responses;
  }
}
