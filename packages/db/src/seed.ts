#!/usr/bin/env tsx
// Dev-only seed. Idempotent via ON CONFLICT DO NOTHING.
// WARNING: Never run against production.

import postgres from 'postgres'
import { pathToFileURL } from 'url'

// ---------------------------------------------------------------------------
// Fixture data — exported so seed.test.ts can import and validate them
// ---------------------------------------------------------------------------

export const FIXTURE_USERS = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'alice@dev.local',
    display_name: 'Alice Dev',
    status: 'active',
    is_admin: true,
    password_hash: '$argon2id$v=19$m=19456,t=2,p=1$dev_seed_placeholder',
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    email: 'bob@dev.local',
    display_name: 'Bob Dev',
    status: 'active',
    is_admin: false,
    password_hash: '$argon2id$v=19$m=19456,t=2,p=1$dev_seed_placeholder',
  },
] as const

export const FIXTURE_ORGS = [
  {
    id: '00000000-0000-0000-0001-000000000001',
    name: 'Dev Org',
    slug: 'dev-org',
    owner_id: '00000000-0000-0000-0000-000000000001',
  },
] as const

export const FIXTURE_ORG_MEMBERS = [
  {
    org_id: '00000000-0000-0000-0001-000000000001',
    user_id: '00000000-0000-0000-0000-000000000001',
    role: 'owner',
  },
  {
    org_id: '00000000-0000-0000-0001-000000000001',
    user_id: '00000000-0000-0000-0000-000000000002',
    role: 'member',
  },
] as const

export const FIXTURE_PROJECTS = [
  {
    id: '00000000-0000-0000-0002-000000000001',
    org_id: '00000000-0000-0000-0001-000000000001',
    name: 'Alpha Project',
    description: 'First dev fixture project',
  },
  {
    id: '00000000-0000-0000-0002-000000000002',
    org_id: '00000000-0000-0000-0001-000000000001',
    name: 'Beta Project',
    description: 'Second dev fixture project',
  },
] as const

export const FIXTURE_PROJECT_MEMBERS = [
  {
    project_id: '00000000-0000-0000-0002-000000000001',
    user_id: '00000000-0000-0000-0000-000000000001',
    role: 'owner',
  },
  {
    project_id: '00000000-0000-0000-0002-000000000002',
    user_id: '00000000-0000-0000-0000-000000000001',
    role: 'owner',
  },
  {
    project_id: '00000000-0000-0000-0002-000000000001',
    user_id: '00000000-0000-0000-0000-000000000002',
    role: 'editor',
  },
] as const

// ---------------------------------------------------------------------------
// Main — actual DB writes
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const dbUrl = process.env['DATABASE_URL']
  if (!dbUrl) throw new Error('DATABASE_URL environment variable is required')

  // Connect directly as whatever role DATABASE_URL provides (superuser/admin for local dev)
  // Do NOT use withTenant — that is for app code subject to RLS
  const sql = postgres(dbUrl, { max: 1 })

  try {
    // --- Users ---
    for (const user of FIXTURE_USERS) {
      const result = await sql`
        INSERT INTO users (id, email, display_name, status, is_admin, password_hash)
        VALUES (
          ${user.id},
          ${user.email},
          ${user.display_name},
          ${user.status},
          ${user.is_admin},
          ${user.password_hash}
        )
        ON CONFLICT DO NOTHING
      `
      const inserted = result.count
      console.log(`users  [${user.email}]: ${inserted > 0 ? `inserted` : `skipped (already exists)`}`)
    }

    // --- Orgs ---
    for (const org of FIXTURE_ORGS) {
      const result = await sql`
        INSERT INTO orgs (id, name, slug, owner_id)
        VALUES (
          ${org.id},
          ${org.name},
          ${org.slug},
          ${org.owner_id}
        )
        ON CONFLICT DO NOTHING
      `
      const inserted = result.count
      console.log(`orgs   [${org.slug}]: ${inserted > 0 ? `inserted` : `skipped (already exists)`}`)
    }

    // --- Org members ---
    for (const member of FIXTURE_ORG_MEMBERS) {
      const result = await sql`
        INSERT INTO org_members (org_id, user_id, role)
        VALUES (
          ${member.org_id},
          ${member.user_id},
          ${member.role}
        )
        ON CONFLICT DO NOTHING
      `
      const inserted = result.count
      console.log(
        `org_members [org=${member.org_id} user=${member.user_id}]: ${inserted > 0 ? `inserted` : `skipped (already exists)`}`,
      )
    }

    // --- Projects ---
    for (const project of FIXTURE_PROJECTS) {
      const result = await sql`
        INSERT INTO projects (id, org_id, name, description)
        VALUES (
          ${project.id},
          ${project.org_id},
          ${project.name},
          ${project.description}
        )
        ON CONFLICT DO NOTHING
      `
      const inserted = result.count
      console.log(
        `projects [${project.name}]: ${inserted > 0 ? `inserted` : `skipped (already exists)`}`,
      )
    }

    // --- Project members ---
    for (const member of FIXTURE_PROJECT_MEMBERS) {
      const result = await sql`
        INSERT INTO project_members (project_id, user_id, role)
        VALUES (
          ${member.project_id},
          ${member.user_id},
          ${member.role}
        )
        ON CONFLICT DO NOTHING
      `
      const inserted = result.count
      console.log(
        `project_members [project=${member.project_id} user=${member.user_id}]: ${inserted > 0 ? `inserted` : `skipped (already exists)`}`,
      )
    }

    console.log('\nSeed complete.')
  } finally {
    await sql.end()
  }
}

// Only run when executed directly, not when imported for tests
if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
