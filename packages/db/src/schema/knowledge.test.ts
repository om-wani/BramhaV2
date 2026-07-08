/**
 * knowledge.test.ts — migration verification tests.
 *
 * These are schema-verification tests that don't require a live DB.
 * They verify that the migration SQL contains expected index definitions.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const MIGRATION_PATH = join(__dirname, '../migrations/0009_knowledge.sql')

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, 'utf8')
}

describe('0009_knowledge.sql migration', () => {
  it('uses (project_id, origin) composite index on knowledge_chunks', () => {
    const sql = readMigration()
    expect(sql).toContain('idx_knowledge_chunks_project_origin')
    expect(sql).toContain('project_id, origin')
  })

  it('defines HNSW index on embedding column', () => {
    const sql = readMigration()
    expect(sql).toContain('hnsw')
    expect(sql).toContain('vector_cosine_ops')
    expect(sql).toContain('idx_knowledge_chunks_embedding')
  })

  it('enables pgvector extension', () => {
    const sql = readMigration()
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS vector')
  })

  it('enables RLS on all three tables', () => {
    const sql = readMigration()
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('FORCE  ROW LEVEL SECURITY')
  })

  it('defines UNIQUE constraint on (origin, origin_id, chunk_index)', () => {
    const sql = readMigration()
    expect(sql).toContain('UNIQUE (origin, origin_id, chunk_index)')
  })

  it('defines knowledge_chunks, knowledge_sources, and ingestion_jobs tables', () => {
    const sql = readMigration()
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS knowledge_chunks')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS knowledge_sources')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ingestion_jobs')
  })

  it('uses generated tsvector column for full-text search', () => {
    const sql = readMigration()
    expect(sql).toContain('GENERATED ALWAYS AS')
    expect(sql).toContain('to_tsvector')
    expect(sql).toContain('content_tsv')
  })

  it('grants DML to bramha_app role', () => {
    const sql = readMigration()
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE knowledge_chunks TO bramha_app')
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE knowledge_sources TO bramha_app')
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ingestion_jobs TO bramha_app')
  })

  it('uses DROP POLICY IF EXISTS before CREATE POLICY (idempotent)', () => {
    const sql = readMigration()
    expect(sql).toContain('DROP POLICY IF EXISTS knowledge_chunks_tenant')
    expect(sql).toContain('DROP POLICY IF EXISTS knowledge_sources_tenant')
    expect(sql).toContain('DROP POLICY IF EXISTS ingestion_jobs_tenant')
  })
})
