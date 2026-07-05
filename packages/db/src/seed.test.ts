import { describe, it, expect } from 'vitest'
import {
  FIXTURE_USERS,
  FIXTURE_ORGS,
  FIXTURE_ORG_MEMBERS,
  FIXTURE_PROJECTS,
  FIXTURE_PROJECT_MEMBERS,
} from './seed.js'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('seed fixtures — structural validation (no DB required)', () => {
  // -------------------------------------------------------------------------
  // 1. All fixture IDs are valid UUIDs
  // -------------------------------------------------------------------------
  it('all user IDs are valid UUIDs', () => {
    for (const user of FIXTURE_USERS) {
      expect(user.id, `user ${user.email} id`).toMatch(UUID_REGEX)
    }
  })

  it('all org IDs are valid UUIDs', () => {
    for (const org of FIXTURE_ORGS) {
      expect(org.id, `org ${org.slug} id`).toMatch(UUID_REGEX)
    }
  })

  it('all project IDs are valid UUIDs', () => {
    for (const project of FIXTURE_PROJECTS) {
      expect(project.id, `project ${project.name} id`).toMatch(UUID_REGEX)
    }
  })

  it('all org_member foreign key IDs are valid UUIDs', () => {
    for (const member of FIXTURE_ORG_MEMBERS) {
      expect(member.org_id, `org_member org_id`).toMatch(UUID_REGEX)
      expect(member.user_id, `org_member user_id`).toMatch(UUID_REGEX)
    }
  })

  it('all project_member foreign key IDs are valid UUIDs', () => {
    for (const member of FIXTURE_PROJECT_MEMBERS) {
      expect(member.project_id, `project_member project_id`).toMatch(UUID_REGEX)
      expect(member.user_id, `project_member user_id`).toMatch(UUID_REGEX)
    }
  })

  // -------------------------------------------------------------------------
  // 2. All fixture emails are lowercase
  // -------------------------------------------------------------------------
  it('all user emails are lowercase', () => {
    for (const user of FIXTURE_USERS) {
      expect(user.email, `user ${user.id} email`).toBe(user.email.toLowerCase())
    }
  })

  // -------------------------------------------------------------------------
  // 3. No duplicate IDs across users, orgs, projects
  // -------------------------------------------------------------------------
  it('no duplicate user IDs', () => {
    const ids = FIXTURE_USERS.map((u) => u.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('no duplicate org IDs', () => {
    const ids = FIXTURE_ORGS.map((o) => o.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('no duplicate project IDs', () => {
    const ids = FIXTURE_PROJECTS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // -------------------------------------------------------------------------
  // 4. Org owner_id references a known user ID
  // -------------------------------------------------------------------------
  it('org owner_id references a known user', () => {
    const userIds = new Set(FIXTURE_USERS.map((u) => u.id))
    for (const org of FIXTURE_ORGS) {
      expect(userIds.has(org.owner_id), `org ${org.slug} owner_id ${org.owner_id}`).toBe(true)
    }
  })

  // -------------------------------------------------------------------------
  // 5. All org_member user_ids reference known user IDs
  // -------------------------------------------------------------------------
  it('all org_member user_ids reference known users', () => {
    const userIds = new Set(FIXTURE_USERS.map((u) => u.id))
    for (const member of FIXTURE_ORG_MEMBERS) {
      expect(userIds.has(member.user_id), `org_member user_id ${member.user_id}`).toBe(true)
    }
  })

  // -------------------------------------------------------------------------
  // 5b. All org_member org_ids reference known org IDs
  // -------------------------------------------------------------------------
  it('all org_member org_ids reference known orgs', () => {
    const orgIds = new Set(FIXTURE_ORGS.map((o) => o.id))
    for (const member of FIXTURE_ORG_MEMBERS) {
      expect(orgIds.has(member.org_id), `org_member org_id ${member.org_id}`).toBe(true)
    }
  })

  // -------------------------------------------------------------------------
  // 6. All project_member user_ids and project_ids reference known IDs
  // -------------------------------------------------------------------------
  it('all project_member user_ids reference known users', () => {
    const userIds = new Set(FIXTURE_USERS.map((u) => u.id))
    for (const member of FIXTURE_PROJECT_MEMBERS) {
      expect(userIds.has(member.user_id), `project_member user_id ${member.user_id}`).toBe(true)
    }
  })

  it('all project_member project_ids reference known projects', () => {
    const projectIds = new Set(FIXTURE_PROJECTS.map((p) => p.id))
    for (const member of FIXTURE_PROJECT_MEMBERS) {
      expect(
        projectIds.has(member.project_id),
        `project_member project_id ${member.project_id}`,
      ).toBe(true)
    }
  })
})
