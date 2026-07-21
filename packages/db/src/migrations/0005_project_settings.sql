-- 0005: per-project settings blob (delegation permission mode, etc.)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}';
