# Users, Orgs, Projects CRUD + Guards — T1.3.4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create CRUD modules for users, orgs, projects, and memberships with RLS enforcement and role-based access guards.

**Architecture:** Each service method wraps all DB queries in `withTenant(fn, { userId })` via an injected `RlsDbService`. Role enforcement is defense-in-depth: guards check on the HTTP layer, services recheck in the DB query. A global `DbModule` provides `RlsDbService` to all feature modules.

**Tech Stack:** NestJS 11, postgres.js (raw SQL via `tx\`...\`` inside `withTenant`), nestjs-zod DTOs, Vitest unit tests with vi.mock for DB isolation.

---

## File Map

**Create (new files):**
- `packages/shared/src/schemas/members.ts` — patch: add 3 missing schemas
- `apps/api/src/modules/common/db/rls-db.service.ts` — NestJS wrapper around `withTenant`
- `apps/api/src/modules/common/db/db.module.ts` — global `@Module` that provides + exports `RlsDbService`
- `apps/api/src/modules/common/guards/admin.guard.ts` — `AdminGuard`: checks `is_admin = true`
- `apps/api/src/modules/common/guards/org-role.guard.ts` — `OrgRoleGuard(role)` factory + exported `OrgMemberGuard`, `OrgAdminGuard`, `OrgOwnerGuard`
- `apps/api/src/modules/common/guards/project-member.guard.ts` — `ProjectMemberGuard(role)` factory + exported `ProjectViewerGuard`, `ProjectEditorGuard`, `ProjectOwnerGuard`
- `apps/api/src/modules/users/users.service.ts` — profile get/update, public profile lookup
- `apps/api/src/modules/users/users.controller.ts` — GET/PATCH /users/me, GET /users/:id
- `apps/api/src/modules/users/users.module.ts`
- `apps/api/src/modules/users/users.service.spec.ts`
- `apps/api/src/modules/orgs/orgs.service.ts` — full org + org-member CRUD with auth checks
- `apps/api/src/modules/orgs/orgs.controller.ts` — 9 endpoints
- `apps/api/src/modules/orgs/orgs.module.ts`
- `apps/api/src/modules/orgs/orgs.service.spec.ts` — IDOR + role tests
- `apps/api/src/modules/projects/projects.service.ts` — full project + project-member CRUD
- `apps/api/src/modules/projects/projects.controller.ts` — 9 endpoints
- `apps/api/src/modules/projects/projects.module.ts`
- `apps/api/src/modules/projects/projects.service.spec.ts` — IDOR + role tests

**Modify (existing files):**
- `packages/shared/src/schemas/members.ts` — add `UpdateOrgMemberRoleInputSchema`, `AddProjectMemberInputSchema`, `UpdateProjectMemberRoleInputSchema`
- `apps/api/src/app.module.ts` — import `DbModule`, `UsersModule`, `OrgsModule`, `ProjectsModule`

---

## Task 1: Add Missing Zod Schemas to `packages/shared`

**Files:**
- Modify: `packages/shared/src/schemas/members.ts`

- [ ] **Step 1: Open the file and read current exports**

Read `/Users/omwani/Dev/BramhaV2/packages/shared/src/schemas/members.ts` (current content ends at line 44).

- [ ] **Step 2: Append the three missing schemas**

At the end of `packages/shared/src/schemas/members.ts`, add:

```ts
export const UpdateOrgMemberRoleInputSchema = z
  .object({
    role: OrgRoleSchema,
  })
  .strict()

export type UpdateOrgMemberRoleInput = z.infer<typeof UpdateOrgMemberRoleInputSchema>

export const AddProjectMemberInputSchema = z
  .object({
    userId: uuidSchema,
    role: ProjectRoleSchema,
  })
  .strict()

export type AddProjectMemberInput = z.infer<typeof AddProjectMemberInputSchema>

export const UpdateProjectMemberRoleInputSchema = z
  .object({
    role: ProjectRoleSchema,
  })
  .strict()

export type UpdateProjectMemberRoleInput = z.infer<typeof UpdateProjectMemberRoleInputSchema>
```

Note: `uuidSchema` is already imported at line 3 from `'./common.js'`.

- [ ] **Step 3: Run typecheck on the shared package**

```bash
cd /Users/omwani/Dev/BramhaV2 && pnpm turbo run typecheck --filter @bramha/shared
```

Expected: `Tasks: 1 successful, 0 failed`

- [ ] **Step 4: Run tests on the shared package**

```bash
cd /Users/omwani/Dev/BramhaV2 && pnpm turbo run test --filter @bramha/shared
```

Expected: All tests pass (existing schemas test still passes).

- [ ] **Step 5: Commit**

```bash
cd /Users/omwani/Dev/BramhaV2 && git add packages/shared/src/schemas/members.ts && git commit -m "feat(shared): add UpdateOrgMemberRole, AddProjectMember, UpdateProjectMemberRole schemas"
```

---

## Task 2: Create `DbModule` with `RlsDbService`

**Files:**
- Create: `apps/api/src/modules/common/db/rls-db.service.ts`
- Create: `apps/api/src/modules/common/db/db.module.ts`

- [ ] **Step 1: Create `rls-db.service.ts`**

Create `/Users/omwani/Dev/BramhaV2/apps/api/src/modules/common/db/rls-db.service.ts`:

```ts
import { Injectable } from '@nestjs/common'
import { withTenant } from '@bramha/db'
import type { TenantContext } from '@bramha/db'
import type postgres from 'postgres'

@Injectable()
export class RlsDbService {
  async run<T>(
    ctx: TenantContext,
    fn: (tx: postgres.TransactionSql) => Promise<T>,
  ): Promise<T> {
    return withTenant(fn, ctx)
  }
}
```

- [ ] **Step 2: Create `db.module.ts`**

Create `/Users/omwani/Dev/BramhaV2/apps/api/src/modules/common/db/db.module.ts`:

```ts
import { Global, Module } from '@nestjs/common'
import { RlsDbService } from './rls-db.service'

@Global()
@Module({
  providers: [RlsDbService],
  exports: [RlsDbService],
})
export class DbModule {}
```

`@Global()` means any module that imports `DbModule` once (in `AppModule`) gets `RlsDbService` available for injection everywhere — no need to import `DbModule` per feature module.

- [ ] **Step 3: Typecheck**

```bash
cd /Users/omwani/Dev/BramhaV2 && pnpm turbo run typecheck --filter @bramha/api
```

Expected: no errors (no new controllers/services yet, just a service class).

- [ ] **Step 4: Commit**

```bash
cd /Users/omwani/Dev/BramhaV2 && git add apps/api/src/modules/common/db/ && git commit -m "feat(api): add DbModule with RlsDbService for withTenant DI wrapper"
```

---

## Task 3: Create Common Guards

**Files:**
- Create: `apps/api/src/modules/common/guards/admin.guard.ts`
- Create: `apps/api/src/modules/common/guards/org-role.guard.ts`
- Create: `apps/api/src/modules/common/guards/project-member.guard.ts`

- [ ] **Step 1: Create `admin.guard.ts`**

Create `/Users/omwani/Dev/BramhaV2/apps/api/src/modules/common/guards/admin.guard.ts`:

```ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { RlsDbService } from '../db/rls-db.service'

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly db: RlsDbService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: { userId: string } }>()
    const userId = req.user?.userId
    if (!userId) throw new ForbiddenException({ code: 'forbidden' })

    const rows = await this.db.run({ userId }, async (tx) => {
      return tx<{ is_admin: boolean }[]>`
        SELECT is_admin FROM users WHERE id = ${userId}
      `
    })

    if (!rows[0]?.is_admin) throw new ForbiddenException({ code: 'forbidden' })
    return true
  }
}
```

- [ ] **Step 2: Create `org-role.guard.ts`**

