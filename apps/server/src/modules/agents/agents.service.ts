import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  PERSONAS,
  computeDomainEmbeddings,
  configureModelRouter,
  getModelRouter,
  invokeTurnGraph,
  type AgentResponse,
  type PersistResponseFn,
} from '@bramha/agents';
import { getDb, conversationNodes, branches, delegationTasks, projects, modelCalls, users, searchKnowledge, getThreadAncestry } from '@bramha/db';
import { eq, and, sql } from 'drizzle-orm';
import { eventBus } from '@bramha/event-bus';
import type { ConversationNodeRow } from '@bramha/db';
import type { PersonaSlug } from '@bramha/shared';

export type DelegationMode = 'auto' | 'ask';

export interface ProjectSettings {
  delegationMode?: DelegationMode;
  webSearchEnabled?: boolean;
}

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
    // Wire model_calls logging BEFORE any model call — this was never called
    // previously, so every call went unlogged (usage bar always $0, and the
    // "silent = $0" gate assertion had no data).
    configureModelRouter(async (record) => {
      try {
        const db = await getDb();
        await db.insert(modelCalls).values({
          projectId: record.projectId,
          roomId: record.roomId ?? null,
          userId: record.userId ?? null,
          persona: record.persona ?? null,
          provider: record.provider,
          model: record.model,
          purpose: record.purpose,
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          latencyMs: record.latencyMs,
        });
      } catch {
        // 'system' bootstrap calls have a non-UUID projectId — skip silently;
        // never let logging break the model call path
      }
    });

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

  /**
   * Total tokens (input+output) a user has consumed vs their limit.
   * null limit = unlimited.
   */
  async getUserUsage(userId: string): Promise<{ used: number; limit: number | null; allowed: boolean }> {
    const db = await getDb();
    const [row] = await db
      .select({ used: sql<number>`coalesce(sum(${modelCalls.inputTokens} + ${modelCalls.outputTokens}), 0)::int` })
      .from(modelCalls)
      .where(eq(modelCalls.userId, userId));
    const [u] = await db
      .select({ limit: users.usageTokenLimit })
      .from(users)
      .where(eq(users.id, userId));
    const used = row?.used ?? 0;
    const limit = u?.limit ?? null;
    return { used, limit, allowed: limit === null || used < limit };
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
    userId?: string; // triggering user (undefined for system/proactive)
    thread: ConversationNodeRow[];
  }): Promise<AgentResponse[]> {
    // Usage gate: block the turn if the user is over their token limit.
    if (params.userId) {
      const usage = await this.getUserUsage(params.userId);
      if (!usage.allowed) {
        this.logger.warn(`User ${params.userId} over token limit (${usage.used}/${usage.limit}) — turn blocked`);
        eventBus.emit({
          type: 'node.error',
          projectId: params.projectId,
          roomId: params.roomId,
          nodeId: `usage-${params.userNodeId}`,
          code: 'USAGE_LIMIT_EXCEEDED',
        });
        return [];
      }
    }

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

      // Insert agent nodes as a CHAIN: first is child of userNodeId, each
      // subsequent response is child of the previous one. Chaining keeps every
      // persona's reply inside the head's ancestry — siblings would drop all
      // but the last response from the thread on reload.
      let chainParentId = persistParams.userNodeId;
      for (const response of persistParams.responses) {
        const [node] = await db
          .insert(conversationNodes)
          .values({
            roomId: persistParams.roomId,
            projectId: persistParams.projectId,
            parentId: chainParentId,
            authorType: 'agent',
            persona: response.persona,
            content: response.content,
            metadata: response.metadata,
          })
          .returning();

        if (!node) throw new Error('agent node insert failed');
        results.push({ persona: response.persona, nodeId: node.id });
        chainParentId = node.id;
      }

      // Advance branch head once after all inserts, to the last agent node
      // (tail of the chain). Optimistic: WHERE head_node_id = userNodeId so
      // concurrent turns don't silently overwrite each other's work. If 0 rows
      // updated, another turn already moved the head — log a warning but don't
      // throw (nodes are safe).
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

    // Web search: on if the project has it enabled OR the user prefixed @web.
    // Strip the @web marker before it reaches the model.
    const db0 = await getDb();
    const [proj0] = await db0
      .select({ settings: projects.settings })
      .from(projects)
      .where(eq(projects.id, params.projectId));
    const settings0 = (proj0?.settings as ProjectSettings | null) ?? {};
    const hasWebPrefix = /^\s*@web\b/i.test(params.userMessage);
    const enableWebSearch = settings0.webSearchEnabled === true || hasWebPrefix;
    const graphMessage = hasWebPrefix
      ? params.userMessage.replace(/^\s*@web\b\s*/i, '')
      : params.userMessage;

    const { responses, pendingDelegations } = await invokeTurnGraph({
      projectId: params.projectId,
      roomId: params.roomId,
      branchId: params.branchId,
      orgName: params.orgName,
      userNodeId: params.userNodeId,
      userMessage: graphMessage,
      enableWebSearch,
      roomKind: params.roomKind,
      ...(params.userId !== undefined ? { triggerUserId: params.userId } : {}),
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

    // P5: persist delegation_tasks. Execution depends on the project's
    // delegationMode setting: 'auto' runs immediately, 'ask' (default) waits
    // for explicit user approval via POST .../delegations/:taskId/approve.
    if (pendingDelegations.length > 0) {
      const db = await getDb();

      const [projRow] = await db
        .select({ settings: projects.settings })
        .from(projects)
        .where(eq(projects.id, params.projectId));
      const mode: DelegationMode =
        (projRow?.settings as ProjectSettings | null)?.delegationMode ?? 'ask';

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

        if (!row?.id) continue;

        if (mode === 'ask') {
          // Surface to the user; execution deferred until approval
          eventBus.emit({
            type: 'delegation.pending',
            projectId: params.projectId,
            roomId: params.roomId,
            taskId: row.id,
            fromPersona: delegation.fromSlug,
            toPersona: delegation.toSlug,
            task: delegation.task,
          });
          this.logger.log(
            `Delegation ${delegation.fromSlug}→${delegation.toSlug} awaiting approval (task ${row.id})`,
          );
          continue;
        }

        await this.executeDelegationTask({
          taskId: row.id,
          projectId: params.projectId,
          roomId: params.roomId,
          branchId: params.branchId,
          orgName: params.orgName,
          roomKind: params.roomKind,
          delegatingNodeId,
          fromPersona: delegation.fromSlug,
          toPersona: delegation.toSlug,
          task: delegation.task,
          ...(params.userId !== undefined ? { triggerUserId: params.userId } : {}),
        });
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

  /**
   * Execute one delegation sub-turn. Self-sufficient: rebuilds context from
   * the delegating node's ancestry so it can run immediately (auto mode) or
   * later from the approval endpoint (ask mode).
   * Never throws — failures mark the task 'failed' and the thread continues.
   */
  async executeDelegationTask(params: {
    taskId: string;
    projectId: string;
    roomId: string;
    branchId: string;
    orgName: string;
    roomKind: 'council' | 'one_on_one';
    delegatingNodeId: string;
    fromPersona: PersonaSlug;
    toPersona: PersonaSlug;
    task: string;
    triggerUserId?: string;
  }): Promise<void> {
    const db = await getDb();

    await db
      .update(delegationTasks)
      .set({ status: 'running' })
      .where(eq(delegationTasks.id, params.taskId));

    try {
      // Context: last 10 nodes of the delegating node's ancestry
      const ancestry = await getThreadAncestry(params.delegatingNodeId, params.projectId);
      const contextNodes = ancestry.slice(-10);
      const contextText = contextNodes
        .map((n) => {
          const speaker = n.authorType === 'user' ? 'User' : (n.persona ?? 'Agent');
          return `[${speaker}]: ${n.content}`;
        })
        .join('\n\n');

      const delegatedMessage = contextText
        ? `## Recent conversation\n${contextText}\n\n## Your task\n${params.task}`
        : params.task;

      const recentSpeakers: PersonaSlug[] = ancestry
        .filter((n) => n.authorType === 'agent' && n.persona !== null && n.persona !== undefined)
        .slice(-3)
        .map((n) => n.persona as PersonaSlug);

      // Delegated persistFn: node is a child of the delegating agent node.
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
              parentId: params.delegatingNodeId,
              authorType: 'agent',
              persona: response.persona,
              content: response.content,
              metadata: {
                ...(response.metadata as Record<string, unknown>),
                delegatedFrom: params.fromPersona,
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
        userNodeId: params.delegatingNodeId,
        userMessage: delegatedMessage,
        ...(params.triggerUserId !== undefined ? { triggerUserId: params.triggerUserId } : {}),
        roomKind: params.roomKind,
        boundPersona: params.toPersona,
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
        .where(eq(delegationTasks.id, params.taskId));

      this.logger.log(
        `Delegation ${params.fromPersona}→${params.toPersona} done, nodeId=${resultNodeId ?? 'none'}`,
      );
    } catch (err) {
      // Failure path: mark failed, never rethrow — main turn already succeeded
      this.logger.error(
        `Delegation ${params.fromPersona}→${params.toPersona} failed: ${String(err)}`,
      );
      await db
        .update(delegationTasks)
        .set({ status: 'failed' })
        .where(eq(delegationTasks.id, params.taskId));
    }
  }
}
