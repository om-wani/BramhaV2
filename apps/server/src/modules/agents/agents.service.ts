import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  PERSONAS,
  computeDomainEmbeddings,
  getModelRouter,
  invokeTurnGraph,
  type AgentResponse,
  type PersistResponseFn,
} from '@bramha/agents';
import { getDb, conversationNodes, branches, delegationTasks, searchKnowledge } from '@bramha/db';
import { eq, and } from 'drizzle-orm';
import { eventBus } from '@bramha/event-bus';
import type { ConversationNodeRow } from '@bramha/db';
import type { PersonaSlug } from '@bramha/shared';

@Injectable()
export class AgentsService implements OnModuleInit {
  private readonly logger = new Logger(AgentsService.name);
  private domainEmbeddings: Map<string, number[]> = new Map();

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
    });

    // Insert delegation_tasks rows for each detected signal (P5.1 lifecycle).
    // P5.2 will pick these up and execute the sub-graph.
    if (pendingDelegations.length > 0) {
      const db = await getDb();
      for (const delegation of pendingDelegations) {
        await db.insert(delegationTasks).values({
          roomId: params.roomId,
          projectId: params.projectId,
          sourceNodeId: params.userNodeId,
          fromPersona: delegation.fromSlug,
          toPersona: delegation.toSlug,
          task: delegation.task,
          status: 'pending',
        });
      }
      this.logger.log(
        `Inserted ${pendingDelegations.length} delegation_tasks row(s) for room ${params.roomId}`,
      );
    }

    return responses;
  }
}
