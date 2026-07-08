-- Migration: 0010_notes
-- Adds notes and note_links tables for the CEO Office (notes + backlinks feature).

-- -------------------------------------------------------------------------
-- NOTES
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  content_md text NOT NULL DEFAULT '',
  content_json jsonb,
  folder_path text NOT NULL DEFAULT '/',
  is_daily boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notes_tenant ON notes;
CREATE POLICY notes_tenant ON notes
  USING (project_id IN (SELECT project_id FROM project_members WHERE user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid))
  WITH CHECK (project_id IN (SELECT project_id FROM project_members WHERE user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid));

GRANT SELECT, INSERT, UPDATE, DELETE ON notes TO bramha_app;

-- -------------------------------------------------------------------------
-- NOTE_LINKS (backlinks between notes via [[wikilinks]])
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS note_links (
  from_note uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  to_note uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  PRIMARY KEY (from_note, to_note)
);

ALTER TABLE note_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_links FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS note_links_tenant ON note_links;
CREATE POLICY note_links_tenant ON note_links
  USING (
    from_note IN (SELECT id FROM notes WHERE project_id IN (
      SELECT project_id FROM project_members WHERE user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    ))
  );

GRANT SELECT, INSERT, DELETE ON note_links TO bramha_app;

-- -------------------------------------------------------------------------
-- INDEXES
-- -------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notes_project ON notes (project_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes (project_id, folder_path) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_note_links_to ON note_links (to_note);

-- -------------------------------------------------------------------------
-- MIGRATOR GRANTS
-- -------------------------------------------------------------------------
GRANT ALL PRIVILEGES ON notes TO bramha_migrator;
GRANT ALL PRIVILEGES ON note_links TO bramha_migrator;