Create `/Users/omwani/Dev/BramhaV2/apps/api/src/modules/common/guards/org-role.guard.ts`:

```ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  mixin,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { RlsDbService } from '../db/rls-db.service'
import type { OrgRole } from '@bramha/shared'

const ORG_ROLE_ORDER: OrgRole[] = ['member', 'admin', 'owner']

function hasOrgRole(actual: OrgRole, required: OrgRole): boolean {
  return ORG_ROLE_ORDER.indexOf(actual) >= ORG_ROLE_ORDER.indexOf(required)
}

function createOrgRoleGuard(requiredRole: OrgRole) {
  @Injectable()
  class OrgRoleMixinGuard implements CanActivate {
    constructor(readonly db: RlsDbService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
      const req = context
        .switchToHttp()
        .getRequest<
          FastifyRequest & { user?: { userId: string }; params: Record<string, string> }
        >()
      const userId = req.user?.userId
      const orgId = req.params['orgId']
      if (!userId || !orgId) throw new ForbiddenException({ code: 'forbidden' })

      const rows = await this.db.run({ userId }, async (tx) => {
        return tx<{ role: string }[]>`
          SELECT role FROM org_members WHERE org_id = ${orgId} AND user_id = ${userId}
        `
      })

      if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
      if (!hasOrgRole(rows[0].role as OrgRole, requiredRole)) {
        throw new ForbiddenException({ code: 'forbidden' })
      }
      return true
    }
  }

  return mixin(OrgRoleMixinGuard)
}

// Exported concrete guard classes — use these in @UseGuards() and module providers
export const OrgMemberGuard = createOrgRoleGuard('member')  // member or higher
export const OrgAdminGuard = createOrgRoleGuard('admin')    // admin or higher
export const OrgOwnerGuard = createOrgRoleGuard('owner')    // owner only
```

- [ ] **Step 3: Create `project-member.guard.ts`**

Create `/Users/omwani/Dev/BramhaV2/apps/api/src/modules/common/guards/project-member.guard.ts`:

```ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  mixin,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { RlsDbService } from '../db/rls-db.service'
import type { ProjectRole } from '@bramha/shared'

const PROJECT_ROLE_ORDER: ProjectRole[] = ['viewer', 'editor', 'owner']

function hasProjectRole(actual: ProjectRole, required: ProjectRole): boolean {
  return PROJECT_ROLE_ORDER.indexOf(actual) >= PROJECT_ROLE_ORDER.indexOf(required)
}

function createProjectMemberGuard(requiredRole: ProjectRole) {
  @Injectable()
  class ProjectMixinGuard implements CanActivate {
    constructor(readonly db: RlsDbService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
      const req = context
        .switchToHttp()
        .getRequest<
          FastifyRequest & { user?: { userId: string }; params: Record<string, string> }
        >()
      const userId = req.user?.userId
      const projectId = req.params['projectId']
      if (!userId || !projectId) throw new ForbiddenException({ code: 'forbidden' })

      const rows = await this.db.run({ userId, projectId }, async (tx) => {
        return tx<{ role: string }[]>`
          SELECT role FROM project_members
          WHERE project_id = ${projectId} AND user_id = ${userId}
        `
      })

      if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
      if (!hasProjectRole(rows[0].role as ProjectRole, requiredRole)) {
        throw new ForbiddenException({ code: 'forbidden' })
      }
      return true
    }
  }

  return mixin(ProjectMixinGuard)
}

// Exported concrete guard classes — use these in @UseGuards() and module providers
export const ProjectViewerGuard = createProjectMemberGuard('viewer')
export const ProjectEditorGuard = createProjectMemberGuard('editor')
export const ProjectOwnerGuard = createProjectMemberGuard('owner')
```

- [ ] **Step 4: Typecheck guards**

```bash
cd /Users/omwani/Dev/BramhaV2 && pnpm turbo run typecheck --filter @bramha/api
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/omwani/Dev/BramhaV2 && git add apps/api/src/modules/common/guards/ && git commit -m "feat(api): add AdminGuard, OrgRoleGuard, ProjectMemberGuard with mixin pattern"
```

---

## Task 4: Create `UsersModule`

**Files:**
- Create: `apps/api/src/modules/users/users.service.ts`
- Create: `apps/api/src/modules/users/users.controller.ts`
- Create: `apps/api/src/modules/users/users.module.ts`
- Create: `apps/api/src/modules/users/users.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `/Users/omwani/Dev/BramhaV2/apps/api/src/modules/users/users.service.spec.ts`:

```ts
import { vi, describe, it, expect, beforeEach } from 'vitest'

// Must be hoisted before @bramha/db loads to prevent real postgres init
vi.mock('@bramha/db', () => ({ withTenant: vi.fn() }))

import { NotFoundException } from '@nestjs/common'
import { UsersService } from './users.service'
import type { RlsDbService } from '../common/db/rls-db.service'

const USER_ID = '550e8400-e29b-41d4-a716-446655440000'
const OTHER_ID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

function makeUserRow() {
  return {
    id: USER_ID,
    email: 'alice@example.com',
    display_name: 'Alice',
    avatar_key: null,
    email_verified_at: '2024-01-01T00:00:00+00:00',
    is_admin: false,
    status: 'active',
    created_at: '2024-01-01T00:00:00+00:00',
    updated_at: '2024-01-01T00:00:00+00:00',
  }
}

function buildMocks() {
  const db: Partial<RlsDbService> = {
    run: vi.fn(),
  }
  return { db }
}

describe('UsersService', () => {
  let svc: UsersService
  let mocks: ReturnType<typeof buildMocks>

  beforeEach(() => {
    mocks = buildMocks()
    svc = new UsersService(mocks.db as RlsDbService)
  })

  describe('getMe', () => {
    it('returns profile for own userId', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        const tx = vi.fn().mockResolvedValue([makeUserRow()])
        return fn(tx as unknown as Parameters<typeof fn>[0])
      })
      const result = await svc.getMe(USER_ID)
      expect(result.id).toBe(USER_ID)
      expect(result.displayName).toBe('Alice')
    })

    it('throws NotFoundException when user not found', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        const tx = vi.fn().mockResolvedValue([])
        return fn(tx as unknown as Parameters<typeof fn>[0])
      })
      await expect(svc.getMe(USER_ID)).rejects.toThrow(NotFoundException)
    })
  })

  describe('getPublicProfile', () => {
    it('returns id, displayName, avatarKey only', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        const tx = vi.fn().mockResolvedValue([{
          id: OTHER_ID,
          display_name: 'Bob',
          avatar_key: null,
        }])
        return fn(tx as unknown as Parameters<typeof fn>[0])
      })
      const result = await svc.getPublicProfile(USER_ID, OTHER_ID)
      expect(result.id).toBe(OTHER_ID)
      expect(result.displayName).toBe('Bob')
      expect(Object.keys(result)).toEqual(['id', 'displayName', 'avatarKey'])
    })

    it('throws NotFoundException when target user not found', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        const tx = vi.fn().mockResolvedValue([])
        return fn(tx as unknown as Parameters<typeof fn>[0])
      })
      await expect(svc.getPublicProfile(USER_ID, OTHER_ID)).rejects.toThrow(NotFoundException)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/omwani/Dev/BramhaV2 && pnpm turbo run test --filter @bramha/api 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module './users.service'`

- [ ] **Step 3: Create `users.service.ts`**

Create `/Users/omwani/Dev/BramhaV2/apps/api/src/modules/users/users.service.ts`:

```ts
import { Injectable, NotFoundException, Logger } from '@nestjs/common'
import { RlsDbService } from '../common/db/rls-db.service'
import type { UpdateProfileInput } from '@bramha/shared'

interface UserRow {
  id: string
  email: string
  display_name: string
  avatar_key: string | null
  email_verified_at: string | null
  is_admin: boolean
  status: string
  created_at: string
  updated_at: string
}

