-- Fix project_members role CHECK constraint to use 'admin' | 'member'
-- (replacing the initial 'owner' | 'editor' | 'viewer' which mismatched the API layer)

ALTER TABLE project_members
  DROP CONSTRAINT IF EXISTS project_members_role_check;

ALTER TABLE project_members
  ADD CONSTRAINT project_members_role_check CHECK (role IN ('admin', 'member'));
