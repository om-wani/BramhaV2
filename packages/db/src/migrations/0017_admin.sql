-- Migration: 0017_admin
-- Adds audit_log (append-only admin action log), token_usage_daily materialized
-- view for charts, requires_approval column on mcp_grants, and admin bypass RLS
-- policies that fire when app.is_admin GUC is set to 'true'.

-- -------------------------------------------------------------------------
-- ADD requires_approval TO mcp_grants
-- -------------------------------------------------------------------------
ALTER TABLE mcp_grants
  ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN NOT NULL DEFAULT FALSE;

-- -------------------------------------------------------------------------
-- GRANT DELETE on recovery_codes for 2FA reset action
-- -------------------------------------------------------------------------
GRANT DELETE ON recovery_codes TO bramha_app;

-- -------------------------------------------------------------------------
-- AUDIT_LOG  (not RLS-protected — admin reads across tenants by design)
-- Only INSERT is granted to bramha_app; no UPDATE, no DELETE (append-only).
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid        REFERENCES users(id) ON DELETE SET NULL,
  action      text        NOT NULL,
  target_type text        NOT NULL,
  target_id   text        NOT NULL,
  project_id  uuid        REFERENCES projects(id) ON DELETE SET NULL,
  payload     jsonb       NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor   ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action  ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);

-- Append-only: SELECT + INSERT only. No UPDATE, no DELETE for bramha_app.
GRANT SELECT, INSERT ON audit_log TO bramha_app;
GRANT ALL PRIVILEGES ON audit_log TO bramha_migrator;

-- -------------------------------------------------------------------------
-- TOKEN_USAGE_DAILY  (materialized view for token spend charts)
-- Refreshed manually (REFRESH MATERIALIZED VIEW token_usage_daily).
-- -------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS token_usage_daily AS
  SELECT
    project_id,
    persona_id,
    model,
    DATE_TRUNC('day', created_at)  AS day,
    SUM(input_tokens)              AS input_tokens,
    SUM(output_tokens)             AS output_tokens,
    SUM(estimated_usd)             AS cost_usd
  FROM  token_usage
  GROUP BY project_id, persona_id, model, DATE_TRUNC('day', created_at);

-- Non-concurrent index (no UNIQUE on nullable persona_id to avoid NULL confusion)
CREATE INDEX IF NOT EXISTS idx_token_usage_daily_project
  ON token_usage_daily(project_id, day DESC);

GRANT SELECT ON token_usage_daily TO bramha_app;
GRANT ALL PRIVILEGES ON token_usage_daily TO bramha_migrator;

-- -------------------------------------------------------------------------
-- ADMIN BYPASS RLS POLICIES
-- These PERMISSIVE policies fire when the admin service sets
--   SET LOCAL app.is_admin = 'true'
-- Combined with existing tenant-isolation policies via OR logic.
-- -------------------------------------------------------------------------

-- users: admin can read/write all users (for user management)
DROP POLICY IF EXISTS users_admin_bypass ON users;
CREATE POLICY users_admin_bypass ON users
  AS PERMISSIVE FOR ALL TO bramha_app
  USING      (current_setting('app.is_admin', TRUE) = 'true')
  WITH CHECK (current_setting('app.is_admin', TRUE) = 'true');

-- agent_personas: admin can edit system prompts on all personas (including global)
DROP POLICY IF EXISTS agent_personas_admin_bypass ON agent_personas;
CREATE POLICY agent_personas_admin_bypass ON agent_personas
  AS PERMISSIVE FOR ALL TO bramha_app
  USING      (current_setting('app.is_admin', TRUE) = 'true')
  WITH CHECK (current_setting('app.is_admin', TRUE) = 'true');

-- agent_model_policies: admin can update model configs for any persona
DROP POLICY IF EXISTS agent_model_policies_admin_bypass ON agent_model_policies;
CREATE POLICY agent_model_policies_admin_bypass ON agent_model_policies
  AS PERMISSIVE FOR ALL TO bramha_app
  USING      (current_setting('app.is_admin', TRUE) = 'true')
  WITH CHECK (current_setting('app.is_admin', TRUE) = 'true');

-- mcp_connectors: admin can view all connectors (global + project-scoped)
DROP POLICY IF EXISTS mcp_connectors_admin_bypass ON mcp_connectors;
CREATE POLICY mcp_connectors_admin_bypass ON mcp_connectors
  AS PERMISSIVE FOR ALL TO bramha_app
  USING      (current_setting('app.is_admin', TRUE) = 'true')
  WITH CHECK (current_setting('app.is_admin', TRUE) = 'true');

-- mcp_grants: admin can manage grants across all projects
DROP POLICY IF EXISTS mcp_grants_admin_bypass ON mcp_grants;
CREATE POLICY mcp_grants_admin_bypass ON mcp_grants
  AS PERMISSIVE FOR ALL TO bramha_app
  USING      (current_setting('app.is_admin', TRUE) = 'true')
  WITH CHECK (current_setting('app.is_admin', TRUE) = 'true');