export interface UserProfile {
  id: string
  email: string
  displayName: string
  avatarKey: string | null
  emailVerifiedAt: string | null
  isAdmin: boolean
  status: string
  createdAt: string
  updatedAt: string
}

export interface PublicProfile {
  id: string
  displayName: string
  avatarKey: string | null
}

function mapProfile(r: UserRow): UserProfile {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    avatarKey: r.avatar_key,
    emailVerifiedAt: r.email_verified_at,
    isAdmin: r.is_admin,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name)

  constructor(private readonly db: RlsDbService) {}

  async getMe(userId: string): Promise<UserProfile> {
    const rows = await this.db.run({ userId }, async (tx) => {
      return tx<UserRow[]>`
        SELECT id, email, display_name, avatar_key, email_verified_at,
               is_admin, status, created_at, updated_at
        FROM   users
        WHERE  id = ${userId}
      `
    })
    if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
    return mapProfile(rows[0])
  }

  async updateMe(userId: string, input: UpdateProfileInput): Promise<UserProfile> {
    return this.db.run({ userId }, async (tx) => {
      // Fetch current values to support partial update
      const current = await tx<{ display_name: string; avatar_key: string | null }[]>`
        SELECT display_name, avatar_key FROM users WHERE id = ${userId}
      `
      if (!current[0]) throw new NotFoundException({ code: 'not_found' })

      const newDisplayName = input.displayName ?? current[0].display_name
      const newAvatarKey =
        input.avatarKey !== undefined ? input.avatarKey : current[0].avatar_key

      const rows = await tx<UserRow[]>`
        UPDATE users
        SET    display_name = ${newDisplayName},
               avatar_key   = ${newAvatarKey},
               updated_at   = now()
        WHERE  id = ${userId}
        RETURNING id, email, display_name, avatar_key, email_verified_at,
                  is_admin, status, created_at, updated_at
      `
      if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
      this.logger.log({
        event: 'user.profile_updated',
        actorId: userId,
        targetId: userId,
        action: 'update',
      })
      return mapProfile(rows[0])
    })
  }

  async getPublicProfile(actorId: string, targetId: string): Promise<PublicProfile> {
    const rows = await this.db.run({ userId: actorId }, async (tx) => {
      return tx<{ id: string; display_name: string; avatar_key: string | null }[]>`
        SELECT id, display_name, avatar_key FROM users WHERE id = ${targetId}
      `
    })
    if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
    return {
      id: rows[0].id,
      displayName: rows[0].display_name,
      avatarKey: rows[0].avatar_key,
    }
  }
}
```

- [ ] **Step 4: Create `users.controller.ts`**

Create `/Users/omwani/Dev/BramhaV2/apps/api/src/modules/users/users.controller.ts`:

```ts
import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common'
import { createZodDto } from 'nestjs-zod'
import { UpdateProfileInputSchema } from '@bramha/shared'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator'
import { UsersService, type UserProfile, type PublicProfile } from './users.service'

class UpdateProfileDto extends createZodDto(UpdateProfileInputSchema) {}

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser() user: AuthenticatedUser): Promise<UserProfile> {
    return this.users.getMe(user.userId)
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateProfileDto,
  ): Promise<UserProfile> {
    return this.users.updateMe(user.userId, body)
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  getPublicProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') targetId: string,
  ): Promise<PublicProfile> {
    return this.users.getPublicProfile(user.userId, targetId)
  }
}
```

- [ ] **Step 5: Create `users.module.ts`**

Create `/Users/omwani/Dev/BramhaV2/apps/api/src/modules/users/users.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { UsersService } from './users.service'
import { UsersController } from './users.controller'

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd /Users/omwani/Dev/BramhaV2 && pnpm turbo run test --filter @bramha/api 2>&1 | tail -20
```

Expected: All users.service.spec.ts tests pass.

- [ ] **Step 7: Typecheck**

```bash
cd /Users/omwani/Dev/BramhaV2 && pnpm turbo run typecheck --filter @bramha/api
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
cd /Users/omwani/Dev/BramhaV2 && git add apps/api/src/modules/users/ && git commit -m "feat(api): add UsersModule with profile CRUD endpoints"
```

---

## Task 5: Create `OrgsModule`

**Files:**
- Create: `apps/api/src/modules/orgs/orgs.service.ts`
- Create: `apps/api/src/modules/orgs/orgs.controller.ts`
- Create: `apps/api/src/modules/orgs/orgs.module.ts`
- Create: `apps/api/src/modules/orgs/orgs.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `/Users/omwani/Dev/BramhaV2/apps/api/src/modules/orgs/orgs.service.spec.ts`:

```ts
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@bramha/db', () => ({ withTenant: vi.fn() }))

import { NotFoundException, ForbiddenException } from '@nestjs/common'
import { OrgsService } from './orgs.service'
import type { RlsDbService } from '../common/db/rls-db.service'

const ACTOR_ID   = '550e8400-e29b-41d4-a716-446655440000'
const TARGET_ID  = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const ORG_ID     = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

function makeTx(results: unknown[][]) {
  let call = 0
  return vi.fn().mockImplementation(() => Promise.resolve(results[call++] ?? []))
}

function buildMocks() {
  const db: Partial<RlsDbService> = { run: vi.fn() }
  return { db }
}

describe('OrgsService', () => {
  let svc: OrgsService
  let mocks: ReturnType<typeof buildMocks>

  beforeEach(() => {
    mocks = buildMocks()
    svc = new OrgsService(mocks.db as RlsDbService)
  })

  // ── Security: IDOR / membership checks ──────────────────────────────────

  describe('update', () => {
    it('non-member gets NotFoundException (no existence leak)', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        // tx returns [] for the membership SELECT — user is not a member
        return fn(makeTx([[]])) 
      })
      await expect(
        svc.update(ACTOR_ID, ORG_ID, { name: 'New' }),
      ).rejects.toThrow(NotFoundException)
    })

    it('member (non-owner) gets ForbiddenException', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        // tx returns [{ role: 'member' }] — user is a member but not owner
        return fn(makeTx([[{ role: 'member' }]]))
      })
      await expect(
        svc.update(ACTOR_ID, ORG_ID, { name: 'New' }),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  describe('deleteOrg', () => {
    it('non-member gets NotFoundException', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        return fn(makeTx([[]]))
      })
      await expect(svc.deleteOrg(ACTOR_ID, ORG_ID)).rejects.toThrow(NotFoundException)
    })

    it('admin (non-owner) gets ForbiddenException', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        return fn(makeTx([[{ role: 'admin' }]]))
      })
      await expect(svc.deleteOrg(ACTOR_ID, ORG_ID)).rejects.toThrow(ForbiddenException)
    })
  })

  // ── Last-owner removal ──────────────────────────────────────────────────

  describe('removeMember', () => {
    it('blocks removal of the last owner', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        // Call order: 1) actor membership  → [{ role: 'owner' }]
        //             2) target membership → [{ role: 'owner' }]  (target IS an owner)
        //             3) owner count       → [{ count: '1' }]     (only 1 owner → block)
        return fn(makeTx([[{ role: 'owner' }], [{ role: 'owner' }], [{ count: '1' }]]))
      })
      await expect(
        svc.removeMember(ACTOR_ID, ORG_ID, ACTOR_ID),
      ).rejects.toThrow(ForbiddenException)
    })

    it('allows removal of a member (non-owner)', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        // Call order: 1) actor membership  → [{ role: 'owner' }]
        //             2) target membership → [{ role: 'member' }] (not owner, skip count check)
        //             3) DELETE            → []
        return fn(makeTx([[{ role: 'owner' }], [{ role: 'member' }], []]))
      })
      await expect(
        svc.removeMember(ACTOR_ID, ORG_ID, TARGET_ID),
      ).resolves.toBeUndefined()
    })
  })

  // ── Role escalation ─────────────────────────────────────────────────────

  describe('updateMemberRole', () => {
    it('member cannot change roles (ForbiddenException)', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        // actor's membership → role: 'member'
        return fn(makeTx([[{ role: 'member' }]]))
      })
      await expect(
        svc.updateMemberRole(ACTOR_ID, ORG_ID, TARGET_ID, 'admin'),
      ).rejects.toThrow(ForbiddenException)
    })

    it('admin cannot escalate to owner', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        return fn(makeTx([[{ role: 'admin' }]]))
      })
      await expect(
        svc.updateMemberRole(ACTOR_ID, ORG_ID, TARGET_ID, 'owner'),
      ).rejects.toThrow(ForbiddenException)
    })

    it('owner can grant owner role', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        // actor membership, then UPDATE returns []
        return fn(makeTx([[{ role: 'owner' }], []]))
      })
      await expect(
        svc.updateMemberRole(ACTOR_ID, ORG_ID, TARGET_ID, 'owner'),
      ).resolves.toBeUndefined()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/omwani/Dev/BramhaV2 && pnpm turbo run test --filter @bramha/api 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module './orgs.service'`

