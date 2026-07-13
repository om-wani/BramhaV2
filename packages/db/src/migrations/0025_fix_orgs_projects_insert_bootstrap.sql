-- Migration: 0025_fix_orgs_projects_insert_bootstrap
--
-- orgs_isolation and projects_isolation (0001, repointed in 0020) are FOR ALL
-- policies whose USING clause also gates INSERT (same class of bug fixed for
-- `users` in 0019): a brand-new org/project can never satisfy "id IN (rows I'm
-- already a member of)", since no membership row can exist before the parent
-- row does. OrgsService.create()/ProjectsService.create() — the only
-- production insert paths — were broken from 0001 onward; never caught
-- because the tenant-probe fixtures seed via bramha_migrator (BYPASSRLS),
-- which never exercises the app-role INSERT path. Reproduced live.
--
-- Fix: extend each USING with the natural bootstrap condition —
-- orgs: the row's own owner_id is the acting user (mirrors org_members'
--   existing `user_id = app.user_id` self-row escape hatch).
-- projects: the acting user is a member of the project's parent org (projects
--   have no owner_id of their own; org membership is the authority that lets
--   someone spin up a project under that org).

DROP POLICY IF EXISTS orgs_isolation ON orgs;
CREATE POLICY orgs_isolation ON orgs
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (
    id IN (SELECT current_user_org_ids())
    OR owner_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
  );

DROP POLICY IF EXISTS projects_isolation ON projects;
CREATE POLICY projects_isolation ON projects
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (
    id IN (SELECT current_user_project_ids())
    OR org_id IN (SELECT current_user_org_ids())
  );
