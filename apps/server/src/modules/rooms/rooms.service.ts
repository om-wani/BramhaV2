import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { getDb, rooms, branches, projects, projectMembers } from '@bramha/db';

export interface RoomRow {
  id: string;
  projectId: string;
  name: string;
  kind: string;
  persona: string | null;
  personas: string[];
  mainBranchId: string | null;
  createdAt: Date;
}

const ROOM_COLUMNS = {
  id: rooms.id,
  projectId: rooms.projectId,
  name: rooms.name,
  kind: rooms.kind,
  persona: rooms.persona,
  personas: rooms.personas,
  mainBranchId: rooms.mainBranchId,
  createdAt: rooms.createdAt,
} as const;

function normalizePersonas(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

@Injectable()
export class RoomsService {
  // Creates a custom room with an explicit set of agents. The council
  // conference room is auto-seeded per project and never created here.
  async createRoom(
    callerId: string,
    projectId: string,
    name: string,
    personas: string[],
  ): Promise<RoomRow> {
    const db = await getDb();

    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!project) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Not found' });
    }

    const [membership] = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, callerId)));
    if (!membership) {
      throw new ForbiddenException({ code: 'FORBIDDEN', title: 'Forbidden' });
    }

    return await db.transaction(async (tx) => {
      const [room] = await tx
        .insert(rooms)
        .values({ projectId, name, kind: 'custom', persona: null, personas })
        .returning();
      if (!room) throw new Error('insert failed');

      const [branch] = await tx
        .insert(branches)
        .values({ roomId: room.id, projectId, name: 'main', createdBy: callerId })
        .returning();
      if (!branch) throw new Error('insert failed');

      await tx.update(rooms).set({ mainBranchId: branch.id }).where(eq(rooms.id, room.id));

      return {
        id: room.id,
        projectId: room.projectId,
        name: room.name,
        kind: room.kind,
        persona: room.persona,
        personas: normalizePersonas(room.personas),
        mainBranchId: branch.id,
        createdAt: room.createdAt,
      };
    });
  }

  // Deletes a custom room (cascades branches/nodes via FK). The council
  // conference room cannot be deleted.
  async deleteRoom(callerId: string, projectId: string, roomId: string): Promise<void> {
    const db = await getDb();

    const [membership] = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, callerId)));
    if (!membership) {
      throw new ForbiddenException({ code: 'FORBIDDEN', title: 'Forbidden' });
    }

    const [room] = await db
      .select({ id: rooms.id, kind: rooms.kind })
      .from(rooms)
      .where(and(eq(rooms.id, roomId), eq(rooms.projectId, projectId)));
    if (!room) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Not found' });
    }
    if (room.kind === 'council') {
      throw new ForbiddenException({
        code: 'COUNCIL_UNDELETABLE',
        title: 'The council room cannot be deleted',
      });
    }

    await db.delete(rooms).where(and(eq(rooms.id, roomId), eq(rooms.projectId, projectId)));
  }

  async listRooms(callerId: string, projectId: string): Promise<RoomRow[]> {
    const db = await getDb();
    const rows = await db.select(ROOM_COLUMNS).from(rooms).where(eq(rooms.projectId, projectId));
    return rows.map((r) => ({ ...r, personas: normalizePersonas(r.personas) }));
  }

  async getRoomForProject(roomId: string, projectId: string): Promise<RoomRow | null> {
    const db = await getDb();
    const [room] = await db
      .select(ROOM_COLUMNS)
      .from(rooms)
      .where(and(eq(rooms.id, roomId), eq(rooms.projectId, projectId)));
    return room ? { ...room, personas: normalizePersonas(room.personas) } : null;
  }
}