- [ ] **Step 3: Create `orgs.service.ts`**

Create `/Users/omwani/Dev/BramhaV2/apps/api/src/modules/orgs/orgs.service.ts`:

```ts
import { Injectable, NotFoundException, ForbiddenException, ConflictException, Logger } from '@nestjs/common'
import { RlsDbService } from '../common/db/rls-db.service'
import type {
  CreateOrgInput,
  UpdateOrgInput,
  InviteOrgMemberInput,
  UpdateOrgMemberRoleInput,
  OrgRole,
} from '@bramha/shared'

interface OrgRow {
  id: string
  name: string
  slug: string
  owner_id: string
  created_at: string
  updated_at: string
}

export interface OrgDto {
  id: string
  name: string
  slug: string
  ownerId: string
  createdAt: string
  updatedAt: string
}

export interface OrgMemberDto {
  orgId: string
  userId: string
  role: string
  createdAt: string
}

function mapOrg(r: OrgRow): OrgDto {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    ownerId: r.owner_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

@Injectable()
export class OrgsService {
  private readonly logger = new Logger(OrgsService.name)

  constructor(private readonly db: RlsDbService) {}

  // ── Orgs ───────────────────────────────────────────────────────────────

  async create(userId: string, input: CreateOrgInput): Promise<OrgDto> {
    return this.db.run({ userId }, async (tx) => {
      let rows: OrgRow[]
      try {
        rows = await tx<OrgRow[]>`
          INSERT INTO orgs (name, slug, owner_id)
          VALUES (${input.name}, ${input.slug}, ${userId})
          RETURNING id, name, slug, owner_id, created_at, updated_at
        `
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : ''
        if (msg.includes('unique') && msg.includes('slug')) {
          throw new ConflictException({ code: 'slug_taken' })
        }
        throw err
      }
      if (!rows[0]) throw new Error('org insert returned no row')
      await tx`
        INSERT INTO org_members (org_id, user_id, role)
        VALUES (${rows[0].id}, ${userId}, 'owner')
      `
      this.logger.log({ event: 'org.created', actorId: userId, targetId: rows[0].id, action: 'create' })
      return mapOrg(rows[0])
    })
  }

  async listForUser(userId: string): Promise<OrgDto[]> {
    return this.db.run({ userId }, async (tx) => {
      const rows = await tx<OrgRow[]>`
        SELECT o.id, o.name, o.slug, o.owner_id, o.created_at, o.updated_at
        FROM   orgs o
        JOIN   org_members om ON om.org_id = o.id
        WHERE  om.user_id = ${userId}
        ORDER  BY o.created_at ASC
      `
      return rows.map(mapOrg)
    })
  }

  async getById(userId: string, orgId: string): Promise<OrgDto> {
    return this.db.run({ userId }, async (tx) => {
      const rows = await tx<OrgRow[]>`
        SELECT o.id, o.name, o.slug, o.owner_id, o.created_at, o.updated_at
        FROM   orgs o
        JOIN   org_members om ON om.org_id = o.id
        WHERE  o.id = ${orgId} AND om.user_id = ${userId}
      `
      if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
      return mapOrg(rows[0])
    })
  }

  async update(userId: string, orgId: string, input: UpdateOrgInput): Promise<OrgDto> {
    return this.db.run({ userId }, async (tx) => {
      const membership = await tx<{ role: string }[]>`
        SELECT role FROM org_members WHERE org_id = ${orgId} AND user_id = ${userId}
      `
      if (!membership[0]) throw new NotFoundException({ code: 'not_found' })
      if (membership[0].role !== 'owner') throw new ForbiddenException({ code: 'forbidden' })

      const current = await tx<{ name: string; slug: string }[]>`
        SELECT name, slug FROM orgs WHERE id = ${orgId}
      `
      if (!current[0]) throw new NotFoundException({ code: 'not_found' })

      const rows = await tx<OrgRow[]>`
        UPDATE orgs
        SET    name       = ${input.name ?? current[0].name},
               slug       = ${input.slug ?? current[0].slug},
               updated_at = now()
        WHERE  id = ${orgId}
        RETURNING id, name, slug, owner_id, created_at, updated_at
      `
      if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
      this.logger.log({ event: 'org.updated', actorId: userId, targetId: orgId, action: 'update' })
      return mapOrg(rows[0])
    })
  }

  async deleteOrg(userId: string, orgId: string): Promise<void> {
    return this.db.run({ userId }, async (tx) => {
      const membership = await tx<{ role: string }[]>`
        SELECT role FROM org_members WHERE org_id = ${orgId} AND user_id = ${userId}
      `
      if (!membership[0]) throw new NotFoundException({ code: 'not_found' })
      if (membership[0].role !== 'owner') throw new ForbiddenException({ code: 'forbidden' })

      await tx`DELETE FROM orgs WHERE id = ${orgId}`
      this.logger.log({ event: 'org.deleted', actorId: userId, targetId: orgId, action: 'delete' })
    })
  }

  // ── Org Members ────────────────────────────────────────────────────────

  async inviteMember(
    actorId: string,
    orgId: string,
    input: InviteOrgMemberInput,
  ): Promise<OrgMemberDto> {
    return this.db.run({ userId: actorId }, async (tx) => {
      // Find user by email
      const users = await tx<{ id: string }[]>`
        SELECT id FROM users WHERE email = ${input.email}
      `
      if (!users[0]) throw new NotFoundException({ code: 'user_not_found' })
      const targetUserId = users[0].id

      // Check not already a member
      const existing = await tx<{ user_id: string }[]>`
        SELECT user_id FROM org_members WHERE org_id = ${orgId} AND user_id = ${targetUserId}
      `
      if (existing[0]) throw new ConflictException({ code: 'already_member' })

      const rows = await tx<{ org_id: string; user_id: string; role: string; created_at: string }[]>`
        INSERT INTO org_members (org_id, user_id, role)
        VALUES (${orgId}, ${targetUserId}, ${input.role})
        RETURNING org_id, user_id, role, created_at
      `
      if (!rows[0]) throw new Error('org_member insert returned no row')
      this.logger.log({ event: 'org.member_invited', actorId, targetId: targetUserId, action: 'invite' })
      return { orgId: rows[0].org_id, userId: rows[0].user_id, role: rows[0].role, createdAt: rows[0].created_at }
    })
  }

  async listMembers(userId: string, orgId: string): Promise<OrgMemberDto[]> {
    return this.db.run({ userId }, async (tx) => {
      const rows = await tx<{ org_id: string; user_id: string; role: string; created_at: string }[]>`
        SELECT org_id, user_id, role, created_at
        FROM   org_members
        WHERE  org_id = ${orgId}
        ORDER  BY created_at ASC
      `
      return rows.map((r) => ({
        orgId: r.org_id,
        userId: r.user_id,
        role: r.role,
        createdAt: r.created_at,
      }))
    })
  }

  async updateMemberRole(
    actorId: string,
    orgId: string,
    targetUserId: string,
    role: OrgRole,
  ): Promise<void> {
    return this.db.run({ userId: actorId }, async (tx) => {
      // Check actor's role
      const actorMembership = await tx<{ role: string }[]>`
        SELECT role FROM org_members WHERE org_id = ${orgId} AND user_id = ${actorId}
      `
      if (!actorMembership[0]) throw new NotFoundException({ code: 'not_found' })

      const actorRole = actorMembership[0].role as OrgRole

      // Only admin+ can change roles
      if (!['admin', 'owner'].includes(actorRole)) {
        throw new ForbiddenException({ code: 'forbidden' })
      }
      // Only owner can grant owner role
      if (role === 'owner' && actorRole !== 'owner') {
        throw new ForbiddenException({ code: 'forbidden' })
      }

      await tx`
        UPDATE org_members
        SET    role = ${role}
        WHERE  org_id = ${orgId} AND user_id = ${targetUserId}
      `
      this.logger.log({ event: 'org.member_role_updated', actorId, targetId: targetUserId, action: 'update_role' })
    })
  }

  async removeMember(actorId: string, orgId: string, targetUserId: string): Promise<void> {
    return this.db.run({ userId: actorId }, async (tx) => {
      // Check actor's role
      const actorMembership = await tx<{ role: string }[]>`
        SELECT role FROM org_members WHERE org_id = ${orgId} AND user_id = ${actorId}
      `
      if (!actorMembership[0]) throw new NotFoundException({ code: 'not_found' })
      if (!['admin', 'owner'].includes(actorMembership[0].role)) {
        throw new ForbiddenException({ code: 'forbidden' })
      }

      // Guard: cannot remove last owner.
      // Check target's role first; if owner, verify there is more than one owner remaining.
      const targetMembership = await tx<{ role: string }[]>`
        SELECT role FROM org_members WHERE org_id = ${orgId} AND user_id = ${targetUserId}
      `
      if (targetMembership[0]?.role === 'owner') {
        const countRows = await tx<{ count: string }[]>`
          SELECT count(*)::text AS count
          FROM   org_members
          WHERE  org_id = ${orgId} AND role = 'owner'
        `
        const ownerCount = parseInt(countRows[0]?.count ?? '0', 10)
        if (ownerCount <= 1) {
          throw new ForbiddenException({ code: 'last_owner' })
        }
      }

      await tx`
        DELETE FROM org_members WHERE org_id = ${orgId} AND user_id = ${targetUserId}
      `
      this.logger.log({ event: 'org.member_removed', actorId, targetId: targetUserId, action: 'remove' })
    })
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/omwani/Dev/BramhaV2 && pnpm turbo run test --filter @bramha/api 2>&1 | tail -30
```

