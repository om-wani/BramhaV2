-- Migration: 0008_files
-- Adds files table: presigned-upload file registry with scan status.
-- set_updated_at() trigger function is defined in 0001_identity_tenancy.sql.

-- -------------------------------------------------------------------------
-- FILES
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS files (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  uploaded_by     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id         uuid        REFERENCES rooms(id) ON DELETE SET NULL,
  name            text        NOT NULL,
  declared_mime   text        NOT NULL,
  detected_mime   text,
  size_bytes      bigint      NOT NULL,
  storage_key     text        NOT NULL,
  scan_status     text        NOT NULL DEFAULT 'pending'
                              CHECK (scan_status IN ('pending','scanning','clean','quarantined','failed')),
  scan_report     jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER files_updated_at
  BEFORE UPDATE ON files
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_files_project_id   ON files (project_id);
CREATE INDEX IF NOT EXISTS idx_files_uploaded_by  ON files (uploaded_by);

-- -------------------------------------------------------------------------
-- ENABLE & FORCE ROW LEVEL SECURITY
-- -------------------------------------------------------------------------
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE files FORCE  ROW LEVEL SECURITY;

-- -------------------------------------------------------------------------
-- RLS POLICIES  (bramha_app role)
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS files_isolation ON files;
CREATE POLICY files_isolation ON files
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (
    NULLIF(current_setting('app.user_id', TRUE), '')::uuid IS NOT NULL
    AND project_id IN (
      SELECT pm.project_id FROM project_members pm
       WHERE pm.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    )
  );

-- -------------------------------------------------------------------------
-- PERMISSIONS
-- -------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE files TO bramha_app;
GRANT ALL PRIVILEGES ON TABLE files TO bramha_migrator;
