import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { getDb, rooms, branches, projects, projectMembers } from '@bramha/db';

export interface RoomRow {
  id: string;
  projectId: string;
  name: string;
  kind: string;
  persona: string | null;
  mainBranchId: string | null;
  createdAt: Date;
}

@Injectable()
export class RoomsService {
  async createRoom(
    callerId: string,
    projectId: string,
    name: string,
    kind: 'council' | 'one_on_one',
    persona?: string,
  ): Promise<RoomRow> {
    const db = await getDb();

    // Verify project exists
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId));

    if (!project) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Not found' });
    }

    // Verify caller is project member
    const [membership] = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, callerId)));

    if (!membership) {
      throw new ForbiddenException({ code: 'FORBIDDEN', title: 'Forbidden' });
    }

    return await db.transaction(async (tx) => {
      // 1. Insert room (main_branch_id initially null — circular reference)
      const [room] = await tx
        .insert(rooms)
        .values({ projectId, name, kind, persona: persona ?? null })
        .returning({
          id: rooms.id,
          projectId: rooms.projectId,
          name: rooms.name,
          kind: rooms.kind,
          persona: rooms.persona,
          createdAt: rooms.createdAt,
        });

      // 2. Insert "main" branch
      const [branch] = await tx
        .insert(branches)
        .values({ roomId: room.id, projectId, name: 'main', createdBy: callerId })
        .returning({ id: branches.id });

      // 3. Update room.main_branch_id
      await tx.update(rooms).set({ mainBranchId: branch.id }).where(eq(rooms.id, room.id));

      return { ...room, mainBranchId: branch.id };
    });
  }

  async listRooms(
    callerId: string,
    projectId: string,
  ): Promise<RoomRow[]> {
    const db = await getDb();

    // ProjectMemberGuard already verified project existence and membership — query directly.
    return db
      .select({
        id: rooms.id,
        projectId: rooms.projectId,
        name: rooms.name,
        kind: rooms.kind,
        persona: rooms.persona,
        mainBranchId: rooms.mainBranchId,
        createdAt: rooms.createdAt,
      })
      .from(rooms)
      .where(eq(rooms.projectId, projectId));
  }

  async getRoomForProject(roomId: string, projectId: string): Promise<RoomRow | null> {
    const db = await getDb();
    const [room] = await db
      .select({
        id: rooms.id,
        projectId: rooms.projectId,
        name: rooms.name,
        kind: rooms.kind,
        persona: rooms.persona,
        mainBranchId: rooms.mainBranchId,
        createdAt: rooms.createdAt,
      })
      .from(rooms)
      .where(and(eq(rooms.id, roomId), eq(rooms.projectId, projectId)));
    return room ?? null;
  }
}
