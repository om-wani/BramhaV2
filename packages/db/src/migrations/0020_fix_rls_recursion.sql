-- Migration: 0020_fix_rls_recursion
--
-- The project_members and org_members policies from 0001 subselect their own
-- table, which Postgres rejects with 42P17 "infinite recursion detected in
-- policy". Because nearly every other tenant policy subselects project_members,
-- the recursion fires on ANY membership-scoped query by bramha_app — the whole
-- RLS layer was unusable at runtime (caught by the tenant-probe suite once it
-- was actually run against a live database).
--
-- Fix: SECURITY DEFINER lookup functions. They execute as this migration's
-- role (bramha_migrator with BYPASSRLS, or the dev superuser), so reading the
-- membership tables inside them does not re-trigger their policies.

CREATE OR REPLACE FUNCTION current_user_project_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT project_id FROM project_members
  WHERE user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
$$;

CREATE OR REPLACE FUNCTION current_user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT org_id FROM org_members
  WHERE user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
$$;

REVOKE ALL ON FUNCTION current_user_project_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION current_user_org_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_user_project_ids() TO bramha_app;
GRANT EXECUTE ON FUNCTION current_user_org_ids() TO bramha_app;

-- ── Replace the self-referencing policies ────────────────────────────────────

DROP POLICY IF EXISTS project_members_isolation ON project_members;
CREATE POLICY project_members_isolation ON project_members
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (
    user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    OR project_id IN (SELECT current_user_project_ids())
  );

DROP POLICY IF EXISTS org_members_isolation ON org_members;
CREATE POLICY org_members_isolation ON org_members
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (
    user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    OR org_id IN (SELECT current_user_org_ids())
  );

-- Orgs policy also subselects org_members (recursion via org_members policy).
-- Repoint it at the function for the same reason plus a planner win.
DROP POLICY IF EXISTS orgs_isolation ON orgs;
CREATE POLICY orgs_isolation ON orgs
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (id IN (SELECT current_user_org_ids()));

-- Projects policy subselects project_members — same repoint.
DROP POLICY IF EXISTS projects_isolation ON projects;
CREATE POLICY projects_isolation ON projects
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (id IN (SELECT current_user_project_ids()));