Expected: all orgs.service.spec.ts tests pass.

- [ ] **Step 5: Create `orgs.controller.ts`**

Create `/Users/omwani/Dev/BramhaV2/apps/api/src/modules/orgs/orgs.controller.ts`:

```ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { createZodDto } from 'nestjs-zod'
import {
  CreateOrgInputSchema,
  UpdateOrgInputSchema,
  InviteOrgMemberInputSchema,
  UpdateOrgMemberRoleInputSchema,
} from '@bramha/shared'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator'
import { OrgAdminGuard, OrgOwnerGuard, OrgMemberGuard } from '../common/guards/org-role.guard'
import { OrgsService, type OrgDto, type OrgMemberDto } from './orgs.service'

class CreateOrgDto extends createZodDto(CreateOrgInputSchema) {}
class UpdateOrgDto extends createZodDto(UpdateOrgInputSchema) {}
class InviteOrgMemberDto extends createZodDto(InviteOrgMemberInputSchema) {}
class UpdateOrgMemberRoleDto extends createZodDto(UpdateOrgMemberRoleInputSchema) {}

@Controller('orgs')
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  /** POST /orgs — Create org; caller becomes owner */
  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateOrgDto,
  ): Promise<OrgDto> {
    return this.orgs.create(user.userId, body)
  }

  /** GET /orgs — List orgs the caller belongs to */
  @Get()
  @UseGuards(JwtAuthGuard)
  list(@CurrentUser() user: AuthenticatedUser): Promise<OrgDto[]> {
    return this.orgs.listForUser(user.userId)
  }

  /** GET /orgs/:orgId — Get org details */
  @Get(':orgId')
  @UseGuards(JwtAuthGuard)
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId') orgId: string,
  ): Promise<OrgDto> {
    return this.orgs.getById(user.userId, orgId)
  }

  /** PATCH /orgs/:orgId — Update org (owner only) */
  @Patch(':orgId')
  @UseGuards(JwtAuthGuard, OrgOwnerGuard)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId') orgId: string,
    @Body() body: UpdateOrgDto,
  ): Promise<OrgDto> {
    return this.orgs.update(user.userId, orgId, body)
  }

  /** DELETE /orgs/:orgId — Delete org (owner only) */
  @Delete(':orgId')
  @UseGuards(JwtAuthGuard, OrgOwnerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId') orgId: string,
  ): Promise<void> {
    return this.orgs.deleteOrg(user.userId, orgId)
  }

  // ── Members ──────────────────────────────────────────────────────────────

  /** POST /orgs/:orgId/members — Invite member by email (admin+) */
  @Post(':orgId/members')
  @UseGuards(JwtAuthGuard, OrgAdminGuard)
  @HttpCode(HttpStatus.CREATED)
  inviteMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId') orgId: string,
    @Body() body: InviteOrgMemberDto,
  ): Promise<OrgMemberDto> {
    return this.orgs.inviteMember(user.userId, orgId, body)
  }

  /** GET /orgs/:orgId/members — List org members */
  @Get(':orgId/members')
  @UseGuards(JwtAuthGuard, OrgMemberGuard)
  listMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId') orgId: string,
  ): Promise<OrgMemberDto[]> {
    return this.orgs.listMembers(user.userId, orgId)
  }

  /** PATCH /orgs/:orgId/members/:userId — Update member role (admin+) */
  @Patch(':orgId/members/:userId')
  @UseGuards(JwtAuthGuard, OrgAdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  updateMemberRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId') orgId: string,
    @Param('userId') targetUserId: string,
    @Body() body: UpdateOrgMemberRoleDto,
  ): Promise<void> {
    return this.orgs.updateMemberRole(user.userId, orgId, targetUserId, body.role)
  }

  /** DELETE /orgs/:orgId/members/:userId — Remove member (admin+) */
  @Delete(':orgId/members/:userId')
  @UseGuards(JwtAuthGuard, OrgAdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId') orgId: string,
    @Param('userId') targetUserId: string,
  ): Promise<void> {
    return this.orgs.removeMember(user.userId, orgId, targetUserId)
  }
}
```

- [ ] **Step 6: Create `orgs.module.ts`**

Create `/Users/omwani/Dev/BramhaV2/apps/api/src/modules/orgs/orgs.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { OrgAdminGuard, OrgOwnerGuard, OrgMemberGuard } from '../common/guards/org-role.guard'
import { OrgsService } from './orgs.service'
import { OrgsController } from './orgs.controller'

@Module({
  imports: [AuthModule],
  controllers: [OrgsController],
  providers: [OrgsService, OrgAdminGuard, OrgOwnerGuard, OrgMemberGuard],
  exports: [OrgsService],
})
export class OrgsModule {}
```

- [ ] **Step 7: Typecheck**

