-- Migration: 0009_knowledge
-- Adds knowledge_sources, ingestion_jobs, and knowledge_chunks tables.
-- Requires pgvector extension for the vector(1536) embedding column.

-- -------------------------------------------------------------------------
-- PGVECTOR EXTENSION
-- -------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;

-- -------------------------------------------------------------------------
-- KNOWLEDGE_SOURCES
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_sources (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type              text        NOT NULL CHECK (type IN ('github_repo','gitlab_repo','sql_database','url','manual')),
  config            jsonb       NOT NULL DEFAULT '{}',
  credential_ref    text,
  sync_schedule     text,
  last_sync_at      timestamptz,
  last_sync_status  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER knowledge_sources_updated_at
  BEFORE UPDATE ON knowledge_sources
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_knowledge_sources_project_id ON knowledge_sources (project_id);

ALTER TABLE knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_sources FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_sources_tenant ON knowledge_sources;
CREATE POLICY knowledge_sources_tenant ON knowledge_sources
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (
    NULLIF(current_setting('app.user_id', TRUE), '')::uuid IS NOT NULL
    AND project_id IN (
      SELECT pm.project_id FROM project_members pm
       WHERE pm.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE knowledge_sources TO bramha_app;
GRANT ALL PRIVILEGES ON TABLE knowledge_sources TO bramha_migrator;

-- -------------------------------------------------------------------------
-- INGESTION_JOBS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind        text    NOT NULL CHECK (kind IN ('file','source_sync','note_delta')),
  file_id     uuid    REFERENCES files(id) ON DELETE SET NULL,
  source_id   uuid    REFERENCES knowledge_sources(id) ON DELETE SET NULL,
  note_id     uuid,
  status      text    NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','security_gate','extracting','chunking','embedding','done','failed','quarantined')),
  stats       jsonb,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER ingestion_jobs_updated_at
  BEFORE UPDATE ON ingestion_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_project_id ON ingestion_jobs (project_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_file_id    ON ingestion_jobs (file_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status     ON ingestion_jobs (status);

ALTER TABLE ingestion_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_jobs FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ingestion_jobs_tenant ON ingestion_jobs;
CREATE POLICY ingestion_jobs_tenant ON ingestion_jobs
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (
    NULLIF(current_setting('app.user_id', TRUE), '')::uuid IS NOT NULL
    AND project_id IN (
      SELECT pm.project_id FROM project_members pm
       WHERE pm.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ingestion_jobs TO bramha_app;
GRANT ALL PRIVILEGES ON TABLE ingestion_jobs TO bramha_migrator;

-- -------------------------------------------------------------------------
-- KNOWLEDGE_CHUNKS  (the vector store)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  origin        text        NOT NULL CHECK (origin IN ('upload','source','ceo_office','conversation_summary','artifact')),
  origin_id     uuid        NOT NULL,
  chunk_index   int         NOT NULL,
  heading_trail text[]      NOT NULL DEFAULT '{}',
  content       text        NOT NULL,
  content_tsv   tsvector    GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  embedding     vector(1536),
  token_count   int         NOT NULL,
  stale         boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (origin, origin_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_project_origin
  ON knowledge_chunks (project_id, origin);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_content_tsv
  ON knowledge_chunks USING GIN (content_tsv);

-- HNSW index for fast cosine-similarity search (only on active, embedded rows)
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding
  ON knowledge_chunks
  USING hnsw (embedding vector_cosine_ops)
  WHERE NOT stale AND embedding IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_origin_id
  ON knowledge_chunks (origin_id, chunk_index);

ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_chunks_tenant ON knowledge_chunks;
CREATE POLICY knowledge_chunks_tenant ON knowledge_chunks
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (
    NULLIF(current_setting('app.user_id', TRUE), '')::uuid IS NOT NULL
    AND project_id IN (
      SELECT pm.project_id FROM project_members pm
       WHERE pm.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE knowledge_chunks TO bramha_app;
GRANT ALL PRIVILEGES ON TABLE knowledge_chunks TO bramha_migrator;
