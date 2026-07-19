import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { getDb, orgs, orgMembers, users } from '@bramha/db';

@Injectable()
export class OrgsService {
  // ---------------------------------------------------------------------------
  // Orgs
  // ---------------------------------------------------------------------------

  async createOrg(
    userId: string,
    name: string,
  ): Promise<{ id: string; name: string; createdAt: Date }> {
    const db = await getDb();
    const slug = this.toSlug(name) + '-' + Date.now().toString(36);

    const [org] = await db
      .insert(orgs)
      .values({ name, slug, createdBy: userId })
      .returning({ id: orgs.id, name: orgs.name, createdAt: orgs.createdAt });

    await db.insert(orgMembers).values({ orgId: org.id, userId, role: 'owner' });

    return org;
  }

  async listOrgsForUser(
    userId: string,
  ): Promise<Array<{ id: string; name: string; role: string; createdAt: Date }>> {
    const db = await getDb();

    const rows = await db
      .select({
        id: orgs.id,
        name: orgs.name,
        role: orgMembers.role,
        createdAt: orgs.createdAt,
      })
      .from(orgMembers)
      .innerJoin(orgs, eq(orgMembers.orgId, orgs.id))
      .where(eq(orgMembers.userId, userId));

    return rows;
  }

  // ---------------------------------------------------------------------------
  // Members
  // ---------------------------------------------------------------------------

  async addMember(
    callerId: string,
    orgId: string,
    targetUserId: string,
    role: string,
  ): Promise<{ orgId: string; userId: string; role: string }> {
    const db = await getDb();

    // Verify org exists
    const [org] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.id, orgId));
    if (!org) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Not found' });
    }

    // Caller must be owner
    await this.requireOwner(callerId, orgId);

    // Check if already a member
    const [existing] = await db
      .select({ userId: orgMembers.userId })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetUserId)));

    if (existing) {
      throw new ConflictException({ code: 'CONFLICT', title: 'Already a member' });
    }

    await db.insert(orgMembers).values({ orgId, userId: targetUserId, role });

    return { orgId, userId: targetUserId, role };
  }

  async removeMember(callerId: string, orgId: string, targetUserId: string): Promise<void> {
    const db = await getDb();

    // Caller must be owner
    await this.requireOwner(callerId, orgId);

    // Owners cannot remove themselves
    if (callerId === targetUserId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', title: 'Forbidden' });
    }

    // Verify target is actually a member
    const [existing] = await db
      .select({ userId: orgMembers.userId })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetUserId)));

    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Not found' });
    }

    await db
      .delete(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetUserId)));
  }

  async listMembers(
    callerId: string,
    orgId: string,
  ): Promise<Array<{ userId: string; name: string; email: string; role: string }>> {
    const db = await getDb();

    // Caller must be a member
    const [membership] = await db
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, callerId)));

    if (!membership) {
      throw new ForbiddenException({ code: 'FORBIDDEN', title: 'Forbidden' });
    }

    const rows = await db
      .select({
        userId: orgMembers.userId,
        name: users.name,
        email: users.email,
        role: orgMembers.role,
      })
      .from(orgMembers)
      .innerJoin(users, eq(orgMembers.userId, users.id))
      .where(eq(orgMembers.orgId, orgId));

    return rows;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async requireOwner(callerId: string, orgId: string): Promise<void> {
    const db = await getDb();
    const [membership] = await db
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, callerId)));

    if (!membership || membership.role !== 'owner') {
      throw new ForbiddenException({ code: 'FORBIDDEN', title: 'Forbidden' });
    }
  }

  private toSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
  }
}
