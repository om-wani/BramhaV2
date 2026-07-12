/**
 * Migration runner for hand-written raw SQL migrations.
 *
 * drizzle-kit migrate cannot apply these — it requires its own generated
 * meta/_journal.json, which hand-authored SQL files don't have. This runner
 * applies src/migrations/*.sql in filename order, records each in a
 * _migrations bookkeeping table, and skips already-applied files, so it is
 * idempotent and safe to run on every boot.
 *
 * Run as a role that may run DDL (bramha_migrator, or the dev superuser):
 *   DATABASE_URL=postgresql://... pnpm --filter @bramha/db db:migrate
 */

import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'migrations')

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('DATABASE_URL environment variable is required')

  const sql = postgres(url, { max: 1, onnotice: () => {} })

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `

    const applied = new Set(
      (await sql<Array<{ name: string }>>`SELECT name FROM _migrations`).map((r) => r.name),
    )

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    let ran = 0
    for (const file of files) {
      if (applied.has(file)) continue
      const body = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8')
      await sql.begin(async (tx) => {
        await tx.unsafe(body)
        await tx`INSERT INTO _migrations (name) VALUES (${file})`
      })
      console.log(`applied ${file}`)
      ran++
    }

    console.log(ran === 0 ? `up to date (${files.length} migrations)` : `done (${ran} applied)`)
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  console.error('migration failed:', err)
  process.exit(1)
})
