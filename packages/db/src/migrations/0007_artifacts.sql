-- Migration: 0007_artifacts
-- Adds artifact storage tables: artifacts (metadata) and artifact_versions (S3 content refs).
-- Content is immutable per version; each change creates a new version.
-- set_updated_at() trigger function is defined in 0001_identity_tenancy.sql.

-- -------------------------------------------------------------------------
-- ARTIFACTS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artifacts (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id   uuid        REFERENCES conversations(id) ON DELETE SET NULL,
  -- created_by_persona: no FK — agent_personas table does not exist until Phase 3
  created_by_persona uuid,
  created_by_user   uuid        REFERENCES users(id) ON DELETE SET NULL,
  kind              text        NOT NULL
                                CHECK (kind IN (
                                  'code','react','html','document',
                                  'markdown','svg','mermaid','csv'
                                )),
  title             text        NOT NULL,
  current_version   int         NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER artifacts_updated_at
  BEFORE UPDATE ON artifacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_artifacts_project_id      ON artifacts (project_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_conversation_id ON artifacts (conversation_id)
  WHERE conversation_id IS NOT NULL;

-- -------------------------------------------------------------------------
-- ARTIFACT_VERSIONS  (immutable rows — one row per version)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artifact_versions (
  artifact_id   uuid        NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version       int         NOT NULL,
  -- S3/MinIO key, e.g. artifacts/{projectId}/{artifactId}/v{version}
  content_key   text        NOT NULL,
  -- hex SHA-256 of the raw content bytes
  content_sha256 text       NOT NULL,
  -- 2 MB hard cap enforced at app layer and in DB
  size_bytes    int         NOT NULL CHECK (size_bytes <= 2097152),
  -- FK to conversation_nodes — nullable; populated when created by the runtime
  created_by_node uuid      REFERENCES conversation_nodes(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (artifact_id, version)
);

CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact_id
  ON artifact_versions (artifact_id);

-- -------------------------------------------------------------------------
-- ENABLE & FORCE ROW LEVEL SECURITY
-- -------------------------------------------------------------------------
ALTER TABLE artifacts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifacts         FORCE  ROW LEVEL SECURITY;

ALTER TABLE artifact_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_versions FORCE  ROW LEVEL SECURITY;

-- -------------------------------------------------------------------------
-- RLS POLICIES  (bramha_app role)
-- -------------------------------------------------------------------------

-- Artifacts: project must be one the user is a member of
DROP POLICY IF EXISTS artifacts_isolation ON artifacts;
CREATE POLICY artifacts_isolation ON artifacts
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (
    NULLIF(current_setting('app.user_id', TRUE), '')::uuid IS NOT NULL
    AND project_id IN (
      SELECT pm.project_id FROM project_members pm
       WHERE pm.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    )
  );

-- Artifact versions: artifact must be in a project the user is a member of
DROP POLICY IF EXISTS artifact_versions_isolation ON artifact_versions;
CREATE POLICY artifact_versions_isolation ON artifact_versions
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (
    artifact_id IN (
      SELECT a.id FROM artifacts a
       WHERE a.project_id IN (
         SELECT pm.project_id FROM project_members pm
          WHERE pm.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
       )
    )
  );

-- -------------------------------------------------------------------------
-- PERMISSIONS
-- -------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE artifacts         TO bramha_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE artifact_versions TO bramha_app;

GRANT ALL PRIVILEGES ON TABLE artifacts         TO bramha_migrator;
GRANT ALL PRIVILEGES ON TABLE artifact_versions TO bramha_migrator;
