import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';
import {
  getDb,
  conversationNodes,
  branches,
  rooms,
  projectMembers,
  getThreadAncestry,
} from '@bramha/db';
import type { ConversationNodeRow } from '@bramha/db';
import { eventBus } from '@bramha/event-bus';

export interface InsertNodeResult {
  nodeId: string;
  branchId: string;
  forked: boolean;
  newBranchId?: string;
}

export interface BranchRow {
  id: string;
  name: string;
  headNodeId: string | null;
  forkedFromNodeId: string | null;
  createdAt: Date;
}

@Injectable()
export class ConversationService {
  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async requireRoomMembership(
    roomId: string,
    projectId: string,
    callerId: string,
  ): Promise<void> {
    const db = await getDb();

    const [room] = await db
      .select({ id: rooms.id })
      .from(rooms)
      .where(and(eq(rooms.id, roomId), eq(rooms.projectId, projectId)));

    if (!room) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Not found' });
    }

    const [membership] = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, callerId)));

    if (!membership) {
      throw new ForbiddenException({ code: 'FORBIDDEN', title: 'Forbidden' });
    }
  }

  // ---------------------------------------------------------------------------
  // Insert node + advance head (or auto-fork)
  // ---------------------------------------------------------------------------

  async insertNode(
    callerId: string,
    projectId: string,
    roomId: string,
    branchId: string,
    content: string,
    parentNodeId?: string,
  ): Promise<InsertNodeResult> {
    await this.requireRoomMembership(roomId, projectId, callerId);

    const db = await getDb();

    // Verify branch belongs to this room/project
    const [branch] = await db
      .select({ id: branches.id, headNodeId: branches.headNodeId })
      .from(branches)
      .where(
        and(
          eq(branches.id, branchId),
          eq(branches.roomId, roomId),
          eq(branches.projectId, projectId),
        ),
      );

    if (!branch) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Branch not found' });
    }

    // Verify parentNodeId belongs to this room/project
    if (parentNodeId) {
      const [parentNode] = await db
        .select({ id: conversationNodes.id })
        .from(conversationNodes)
        .where(
          and(
            eq(conversationNodes.id, parentNodeId),
            eq(conversationNodes.roomId, roomId),
            eq(conversationNodes.projectId, projectId),
          ),
        );
      if (!parentNode) throw new NotFoundException({ code: 'NOT_FOUND', title: 'Not found' });
    }

    // Optimistic head advance: UPDATE ... WHERE head_node_id = expected
    const expectedHead = branch.headNodeId ?? null;
    const headCondition =
      expectedHead === null
        ? isNull(branches.headNodeId)
        : eq(branches.headNodeId, expectedHead);

    const result = await db.transaction(async (tx) => {
      const [node] = await tx
        .insert(conversationNodes)
        .values({
          roomId,
          projectId,
          parentId: parentNodeId ?? null,
          authorType: 'user',
          userId: callerId,
          content,
        })
        .returning();

      if (!node) throw new Error('insert failed');

      const updateResult = await tx
        .update(branches)
        .set({ headNodeId: node.id })
        .where(and(eq(branches.id, branchId), eq(branches.roomId, roomId), eq(branches.projectId, projectId), headCondition))
        .returning();

      if (updateResult.length > 0) {
        return { nodeId: node.id, branchId, forked: false };
      }

      // Concurrent write detected — auto-fork into a new branch
      const [newBranch] = await tx
        .insert(branches)
        .values({
          roomId,
          projectId,
          name: `fork-${Date.now().toString(36)}`,
          headNodeId: node.id,
          forkedFromNodeId: parentNodeId ?? null,
          createdBy: callerId,
        })
        .returning();

      if (!newBranch) throw new Error('insert failed');
      return { nodeId: node.id, branchId, forked: true, newBranchId: newBranch.id };
    });

    const effectiveBranchId = result.newBranchId ?? result.branchId;
    eventBus.emit({ type: 'node.created', projectId, roomId, nodeId: result.nodeId, branchId: effectiveBranchId });
    if (result.forked && result.newBranchId) {
      eventBus.emit({ type: 'branch.created', projectId, roomId, branchId: result.newBranchId });
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Create named branch from node
  // ---------------------------------------------------------------------------

  async createBranch(
    callerId: string,
    projectId: string,
    roomId: string,
    fromNodeId: string,
    name: string,
  ): Promise<BranchRow> {
    await this.requireRoomMembership(roomId, projectId, callerId);

    const db = await getDb();

    const [sourceNode] = await db
      .select({ id: conversationNodes.id })
      .from(conversationNodes)
      .where(
        and(
          eq(conversationNodes.id, fromNodeId),
          eq(conversationNodes.roomId, roomId),
          eq(conversationNodes.projectId, projectId),
        ),
      );
    if (!sourceNode) throw new NotFoundException({ code: 'NOT_FOUND', title: 'Not found' });

    const [branch] = await db
      .insert(branches)
      .values({
        roomId,
        projectId,
        name,
        headNodeId: fromNodeId,
        forkedFromNodeId: fromNodeId,
        createdBy: callerId,
      })
      .returning();

    if (!branch) throw new Error('insert failed');
    eventBus.emit({ type: 'branch.created', projectId, roomId, branchId: branch.id });
    return {
      id: branch.id,
      name: branch.name,
      headNodeId: branch.headNodeId,
      forkedFromNodeId: branch.forkedFromNodeId,
      createdAt: branch.createdAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Get thread (ancestry walk from branch head)
  // ---------------------------------------------------------------------------

  async getThread(
    callerId: string,
    projectId: string,
    roomId: string,
    branchId: string,
  ): Promise<ConversationNodeRow[]> {
    await this.requireRoomMembership(roomId, projectId, callerId);

    const db = await getDb();

    const [branch] = await db
      .select({ headNodeId: branches.headNodeId })
      .from(branches)
      .where(
        and(
          eq(branches.id, branchId),
          eq(branches.roomId, roomId),
          eq(branches.projectId, projectId),
        ),
      );

    if (!branch) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Branch not found' });
    }

    if (!branch.headNodeId) {
      return [];
    }

    return getThreadAncestry(branch.headNodeId, projectId);
  }

  // ---------------------------------------------------------------------------
  // List branches for a room
  // ---------------------------------------------------------------------------

  async listBranches(
    callerId: string,
    projectId: string,
    roomId: string,
  ): Promise<BranchRow[]> {
    await this.requireRoomMembership(roomId, projectId, callerId);

    const db = await getDb();

    return db
      .select({
        id: branches.id,
        name: branches.name,
        headNodeId: branches.headNodeId,
        forkedFromNodeId: branches.forkedFromNodeId,
        createdAt: branches.createdAt,
      })
      .from(branches)
      .where(and(eq(branches.roomId, roomId), eq(branches.projectId, projectId)));
  }
}
