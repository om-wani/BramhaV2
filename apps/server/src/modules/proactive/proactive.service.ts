import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import {
  getDb,
  projects,
  rooms,
  conversationNodes,
  branches,
  searchKnowledge,
} from '@bramha/db';
import { eq, and, gt } from 'drizzle-orm';
import { invokeTurnGraph, type PersistResponseFn } from '@bramha/agents';
import { eventBus } from '@bramha/event-bus';
import { AgentsService } from '../agents/agents.service.js';
import type { PersonaSlug } from '@bramha/shared';

interface OpenLoop {
  roomId: string;
  persona: string;
  text: string;
  nodeId: string;
  createdAt: string;
}

interface ProjectWorkingMemory {
  open_loops: OpenLoop[];
  lastProactiveAt?: string;
}

const SCAN_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24h
const NUDGE_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4h

@Injectable()
export class ProactiveService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProactiveService.name);
  private scanTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(forwardRef(() => AgentsService))
    private readonly agentsService: AgentsService,
  ) {}

  onModuleInit() {
    this.scanTimer = setInterval(() => void this.scan(), SCAN_INTERVAL_MS);
    this.logger.log('PA lite scanner started (30-min interval)');
  }

  onModuleDestroy() {
    if (this.scanTimer) clearInterval(this.scanTimer);
  }

  async scan(): Promise<void> {
    try {
      const db = await getDb();
      const now = Date.now();

      // Load all projects with PA enabled
      const eligibleProjects = await db
        .select({
          id: projects.id,
          name: projects.name,
          orgId: projects.orgId,
          workingMemory: projects.workingMemory,
        })
        .from(projects)
        .where(eq(projects.proactivePaEnabled, true));

      for (const project of eligibleProjects) {
        const wm = (project.workingMemory as ProjectWorkingMemory | null) ?? { open_loops: [] };

        // Rate cap: skip if nudge fired within 4h
        if (wm.lastProactiveAt) {
          const lastAt = new Date(wm.lastProactiveAt).getTime();
          if (now - lastAt < NUDGE_COOLDOWN_MS) continue;
        }

        // Find the first eligible loop
        let firedLoop: OpenLoop | null = null;
        for (const loop of wm.open_loops) {
          const loopAge = now - new Date(loop.createdAt).getTime();
          if (loopAge < STALE_THRESHOLD_MS) continue; // not old enough

          // Check no user node in that room since loop.createdAt
          const usersSince = await db
            .select({ id: conversationNodes.id })
            .from(conversationNodes)
            .where(
              and(
                eq(conversationNodes.roomId, loop.roomId),
                eq(conversationNodes.projectId, project.id),
                eq(conversationNodes.authorType, 'user'),
                gt(conversationNodes.createdAt, new Date(loop.createdAt)),
              ),
            )
            .limit(1);

          if (usersSince.length > 0) continue; // user has been active

          firedLoop = loop;
          break;
        }

        if (!firedLoop) continue;

        // Fire the proactive nudge
        await this.fireNudge(project.id, project.name, firedLoop, wm);
      }
    } catch (err) {
      this.logger.error(`PA lite scan failed: ${String(err)}`);
    }
  }

  private async fireNudge(
    projectId: string,
    projectName: string,
    firedLoop: OpenLoop,
    wm: ProjectWorkingMemory,
  ): Promise<void> {
    try {
      const db = await getDb();

      // Get the room (must be 1:1)
      const [room] = await db
        .select({ id: rooms.id, kind: rooms.kind, boundPersona: rooms.persona })
        .from(rooms)
        .where(and(eq(rooms.id, firedLoop.roomId), eq(rooms.projectId, projectId)));

      if (!room || room.kind !== 'one_on_one') return;

      // Get main branch head
      const [mainBranch] = await db
        .select({ id: branches.id, headNodeId: branches.headNodeId })
        .from(branches)
        .where(and(eq(branches.roomId, firedLoop.roomId), eq(branches.name, 'main')));

      if (!mainBranch || !mainBranch.headNodeId) return;

      const persona = (firedLoop.persona ?? room.boundPersona) as string;
      if (!persona) return;

      const userMessage = `Follow up briefly on: ${firedLoop.text}`;

      const proactivePersistFn: PersistResponseFn = async (persistParams) => {
        const db2 = await getDb();
        const results: Array<{ persona: string; nodeId: string }> = [];

        for (const response of persistParams.responses) {
          const [node] = await db2
            .insert(conversationNodes)
            .values({
              roomId: persistParams.roomId,
              projectId: persistParams.projectId,
              parentId: persistParams.userNodeId,
              authorType: 'agent',
              persona: response.persona,
              content: response.content,
              metadata: { ...(response.metadata as Record<string, unknown>), proactive: true },
            })
            .returning();

          if (!node) throw new Error('proactive node insert failed');
          results.push({ persona: response.persona, nodeId: node.id });

          // Advance branch head (optimistic CAS: only if head hasn't moved)
          const headUpdated = await db2
            .update(branches)
            .set({ headNodeId: node.id })
            .where(
              and(
                eq(branches.id, persistParams.branchId),
                eq(branches.projectId, persistParams.projectId),
                eq(branches.headNodeId, persistParams.userNodeId), // CAS
              ),
            )
            .returning();

          if (headUpdated.length === 0) {
            this.logger.warn(
              `[pa-lite] Branch head conflict on branch ${persistParams.branchId} — concurrent turn moved head`,
            );
          }

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

      await invokeTurnGraph({
        projectId,
        roomId: firedLoop.roomId,
        branchId: mainBranch.id,
        orgName: projectName,
        userNodeId: mainBranch.headNodeId,
        userMessage,
        roomKind: 'one_on_one',
        boundPersona: persona as PersonaSlug,
        recentSpeakers: [],
        domainEmbeddings: this.agentsService.publicDomainEmbeddings,
        isDelegated: true, // prevent delegation from proactive turns
        persistFn: proactivePersistFn,
        searchFn: (pid, embedding, query, k) => searchKnowledge(pid, embedding, query, k),
        emitStreamingFn: (p) =>
          eventBus.emit({
            type: 'node.streaming',
            projectId: p.projectId,
            roomId: p.roomId,
            nodeId: p.nodeId,
            seq: p.seq,
            text: p.text,
          }),
        emitSelectionFn: () => {}, // no selection event for proactive turns
      });

      // Remove fired loop (by nodeId + roomId), update lastProactiveAt
      wm.open_loops = wm.open_loops.filter(
        (l) => !(l.roomId === firedLoop.roomId && l.nodeId === firedLoop.nodeId),
      );
      wm.lastProactiveAt = new Date().toISOString();

      await db.update(projects).set({ workingMemory: wm }).where(eq(projects.id, projectId));
      this.logger.log(`[pa-lite] proactive nudge fired in room ${firedLoop.roomId} from ${persona}`);
    } catch (err) {
      this.logger.error(`[pa-lite] fireNudge failed: ${String(err)}`);
    }
  }
}
