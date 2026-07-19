import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { getDb, projects, projectMembers, orgs, orgMembers, users } from '@bramha/db';

@Injectable()
export class ProjectsService {
  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------

  async createProject(
    callerId: string,
    orgId: string,
    name: string,
  ): Promise<{ id: string; orgId: string; name: string; createdAt: Date }> {
    const db = await getDb();

    // Verify org exists
    const [org] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.id, orgId));
    if (!org) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Not found' });
    }

    // Caller must be org member
    const [membership] = await db
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, callerId)));

    if (!membership) {
      throw new ForbiddenException({ code: 'FORBIDDEN', title: 'Forbidden' });
    }

    const slug =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'project';
    const uniqueSlug = `${slug}-${Date.now().toString(36)}`;

    return await db.transaction(async (tx) => {
      const [project] = await tx
        .insert(projects)
        .values({ orgId, name, slug: uniqueSlug })
        .returning();

      if (!project) throw new Error('insert failed');
      await tx.insert(projectMembers).values({ projectId: project.id, userId: callerId, role: 'admin' });

      return { id: project.id, orgId: project.orgId, name: project.name, createdAt: project.createdAt };
    });
  }

  async listProjects(
    callerId: string,
    orgId: string,
  ): Promise<Array<{ id: string; name: string; createdAt: Date }>> {
    const db = await getDb();

    // Verify org exists
    const [org] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.id, orgId));
    if (!org) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Not found' });
    }

    // Caller must be org member
    const [membership] = await db
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, callerId)));

    if (!membership) {
      throw new ForbiddenException({ code: 'FORBIDDEN', title: 'Forbidden' });
    }

    const rows = await db
      .select({ id: projects.id, name: projects.name, createdAt: projects.createdAt })
      .from(projects)
      .where(eq(projects.orgId, orgId));

    return rows;
  }

  async getProject(
    callerId: string,
    projectId: string,
  ): Promise<{ id: string; orgId: string; name: string; createdAt: Date }> {
    const db = await getDb();

    // Verify project exists
    const [project] = await db
      .select({ id: projects.id, orgId: projects.orgId, name: projects.name, createdAt: projects.createdAt })
      .from(projects)
      .where(eq(projects.id, projectId));

    if (!project) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Not found' });
    }

    // Caller must be project member
    const [membership] = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, callerId)));

    if (!membership) {
      throw new ForbiddenException({ code: 'FORBIDDEN', title: 'Forbidden' });
    }

    return project;
  }

  // ---------------------------------------------------------------------------
  // Members
  // ---------------------------------------------------------------------------

  async addMember(
    callerId: string,
    projectId: string,
    targetUserId: string,
    role: 'admin' | 'member',
  ): Promise<{ projectId: string; userId: string; role: string }> {
    const db = await getDb();

    // Verify project exists
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId));

    if (!project) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Not found' });
    }

    // Caller must be admin
    await this.requireAdmin(callerId, projectId);

    // Verify target user exists
    const [targetUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, targetUserId));

    if (!targetUser) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Not found' });
    }

    // Check if already a member
    const [existing] = await db
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, targetUserId)));

    if (existing) {
      throw new ConflictException({ code: 'CONFLICT', title: 'Already a member' });
    }

    await db.insert(projectMembers).values({ projectId, userId: targetUserId, role });

    return { projectId, userId: targetUserId, role };
  }

  async removeMember(callerId: string, projectId: string, targetUserId: string): Promise<void> {
    const db = await getDb();

    // Verify project exists
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId));

    if (!project) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Not found' });
    }

    // Caller must be admin
    await this.requireAdmin(callerId, projectId);

    // Admins cannot remove themselves
    if (callerId === targetUserId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', title: 'Forbidden' });
    }

    // Verify target is actually a member
    const [existing] = await db
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, targetUserId)));

    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Not found' });
    }

    await db
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, targetUserId)));
  }

  // ---------------------------------------------------------------------------
  // Guard helper
  // ---------------------------------------------------------------------------

  async getMemberRole(projectId: string, userId: string): Promise<string | null> {
    const db = await getDb();
    const [membership] = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    return membership?.role ?? null;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async requireAdmin(callerId: string, projectId: string): Promise<void> {
    const db = await getDb();
    const [membership] = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, callerId)));

    if (!membership || membership.role !== 'admin') {
      throw new ForbiddenException({ code: 'FORBIDDEN', title: 'Forbidden' });
    }
  }
}
