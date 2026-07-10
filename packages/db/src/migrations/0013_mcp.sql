-- Migration: 0013_mcp
-- Adds mcp_connectors and mcp_grants tables.
-- Depends on: 0001 (projects), 0011 (agent_personas)

-- -------------------------------------------------------------------------
-- MCP_CONNECTORS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_connectors (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID REFERENCES projects(id) ON DELETE CASCADE,  -- NULL = global/system
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  manifest     JSONB NOT NULL,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, slug)
);

ALTER TABLE mcp_connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_connectors FORCE ROW LEVEL SECURITY;

-- SELECT: project-scoped rows OR global (null project_id) rows
DROP POLICY IF EXISTS mcp_connectors_select ON mcp_connectors;
CREATE POLICY mcp_connectors_select ON mcp_connectors FOR SELECT TO bramha_app
  USING (
    project_id = NULLIF(current_setting('app.project_id', TRUE), '')::uuid
    OR project_id IS NULL
  );

-- ALL (INSERT/UPDATE/DELETE): only project-scoped rows
DROP POLICY IF EXISTS mcp_connectors_all ON mcp_connectors;
CREATE POLICY mcp_connectors_all ON mcp_connectors FOR ALL TO bramha_app
  USING  (project_id = NULLIF(current_setting('app.project_id', TRUE), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.project_id', TRUE), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_connectors TO bramha_app;
GRANT ALL PRIVILEGES ON mcp_connectors TO bramha_migrator;

-- -------------------------------------------------------------------------
-- MCP_GRANTS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_grants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id)         ON DELETE CASCADE,
  persona_id    UUID NOT NULL REFERENCES agent_personas(id)   ON DELETE CASCADE,
  connector_id  UUID NOT NULL REFERENCES mcp_connectors(id)   ON DELETE CASCADE,
  allowed_scopes TEXT[] NOT NULL,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, persona_id, connector_id)
);

ALTER TABLE mcp_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_grants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mcp_grants_all ON mcp_grants;
CREATE POLICY mcp_grants_all ON mcp_grants FOR ALL TO bramha_app
  USING  (project_id = NULLIF(current_setting('app.project_id', TRUE), '')::uuid)
  WITH CHECK (project_id = NULLIF(current_setting('app.project_id', TRUE), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_grants TO bramha_app;
GRANT ALL PRIVILEGES ON mcp_grants TO bramha_migrator;

-- -------------------------------------------------------------------------
-- INDEXES
-- -------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_mcp_connectors_project_id
  ON mcp_connectors (project_id)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mcp_grants_project_connector
  ON mcp_grants (project_id, connector_id);

CREATE INDEX IF NOT EXISTS idx_mcp_grants_persona_connector
  ON mcp_grants (persona_id, connector_id);
