-- Migration: 0021_graph_checkpoints_tenancy
--
-- graph_checkpoints had only an "authenticated" RLS policy (0012) — any
-- logged-in user could read EVERY tenant's checkpoints. Checkpoint bytea is
-- serialized LangGraph state containing conversation content, so this was a
-- cross-tenant data exposure (caught by the tenant-probe suite run live).
--
-- Fix: add project_id and scope the policy through project membership.
-- Existing rows can't be attributed to a project → left NULL → invisible to
-- bramha_app (they're ephemeral by design; housekeeping deletes them anyway).

ALTER TABLE graph_checkpoints ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_graph_checkpoints_project ON graph_checkpoints (project_id);

DROP POLICY IF EXISTS graph_checkpoints_authenticated ON graph_checkpoints;
CREATE POLICY graph_checkpoints_tenant ON graph_checkpoints
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (project_id IN (SELECT current_user_project_ids()))
  WITH CHECK (project_id IN (SELECT current_user_project_ids()));
