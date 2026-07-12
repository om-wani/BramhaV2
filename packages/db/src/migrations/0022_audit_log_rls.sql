-- Migration: 0022_audit_log_rls
--
-- audit_log had GRANT SELECT to bramha_app (0017) but NO row-level security:
-- any authenticated app connection could read the entire cross-tenant audit
-- trail (user ids, actions, resource ids). Caught by the tenant-probe
-- schema-coverage guard once the suite ran against a live database.
--
-- Policy: inserts are open to the app role (audit writes must never fail);
-- reads are admin-only via the app.is_admin GUC (0017 withAdmin pattern).

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_insert ON audit_log;
CREATE POLICY audit_log_insert ON audit_log
  AS PERMISSIVE FOR INSERT TO bramha_app
  WITH CHECK (true);

DROP POLICY IF EXISTS audit_log_admin_read ON audit_log;
CREATE POLICY audit_log_admin_read ON audit_log
  AS PERMISSIVE FOR SELECT TO bramha_app
  USING (current_setting('app.is_admin', TRUE) = 'true');