```bash
cd /Users/omwani/Dev/BramhaV2 && pnpm turbo run typecheck --filter @bramha/api
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
cd /Users/omwani/Dev/BramhaV2 && git add apps/api/src/modules/orgs/ && git commit -m "feat(api): add OrgsModule with CRUD, membership management, and role guards"
```

---

## Task 6: Create `ProjectsModule`

**Files:**
- Create: `apps/api/src/modules/projects/projects.service.ts`
- Create: `apps/api/src/modules/projects/projects.controller.ts`
- Create: `apps/api/src/modules/projects/projects.module.ts`
- Create: `apps/api/src/modules/projects/projects.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `/Users/omwani/Dev/BramhaV2/apps/api/src/modules/projects/projects.service.spec.ts`:

```ts
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@bramha/db', () => ({ withTenant: vi.fn() }))

import { NotFoundException, ForbiddenException } from '@nestjs/common'
import { ProjectsService } from './projects.service'
import type { RlsDbService } from '../common/db/rls-db.service'

const ACTOR_ID   = '550e8400-e29b-41d4-a716-446655440000'
const TARGET_ID  = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const PROJECT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
const ORG_ID     = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'

function makeTx(results: unknown[][]) {
  let call = 0
  return vi.fn().mockImplementation(() => Promise.resolve(results[call++] ?? []))
}

function buildMocks() {
  const db: Partial<RlsDbService> = { run: vi.fn() }
  return { db }
}

