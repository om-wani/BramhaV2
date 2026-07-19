-- 0001_init.sql
-- Initial schema for BramhaV2 MVP
-- Authoritative for vector/tsvector columns that Drizzle cannot express.

-- pgcrypto omitted: gen_random_uuid() is built-in since PG 13 (works on PGlite + managed Postgres)
CREATE EXTENSION IF NOT EXISTS "vector";

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text        UNIQUE NOT NULL,
  name            text        NOT NULL,
  password_hash   text        NOT NULL,
  email_verified_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text        UNIQUE NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- orgs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orgs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  slug        text        UNIQUE NOT NULL,
  created_by  uuid        NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- org_members
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_members (
  org_id    uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id   uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      text        NOT NULL CHECK (role IN ('owner','admin','member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name                  text        NOT NULL,
  slug                  text        NOT NULL,
  description           text,
  working_memory        jsonb       NOT NULL DEFAULT '{}',
  proactive_pa_enabled  boolean     NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);

-- ---------------------------------------------------------------------------
-- project_members
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_members (
  project_id  uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text        NOT NULL CHECK (role IN ('owner','editor','viewer')),
  joined_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

-- ---------------------------------------------------------------------------
-- rooms  (main_branch_id is a plain uuid — no FK; forward ref to branches)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rooms (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  kind            text        NOT NULL CHECK (kind IN ('council','one_on_one')),
  persona         text,
  main_branch_id  uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- branches
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branches (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id             uuid        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  project_id          uuid        NOT NULL,
  name                text        NOT NULL,
  head_node_id        uuid,
  forked_from_node_id uuid,
  created_by          uuid        NOT NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- conversation_nodes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversation_nodes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     uuid        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  project_id  uuid        NOT NULL,
  parent_id   uuid        REFERENCES conversation_nodes(id),
  author_type text        NOT NULL CHECK (author_type IN ('user','agent','system')),
  user_id     uuid        REFERENCES users(id),
  persona     text,
  content     text        NOT NULL,
  metadata    jsonb       NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nodes_room    ON conversation_nodes(room_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent  ON conversation_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_project ON conversation_nodes(project_id);

-- ---------------------------------------------------------------------------
-- files
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS files (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid        NOT NULL,
  uploaded_by  uuid        NOT NULL REFERENCES users(id),
  filename     text        NOT NULL,
  mime_type    text        NOT NULL,
  size_bytes   bigint      NOT NULL,
  storage_path text        NOT NULL,
  status       text        NOT NULL CHECK (status IN ('pending','processing','ready','error')),
  error_msg    text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- file_chunks  (vector + tsvector authoritative here)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS file_chunks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id     uuid        NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  project_id  uuid        NOT NULL,
  chunk_index int         NOT NULL,
  content     text        NOT NULL,
  embedding   vector(1536),
  tsv         tsvector    GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chunks_file      ON file_chunks(file_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_chunks_tsv       ON file_chunks USING GIN(tsv);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON file_chunks USING hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- ingestion_jobs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id     uuid        NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  status      text        NOT NULL CHECK (status IN ('queued','running','done','failed')),
  attempt     int         NOT NULL DEFAULT 0,
  error_msg   text,
  queued_at   timestamptz NOT NULL DEFAULT now(),
  started_at  timestamptz,
  finished_at timestamptz
);

-- ---------------------------------------------------------------------------
-- delegation_tasks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delegation_tasks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         uuid        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL,
  source_node_id  uuid        NOT NULL,
  from_persona    text        NOT NULL,
  to_persona      text        NOT NULL,
  task            text        NOT NULL,
  status          text        NOT NULL CHECK (status IN ('pending','running','done','failed')),
  result_node_id  uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- model_calls
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS model_calls (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid        NOT NULL,
  room_id       uuid,
  persona       text,
  provider      text        NOT NULL,
  model         text        NOT NULL,
  purpose       text        NOT NULL CHECK (purpose IN ('turn','delegation','embedding','proactive')),
  input_tokens  int         NOT NULL,
  output_tokens int         NOT NULL,
  latency_ms    int         NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
