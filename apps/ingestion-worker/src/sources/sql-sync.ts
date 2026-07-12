/**
 * SQL Database sync strategy.
 *
 * Introspects schema via information_schema, samples up to 5 rows per table,
 * formats as text, then chunks and embeds.
 *
 * Security:
 *   - Read-only transaction only
 *   - Statement timeout: 5 seconds per query
 *   - Raw connection string NEVER logged
 *   - 5-row sample max per table
 */
import postgres from 'postgres'
import type { EmbeddingProvider } from '@bramha/agents'
import type postgres2 from 'postgres'
import { chunkSections } from '../chunking.js'
import { embedChunks } from '../embedder.js'
import { upsertKnowledgeChunks } from '../knowledge-writer.js'

// ── Interface ─────────────────────────────────────────────────────────────────

export interface SqlSyncConfig {
  host: string
  port?: number
  database: string
  username: string
}

export interface SqlSyncDeps {
  sql: postgres2.Sql
  embeddingProvider: EmbeddingProvider
}

export interface SqlSyncResult {
  tableCount: number
  chunkCount: number
  tokenTotal: number
}

// ── Row types ─────────────────────────────────────────────────────────────────

interface TableRow {
  table_name: string
}

interface ColumnRow {
  column_name: string
  data_type: string
}

// ── Main sync function ────────────────────────────────────────────────────────

export async function syncSqlDatabase(
  projectId: string,
  sourceId: string,
  config: SqlSyncConfig,
  credential: string | null, // password
  deps: SqlSyncDeps,
): Promise<SqlSyncResult> {
  const { host, port = 5432, database, username } = config

  if (!host || !database || !username) {
    throw new Error('sql_config_incomplete: host, database, username required')
  }

  if (!credential) {
    throw new Error('sql_credential_required')
  }

  // Create a short-lived read-only connection
  // NEVER log the connection string
  const client = postgres({
    host,
    port,
    database,
    username,
    password: credential,
    // Read-only user enforced at DB level; also wrap each query in read-only tx
    connect_timeout: 10,
    idle_timeout: 30,
    max: 1,
    onnotice: () => undefined, // suppress notices
  })

  const sections: Array<{ headingTrail: string[]; text: string }> = []

  try {
    // Fetch table list in read-only tx with statement timeout
    const tableRows = await client.begin('READ ONLY', async (tx) => {
      await tx`SET LOCAL statement_timeout = '5s'`
      return tx<TableRow[]>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `
    })

    for (const { table_name } of tableRows) {
      // Fetch columns
      const columns = await client.begin('READ ONLY', async (tx) => {
        await tx`SET LOCAL statement_timeout = '5s'`
        return tx<ColumnRow[]>`
          SELECT column_name, data_type
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = ${table_name}
          ORDER BY ordinal_position
        `
      })

      const columnDesc = columns
        .map((c) => `${c.column_name} (${c.data_type})`)
        .join(', ')

      // Sample up to 5 rows
      let sampleText = ''
      try {
        const sampleRows = await client.begin('READ ONLY', async (tx) => {
          await tx`SET LOCAL statement_timeout = '5s'`
          // Dynamic table name: double-quote-escape the identifier. The source DB is
          // user-supplied (untrusted) — a hostile table name must not escape the quoting.
          return tx.unsafe(`SELECT * FROM "${table_name.replaceAll('"', '""')}" LIMIT 5`)
        })

        if (sampleRows.length > 0) {
          const rowLines = sampleRows.map((row, i) => {
            const values = Object.entries(row)
              .map(([k, v]) => `${k}: ${String(v).slice(0, 100)}`)
              .join(', ')
            return `  Row ${i + 1}: ${values}`
          })
          sampleText = `\nSample rows:\n${rowLines.join('\n')}`
        }
      } catch {
        // Sample failed — still include schema info
        sampleText = '\n(sample unavailable)'
      }

      const text = `Table: ${table_name}\nColumns: ${columnDesc}${sampleText}`
      sections.push({ headingTrail: [table_name], text })
    }
  } finally {
    await client.end()
  }

  if (sections.length === 0) {
    return { tableCount: 0, chunkCount: 0, tokenTotal: 0 }
  }

  const chunks = chunkSections(sections)
  const embedded = await embedChunks(chunks, deps.embeddingProvider)
  await upsertKnowledgeChunks({
    projectId,
    origin: 'source',
    originId: sourceId,
    chunks: embedded,
    sql: deps.sql,
  })

  const tokenTotal = chunks.reduce((s, c) => s + c.tokenCount, 0)

  return { tableCount: sections.length, chunkCount: embedded.length, tokenTotal }
}