describe('ProjectsService', () => {
  let svc: ProjectsService
  let mocks: ReturnType<typeof buildMocks>

  beforeEach(() => {
    mocks = buildMocks()
    svc = new ProjectsService(mocks.db as RlsDbService)
  })

  // ── Security: IDOR ───────────────────────────────────────────────────────

  describe('getById', () => {
    it('outsider (no membership) gets NotFoundException', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        return fn(makeTx([[]]))
      })
      await expect(svc.getById(ACTOR_ID, PROJECT_ID)).rejects.toThrow(NotFoundException)
    })

    it('member can retrieve project', async () => {
      const projectRow = {
        id: PROJECT_ID,
        org_id: ORG_ID,
        name: 'My Project',
        description: null,
        settings: '{}',
        archived_at: null,
        created_at: '2024-01-01T00:00:00+00:00',
        updated_at: '2024-01-01T00:00:00+00:00',
      }
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        return fn(makeTx([[projectRow]]))
      })
      const result = await svc.getById(ACTOR_ID, PROJECT_ID)
      expect(result.id).toBe(PROJECT_ID)
    })
  })

  // ── Role checks ──────────────────────────────────────────────────────────

  describe('archive', () => {
    it('viewer cannot archive project (ForbiddenException)', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        // membership check returns 'viewer'
        return fn(makeTx([[{ role: 'viewer' }]]))
      })
      await expect(svc.archive(ACTOR_ID, PROJECT_ID)).rejects.toThrow(ForbiddenException)
    })

    it('editor cannot archive project (ForbiddenException)', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        return fn(makeTx([[{ role: 'editor' }]]))
      })
      await expect(svc.archive(ACTOR_ID, PROJECT_ID)).rejects.toThrow(ForbiddenException)
    })
  })

  // ── Last-owner removal ───────────────────────────────────────────────────

  describe('removeMember', () => {
    it('blocks removal of the last project owner', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        // Call order: 1) actor membership  → [{ role: 'owner' }]
        //             2) target membership → [{ role: 'owner' }]  (target IS an owner)
        //             3) owner count       → [{ count: '1' }]     (only 1 owner → block)
        return fn(makeTx([[{ role: 'owner' }], [{ role: 'owner' }], [{ count: '1' }]]))
      })
      await expect(
        svc.removeMember(ACTOR_ID, PROJECT_ID, ACTOR_ID),
      ).rejects.toThrow(ForbiddenException)
    })

    it('allows removing a viewer (non-owner)', async () => {
      vi.mocked(mocks.db.run!).mockImplementation(async (_ctx, fn) => {
        // Call order: 1) actor membership  → [{ role: 'owner' }]
        //             2) target membership → [{ role: 'viewer' }] (not owner, skip count check)
        //             3) DELETE            → []
        return fn(makeTx([[{ role: 'owner' }], [{ role: 'viewer' }], []]))
      })
      await expect(
        svc.removeMember(ACTOR_ID, PROJECT_ID, TARGET_ID),
      ).resolves.toBeUndefined()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/omwani/Dev/BramhaV2 && pnpm turbo run test --filter @bramha/api 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module './projects.service'`

- [ ] **Step 3: Create `projects.service.ts`**

Create `/Users/omwani/Dev/BramhaV2/apps/api/src/modules/projects/projects.service.ts`:

```ts
import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common'
import { RlsDbService } from '../common/db/rls-db.service'
import type {
  CreateProjectInput,
  UpdateProjectInput,
  AddProjectMemberInput,
  UpdateProjectMemberRoleInput,
  ProjectRole,
} from '@bramha/shared'

interface ProjectRow {
  id: string
  org_id: string
  name: string
  description: string | null
  settings: unknown
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface ProjectDto {
  id: string
  orgId: string
  name: string
  description: string | null
  settings: unknown
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ProjectMemberDto {
  projectId: string
  userId: string
  role: string
  createdAt: string
}

function mapProject(r: ProjectRow): ProjectDto {
  return {
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    description: r.description,
    settings: r.settings,
    archivedAt: r.archived_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name)

  constructor(private readonly db: RlsDbService) {}

  // ── Projects ───────────────────────────────────────────────────────────

  async create(userId: string, orgId: string, input: CreateProjectInput): Promise<ProjectDto> {
    return this.db.run({ userId }, async (tx) => {
      const rows = await tx<ProjectRow[]>`
        INSERT INTO projects (org_id, name, description)
        VALUES (${orgId}, ${input.name}, ${input.description ?? null})
        RETURNING id, org_id, name, description, settings, archived_at, created_at, updated_at
      `
      if (!rows[0]) throw new Error('project insert returned no row')
      await tx`
        INSERT INTO project_members (project_id, user_id, role)
        VALUES (${rows[0].id}, ${userId}, 'owner')
      `
      this.logger.log({ event: 'project.created', actorId: userId, targetId: rows[0].id, action: 'create' })
      return mapProject(rows[0])
    })
  }

  async listByOrg(userId: string, orgId: string): Promise<ProjectDto[]> {
    return this.db.run({ userId }, async (tx) => {
      const rows = await tx<ProjectRow[]>`
        SELECT p.id, p.org_id, p.name, p.description, p.settings, p.archived_at,
               p.created_at, p.updated_at
        FROM   projects p
        JOIN   project_members pm ON pm.project_id = p.id
        WHERE  p.org_id = ${orgId} AND pm.user_id = ${userId}
        ORDER  BY p.created_at ASC
      `
      return rows.map(mapProject)
    })
  }

  async getById(userId: string, projectId: string): Promise<ProjectDto> {
    return this.db.run({ userId, projectId }, async (tx) => {
      const rows = await tx<ProjectRow[]>`
        SELECT p.id, p.org_id, p.name, p.description, p.settings, p.archived_at,
               p.created_at, p.updated_at
        FROM   projects p
        JOIN   project_members pm ON pm.project_id = p.id
        WHERE  p.id = ${projectId} AND pm.user_id = ${userId}
      `
      if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
      return mapProject(rows[0])
    })
  }

  async update(userId: string, projectId: string, input: UpdateProjectInput): Promise<ProjectDto> {
    return this.db.run({ userId, projectId }, async (tx) => {
      // Verify ownership
      const membership = await tx<{ role: string }[]>`
        SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${userId}
      `
      if (!membership[0]) throw new NotFoundException({ code: 'not_found' })
      if (membership[0].role !== 'owner') throw new ForbiddenException({ code: 'forbidden' })

      const current = await tx<{ name: string; description: string | null; settings: unknown }[]>`
        SELECT name, description, settings FROM projects WHERE id = ${projectId}
      `
      if (!current[0]) throw new NotFoundException({ code: 'not_found' })

      const newName = input.name ?? current[0].name
      const newDescription =
        input.description !== undefined ? input.description : current[0].description

      const rows = await tx<ProjectRow[]>`
        UPDATE projects
        SET    name        = ${newName},
               description = ${newDescription},
               updated_at  = now()
        WHERE  id = ${projectId}
        RETURNING id, org_id, name, description, settings, archived_at, created_at, updated_at
      `
      if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
      this.logger.log({ event: 'project.updated', actorId: userId, targetId: projectId, action: 'update' })
      return mapProject(rows[0])
    })
  }

  async archive(userId: string, projectId: string): Promise<ProjectDto> {
    return this.db.run({ userId, projectId }, async (tx) => {
      const membership = await tx<{ role: string }[]>`
        SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${userId}
      `
      if (!membership[0]) throw new NotFoundException({ code: 'not_found' })
      if (membership[0].role !== 'owner') throw new ForbiddenException({ code: 'forbidden' })

      const rows = await tx<ProjectRow[]>`
        UPDATE projects
        SET    archived_at = now(),
               updated_at  = now()
        WHERE  id = ${projectId}
        RETURNING id, org_id, name, description, settings, archived_at, created_at, updated_at
      `
      if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
      this.logger.log({ event: 'project.archived', actorId: userId, targetId: projectId, action: 'archive' })
      return mapProject(rows[0])
    })
  }

  // ── Project Members ────────────────────────────────────────────────────

  async addMember(
    actorId: string,
    projectId: string,
    input: AddProjectMemberInput,
  ): Promise<ProjectMemberDto> {
    return this.db.run({ userId: actorId, projectId }, async (tx) => {
      const rows = await tx<{ project_id: string; user_id: string; role: string; created_at: string }[]>`
        INSERT INTO project_members (project_id, user_id, role)
        VALUES (${projectId}, ${input.userId}, ${input.role})
        RETURNING project_id, user_id, role, created_at
      `
      if (!rows[0]) throw new Error('project_member insert returned no row')
      this.logger.log({ event: 'project.member_added', actorId, targetId: input.userId, action: 'add_member' })
      return {
        projectId: rows[0].project_id,
        userId: rows[0].user_id,
        role: rows[0].role,
        createdAt: rows[0].created_at,
      }
    })
  }

  async listMembers(userId: string, projectId: string): Promise<ProjectMemberDto[]> {
    return this.db.run({ userId, projectId }, async (tx) => {
      const rows = await tx<{ project_id: string; user_id: string; role: string; created_at: string }[]>`
        SELECT project_id, user_id, role, created_at
        FROM   project_members
        WHERE  project_id = ${projectId}
        ORDER  BY created_at ASC
      `
      return rows.map((r) => ({
        projectId: r.project_id,
        userId: r.user_id,
        role: r.role,
        createdAt: r.created_at,
      }))
    })
  }

  async updateMemberRole(
    actorId: string,
    projectId: string,
    targetUserId: string,
    input: UpdateProjectMemberRoleInput,
  ): Promise<void> {
    return this.db.run({ userId: actorId, projectId }, async (tx) => {
      const actorMembership = await tx<{ role: string }[]>`
        SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${actorId}
      `
      if (!actorMembership[0]) throw new NotFoundException({ code: 'not_found' })
      if (actorMembership[0].role !== 'owner') throw new ForbiddenException({ code: 'forbidden' })

      await tx`
        UPDATE project_members
        SET    role = ${input.role}
        WHERE  project_id = ${projectId} AND user_id = ${targetUserId}
      `
      this.logger.log({ event: 'project.member_role_updated', actorId, targetId: targetUserId, action: 'update_role' })
    })
  }

  async removeMember(actorId: string, projectId: string, targetUserId: string): Promise<void> {
    return this.db.run({ userId: actorId, projectId }, async (tx) => {
      const actorMembership = await tx<{ role: string }[]>`
        SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${actorId}
      `
      if (!actorMembership[0]) throw new NotFoundException({ code: 'not_found' })
      if (actorMembership[0].role !== 'owner') throw new ForbiddenException({ code: 'forbidden' })

      // Guard: cannot remove last owner.
      // Check target's role first; if owner, verify there is more than one owner remaining.
      const targetMembership = await tx<{ role: string }[]>`
        SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${targetUserId}
      `
      if (targetMembership[0]?.role === 'owner') {
        const countRows = await tx<{ count: string }[]>`
          SELECT count(*)::text AS count
          FROM   project_members
          WHERE  project_id = ${projectId} AND role = 'owner'
        `
        const ownerCount = parseInt(countRows[0]?.count ?? '0', 10)
        if (ownerCount <= 1) {
          throw new ForbiddenException({ code: 'last_owner' })
        }
      }

      await tx`
        DELETE FROM project_members WHERE project_id = ${projectId} AND user_id = ${targetUserId}
      `
      this.logger.log({ event: 'project.member_removed', actorId, targetId: targetUserId, action: 'remove' })
    })
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/omwani/Dev/BramhaV2 && pnpm turbo run test --filter @bramha/api 2>&1 | tail -30
```

Expected: all projects.service.spec.ts tests pass.

- [ ] **Step 5: Create `projects.controller.ts`**

Create `/Users/omwani/Dev/BramhaV2/apps/api/src/modules/projects/projects.controller.ts`:

```ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { createZodDto } from 'nestjs-zod'
import {
  CreateProjectInputSchema,
  UpdateProjectInputSchema,
  AddProjectMemberInputSchema,
  UpdateProjectMemberRoleInputSchema,
} from '@bramha/shared'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator'
import { OrgMemberGuard } from '../common/guards/org-role.guard'
import {
  ProjectViewerGuard,
  ProjectOwnerGuard,
} from '../common/guards/project-member.guard'
import {
  ProjectsService,
  type ProjectDto,
  type ProjectMemberDto,
} from './projects.service'

class CreateProjectDto extends createZodDto(CreateProjectInputSchema) {}
class UpdateProjectDto extends createZodDto(UpdateProjectInputSchema) {}
class AddProjectMemberDto extends createZodDto(AddProjectMemberInputSchema) {}
class UpdateProjectMemberRoleDto extends createZodDto(UpdateProjectMemberRoleInputSchema) {}

@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  // ── Org-scoped project routes ─────────────────────────────────────────

  /** POST /orgs/:orgId/projects — Create project in org (org member+) */
  @Post('orgs/:orgId/projects')
  @UseGuards(JwtAuthGuard, OrgMemberGuard)
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId') orgId: string,
    @Body() body: CreateProjectDto,
  ): Promise<ProjectDto> {
    return this.projects.create(user.userId, orgId, body)
  }

  /** GET /orgs/:orgId/projects — List projects in org (RLS-filtered) */
  @Get('orgs/:orgId/projects')
  @UseGuards(JwtAuthGuard)
  listByOrg(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId') orgId: string,
  ): Promise<ProjectDto[]> {
    return this.projects.listByOrg(user.userId, orgId)
  }

  // ── Project-scoped routes ─────────────────────────────────────────────

  /** GET /projects/:projectId — Get project (member+) */
  @Get('projects/:projectId')
  @UseGuards(JwtAuthGuard, ProjectViewerGuard)
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
  ): Promise<ProjectDto> {
    return this.projects.getById(user.userId, projectId)
  }

  /** PATCH /projects/:projectId — Update project (owner only) */
  @Patch('projects/:projectId')
  @UseGuards(JwtAuthGuard, ProjectOwnerGuard)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Body() body: UpdateProjectDto,
  ): Promise<ProjectDto> {
    return this.projects.update(user.userId, projectId, body)
  }

  /** DELETE /projects/:projectId — Archive project (owner only) */
  @Delete('projects/:projectId')
  @UseGuards(JwtAuthGuard, ProjectOwnerGuard)
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
  ): Promise<ProjectDto> {
    return this.projects.archive(user.userId, projectId)
  }

  // ── Project member routes ─────────────────────────────────────────────

  /** POST /projects/:projectId/members — Add member (owner only) */
  @Post('projects/:projectId/members')
  @UseGuards(JwtAuthGuard, ProjectOwnerGuard)
  @HttpCode(HttpStatus.CREATED)
  addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Body() body: AddProjectMemberDto,
  ): Promise<ProjectMemberDto> {
    return this.projects.addMember(user.userId, projectId, body)
  }

  /** GET /projects/:projectId/members — List members (member+) */
  @Get('projects/:projectId/members')
  @UseGuards(JwtAuthGuard, ProjectViewerGuard)
  listMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
  ): Promise<ProjectMemberDto[]> {
    return this.projects.listMembers(user.userId, projectId)
  }

  /** PATCH /projects/:projectId/members/:userId — Update role (owner only) */
  @Patch('projects/:projectId/members/:userId')
  @UseGuards(JwtAuthGuard, ProjectOwnerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  updateMemberRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('userId') targetUserId: string,
    @Body() body: UpdateProjectMemberRoleDto,
  ): Promise<void> {
    return this.projects.updateMemberRole(user.userId, projectId, targetUserId, body)
  }

  /** DELETE /projects/:projectId/members/:userId — Remove member (owner only) */
  @Delete('projects/:projectId/members/:userId')
  @UseGuards(JwtAuthGuard, ProjectOwnerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Param('userId') targetUserId: string,
  ): Promise<void> {
    return this.projects.removeMember(user.userId, projectId, targetUserId)
  }
}
```

- [ ] **Step 6: Create `projects.module.ts`**

Create `/Users/omwani/Dev/BramhaV2/apps/api/src/modules/projects/projects.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { OrgMemberGuard } from '../common/guards/org-role.guard'
import {
  ProjectViewerGuard,
  ProjectOwnerGuard,
} from '../common/guards/project-member.guard'
import { ProjectsService } from './projects.service'
import { ProjectsController } from './projects.controller'

