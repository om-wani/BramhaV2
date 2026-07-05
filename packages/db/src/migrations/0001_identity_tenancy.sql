-- Migration: 0001_identity_tenancy
-- Creates all identity/tenancy tables, indexes, RLS policies, and DB roles.

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create application roles (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bramha_app') THEN
    CREATE ROLE bramha_app LOGIN PASSWORD 'dev_only_app_password';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bramha_migrator') THEN
    CREATE ROLE bramha_migrator LOGIN PASSWORD 'dev_only_migrator_password';
  END IF;
END $$;

-- Grant bramha_migrator BYPASSRLS so seeds and migrations are not filtered
ALTER ROLE bramha_migrator BYPASSRLS;

-- updated_at trigger function
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -------------------------------------------------------------------------
-- USERS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email               citext      UNIQUE NOT NULL,
  email_verified_at   timestamptz,
  password_hash       text,
  display_name        text        NOT NULL,
  avatar_key          text,
  totp_secret_enc     bytea,
  is_admin            boolean     NOT NULL DEFAULT false,
  status              text        NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active', 'suspended')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- -------------------------------------------------------------------------
-- AUTH_SESSIONS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_sessions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash  text        NOT NULL,
  user_agent          text,
  ip                  inet,
  expires_at          timestamptz NOT NULL,
  revoked_at          timestamptz,
  rotated_from        uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires
  ON auth_sessions (expires_at) WHERE revoked_at IS NULL;

-- -------------------------------------------------------------------------
-- ORGS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orgs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  slug        citext      UNIQUE NOT NULL,
  owner_id    uuid        NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER orgs_updated_at
  BEFORE UPDATE ON orgs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_orgs_slug  ON orgs (slug);
CREATE INDEX IF NOT EXISTS idx_orgs_owner ON orgs (owner_id);

-- -------------------------------------------------------------------------
-- ORG_MEMBERS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_members (
  org_id      uuid NOT NULL REFERENCES orgs(id)  ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON org_members (user_id);

-- -------------------------------------------------------------------------
-- PROJECTS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  description text,
  settings    jsonb       NOT NULL DEFAULT '{}',
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_projects_org_id ON projects (org_id);

-- -------------------------------------------------------------------------
-- PROJECT_MEMBERS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_members (
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_user_id    ON project_members (user_id);
CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON project_members (project_id);

-- -------------------------------------------------------------------------
-- PERMISSIONS
-- -------------------------------------------------------------------------
-- bramha_app: DML only (subject to RLS)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bramha_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO bramha_app;

-- bramha_migrator: full DDL + DML (bypasses RLS via role attribute above)
GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public TO bramha_migrator;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO bramha_migrator;

-- -------------------------------------------------------------------------
-- ENABLE & FORCE ROW LEVEL SECURITY
-- -------------------------------------------------------------------------
ALTER TABLE users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE users           FORCE  ROW LEVEL SECURITY;

ALTER TABLE auth_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions   FORCE  ROW LEVEL SECURITY;

ALTER TABLE orgs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE orgs            FORCE  ROW LEVEL SECURITY;

ALTER TABLE org_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members     FORCE  ROW LEVEL SECURITY;

ALTER TABLE projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects        FORCE  ROW LEVEL SECURITY;

ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members FORCE  ROW LEVEL SECURITY;

-- -------------------------------------------------------------------------
-- RLS POLICIES (apply only to bramha_app role)
-- NULLIF(..., '') guards against empty-string GUC before casting to uuid
-- -------------------------------------------------------------------------

-- Users: each user sees only their own row
CREATE POLICY users_isolation ON users
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid);

-- Auth sessions: only the owning user's sessions
CREATE POLICY sessions_isolation ON auth_sessions
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid);

-- Orgs: only orgs the user is a member of
CREATE POLICY orgs_isolation ON orgs
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (
    id IN (
      SELECT om.org_id
      FROM   org_members om
      WHERE  om.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    )
  );

-- Org members: rows where user is the member, or belongs to the same org
CREATE POLICY org_members_isolation ON org_members
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (
    user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    OR org_id IN (
      SELECT om2.org_id
      FROM   org_members om2
      WHERE  om2.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    )
  );

-- Projects: only projects the user is a member of
CREATE POLICY projects_isolation ON projects
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (
    id IN (
      SELECT pm.project_id
      FROM   project_members pm
      WHERE  pm.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    )
  );

-- Project members: only rows for projects the user belongs to
CREATE POLICY project_members_isolation ON project_members
  AS PERMISSIVE FOR ALL TO bramha_app
  USING (
    project_id IN (
      SELECT pm2.project_id
      FROM   project_members pm2
      WHERE  pm2.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::uuid
    )
  );
