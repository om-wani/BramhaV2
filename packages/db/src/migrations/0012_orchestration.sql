-- Migration: 0012_orchestration
-- Adds agent_working_memory, graph_checkpoints, delegations, approvals tables.
-- Depends on: 0001 (projects, users), 0006 (conversations, conversation_nodes), 0011 (agent_personas)

-- -------------------------------------------------------------------------
-- AGENT_WORKING_MEMORY
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_working_memory (
  persona_id       uuid NOT NULL REFERENCES agent_personas(id)      ON DELETE CASCADE,
  conversation_id  uuid NOT NULL REFERENCES conversations(id)       ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES projects(id)            ON DELETE CASCADE,
  facts            jsonb NOT NULL DEFAULT '[]',    -- [{text, source_node, confidence, ts}]
  open_loops       jsonb NOT NULL DEFAULT '[]',    -- [{id, text, created_at, closed_at?}]
  last_summary_node uuid REFERENCES conversation_nodes(id)          ON DELETE SET NULL,
  summary_md       text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (persona_id, conversation_id)
);

ALTER TABLE agent_working_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_working_memory FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_working_memory_tenant ON agent_working_memory;
CREATE POLICY agent_working_memory_tenant ON agent_working_memory
  USING (
    project_id IN (
      SELECT project_id FROM project_members
      WHERE user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM project_members
      WHERE user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    )
  );

GRANT SELECT, INSERT, UPDATE ON agent_working_memory TO bramha_app;
GRANT ALL PRIVILEGES ON agent_working_memory TO bramha_migrator;

-- -------------------------------------------------------------------------
-- GRAPH_CHECKPOINTS
-- thread_id format: '{conversationId}:{branchId}:{personaId}:{turnId}'
-- No project_id — access allowed for any authenticated app user;
-- project-level authorization is enforced by the application layer.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS graph_checkpoints (
  thread_id   text PRIMARY KEY,
  checkpoint  bytea NOT NULL,
  metadata    jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE graph_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_checkpoints FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS graph_checkpoints_authenticated ON graph_checkpoints;
CREATE POLICY graph_checkpoints_authenticated ON graph_checkpoints
  USING     (NULLIF(current_setting('app.user_id', TRUE), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.user_id', TRUE), '') IS NOT NULL);

GRANT SELECT, INSERT, UPDATE ON graph_checkpoints TO bramha_app;
GRANT ALL PRIVILEGES ON graph_checkpoints TO bramha_migrator;

-- -------------------------------------------------------------------------
-- DELEGATIONS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delegations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects(id)           ON DELETE CASCADE,
  group_id          uuid NOT NULL,
  parent_persona_id uuid REFERENCES agent_personas(id)              ON DELETE SET NULL,
  worker_persona_id uuid REFERENCES agent_personas(id)              ON DELETE SET NULL,
  origin_node_id    uuid REFERENCES conversation_nodes(id)          ON DELETE SET NULL,
  spec              jsonb NOT NULL,
  budget            jsonb NOT NULL,
  status            text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','waiting_approval','completed','failed','cancelled','timeout')),
  result            jsonb,
  started_at        timestamptz,
  finished_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE delegations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS delegations_tenant ON delegations;
CREATE POLICY delegations_tenant ON delegations
  USING (
    project_id IN (
      SELECT project_id FROM project_members
      WHERE user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM project_members
      WHERE user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    )
  );

GRANT SELECT, INSERT, UPDATE ON delegations TO bramha_app;
GRANT ALL PRIVILEGES ON delegations TO bramha_migrator;

-- -------------------------------------------------------------------------
-- APPROVALS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approvals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid NOT NULL REFERENCES projects(id)        ON DELETE CASCADE,
  requested_by_persona uuid NOT NULL,
  delegation_id        uuid REFERENCES delegations(id)              ON DELETE SET NULL,
  action_summary       text NOT NULL,
  payload_hash         text NOT NULL,
  status               text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','denied','expired')),
  decided_by           uuid REFERENCES users(id)                    ON DELETE SET NULL,
  decided_at           timestamptz,
  expires_at           timestamptz NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS approvals_tenant ON approvals;
CREATE POLICY approvals_tenant ON approvals
  USING (
    project_id IN (
      SELECT project_id FROM project_members
      WHERE user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM project_members
      WHERE user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    )
  );

GRANT SELECT, INSERT, UPDATE ON approvals TO bramha_app;
GRANT ALL PRIVILEGES ON approvals TO bramha_migrator;

-- -------------------------------------------------------------------------
-- INDEXES
-- -------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_agent_working_memory_project_conversation
  ON agent_working_memory (project_id, conversation_id);

CREATE INDEX IF NOT EXISTS idx_delegations_project_id
  ON delegations (project_id);

CREATE INDEX IF NOT EXISTS idx_approvals_project_id
  ON approvals (project_id);

CREATE INDEX IF NOT EXISTS idx_approvals_delegation_id
  ON approvals (delegation_id)
  WHERE delegation_id IS NOT NULL;
