-- Migration: 0026_system_agent
--
-- apps/agent-runtime requires a SYSTEM_USER_ID env var and runs every DB query
-- through withTenant({ userId: SYSTEM_USER_ID, projectId }) — the same RLS path
-- application code uses. No migration or seed ever created that user, and
-- there is no membership mechanism giving it access to any project, so
-- current_user_project_ids() (0020) returns empty for it and every
-- project-scoped RLS policy filters agent-runtime's queries to zero rows.
-- Agents boot cleanly (0.5 in the audit) but can never actually read personas,
-- conversation state, or working memory.
--
-- Fix: a reserved system_agent user (fixed UUID, no password — it never logs
-- in), auto-membership via an AFTER INSERT trigger on projects (SECURITY
-- DEFINER, so it isn't itself blocked by the project_members RLS bootstrap
-- check), plus a backfill for projects that already exist.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check
  CHECK (status IN ('active', 'suspended', 'system'));

ALTER TABLE project_members DROP CONSTRAINT IF EXISTS project_members_role_check;
ALTER TABLE project_members ADD CONSTRAINT project_members_role_check
  CHECK (role IN ('owner', 'editor', 'viewer', 'system'));

-- Reserved UUID — referenced by apps/agent-runtime's SYSTEM_USER_ID env var
-- (see scripts/bootstrap.sh). Never change once agents have run against it.
INSERT INTO users (id, email, display_name, status, is_admin)
VALUES (
  '00000000-0000-0000-0000-000000000099',
  'system-agent@bramha.internal',
  'System Agent',
  'system',
  false
)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION add_system_agent_to_new_project()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO project_members (project_id, user_id, role)
  VALUES (NEW.id, '00000000-0000-0000-0000-000000000099', 'system')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_add_system_agent ON projects;
CREATE TRIGGER projects_add_system_agent
  AFTER INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION add_system_agent_to_new_project();

-- Backfill: give the system agent membership in every project that already
-- exists (this migration itself runs BYPASSRLS, so no RLS concern here).
INSERT INTO project_members (project_id, user_id, role)
SELECT id, '00000000-0000-0000-0000-000000000099', 'system'
FROM projects
ON CONFLICT DO NOTHING;