@Module({
  imports: [AuthModule],
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    OrgMemberGuard,
    ProjectViewerGuard,
    ProjectOwnerGuard,
  ],
  exports: [ProjectsService],
})
export class ProjectsModule {}
```

- [ ] **Step 7: Typecheck**

```bash
cd /Users/omwani/Dev/BramhaV2 && pnpm turbo run typecheck --filter @bramha/api
```

Expected: no errors.

- [ ] **Step 8: Run all tests**

```bash
cd /Users/omwani/Dev/BramhaV2 && pnpm turbo run test --filter @bramha/api 2>&1 | tail -30
```

Expected: All spec files pass.

- [ ] **Step 9: Commit**

```bash
cd /Users/omwani/Dev/BramhaV2 && git add apps/api/src/modules/projects/ && git commit -m "feat(api): add ProjectsModule with CRUD, membership management, and role guards"
```

---

## Task 7: Wire Modules into `AppModule`

**Files:**
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Update `app.module.ts`**

Replace the imports section and `@Module` decorator in `/Users/omwani/Dev/BramhaV2/apps/api/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { LoggerModule } from 'nestjs-pino'
import { HealthModule } from './modules/health/health.module'
import { AuthModule } from './modules/auth/auth.module'
import { DbModule } from './modules/common/db/db.module'
import { UsersModule } from './modules/users/users.module'
import { OrgsModule } from './modules/orgs/orgs.module'
import { ProjectsModule } from './modules/projects/projects.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env['LOG_LEVEL'] ?? 'info',
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            '*.password',
            '*.passwordHash',
            '*.password_hash',
            '*.token',
            '*.refreshToken',
            '*.accessToken',
            '*.secret',
          ],
          censor: '[REDACTED]',
        },
        ...(process.env['NODE_ENV'] !== 'production'
          ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
          : {}),
      },
    }),
    HealthModule,
    AuthModule,
    DbModule,
    UsersModule,
    OrgsModule,
    ProjectsModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Typecheck the full API**

```bash
cd /Users/omwani/Dev/BramhaV2 && pnpm turbo run typecheck --filter @bramha/api
```

Expected: no errors.

- [ ] **Step 3: Run all tests**

```bash
cd /Users/omwani/Dev/BramhaV2 && pnpm turbo run test --filter @bramha/api 2>&1 | tail -30
```

Expected: all tests pass, no regressions.

- [ ] **Step 4: Commit**

```bash
cd /Users/omwani/Dev/BramhaV2 && git add apps/api/src/app.module.ts && git commit -m "feat(api): wire DbModule, UsersModule, OrgsModule, ProjectsModule into AppModule"
```

---

## Task 8: Full Verification Pass

- [ ] **Step 1: Typecheck both packages**

```bash
cd /Users/omwani/Dev/BramhaV2 && pnpm turbo run typecheck --filter @bramha/api --filter @bramha/shared
```

Expected: `Tasks: 2 successful, 0 failed`

- [ ] **Step 2: Lint both packages**

```bash
cd /Users/omwani/Dev/BramhaV2 && pnpm turbo run lint --filter @bramha/api --filter @bramha/shared
```

Expected: no lint errors. If there are unused-import warnings from guards, add `// eslint-disable-next-line` or fix the imports.

- [ ] **Step 3: Run all tests**

```bash
cd /Users/omwani/Dev/BramhaV2 && pnpm turbo run test --filter @bramha/api --filter @bramha/shared
```

Expected: all tests pass.

- [ ] **Step 4: Build both packages**

```bash
cd /Users/omwani/Dev/BramhaV2 && pnpm turbo run build --filter @bramha/api --filter @bramha/shared
```

Expected: build succeeds.

- [ ] **Step 5: Final commit**

```bash
cd /Users/omwani/Dev/BramhaV2 && git add apps/api/ packages/shared/ && git commit -m "feat: add users, orgs, projects, memberships CRUD with RLS and role guards (T1.3.4)"
```

---

## Security Checklist (self-verify before done)

| Requirement | Where enforced |
|---|---|
| IDOR: outsider gets 404 | `OrgsService.update/delete`, `ProjectsService.getById/archive` — `NotFoundException` when no membership row returned |
| Role escalation blocked | `OrgsService.updateMemberRole`: member → ForbiddenException; admin cannot grant owner |
| Last-owner removal blocked | `OrgsService.removeMember`, `ProjectsService.removeMember`: counts owner rows before delete |
| RLS everywhere | All queries wrapped in `this.db.run({ userId }, fn)` → `withTenant` sets GUCs |
| Mutations audited | Each mutating service method calls `this.logger.log({ event, actorId, targetId, action })` |

---

## Common Pitfalls

1. **Mixin guard DI**: The `mixin()` function returns a new class each call. The exported constants (`OrgAdminGuard = createOrgRoleGuard('admin')`) ensure the same class is used in both `@UseGuards()` and `providers[]` arrays.

2. **`@bramha/db` in tests**: Every spec file that imports a service depending on `RlsDbService` must start with `vi.mock('@bramha/db', ...)`. Vitest hoists `vi.mock` calls before imports — this prevents the real postgres client from initializing.

3. **`makeTx` ordering**: The `makeTx` helper increments `call` on each invocation. The order of expected results must match the exact order of `tx\`...\`` calls within the service method under test.

4. **`CreateProjectInputSchema` has `orgId`** in the existing shared schema. The controller takes `orgId` from `@Param('orgId')` and passes it to the service separately — don't rely on `body.orgId` being present in the DTO since the shared schema includes it but the controller injects it from the route.
