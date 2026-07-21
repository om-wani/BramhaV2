-- 0003_ingestion_jobs_fix.sql
-- Add project_id and updated_at to ingestion_jobs, fix status values (queued → pending)

-- Add project_id (backfill from files table)
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS project_id uuid;
UPDATE ingestion_jobs SET project_id = (SELECT project_id FROM files WHERE files.id = ingestion_jobs.file_id);
ALTER TABLE ingestion_jobs ALTER COLUMN project_id SET NOT NULL;

-- Add updated_at
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Drop old status CHECK constraint and add new one allowing 'pending' instead of 'queued'
ALTER TABLE ingestion_jobs DROP CONSTRAINT IF EXISTS ingestion_jobs_status_check;
ALTER TABLE ingestion_jobs ADD CONSTRAINT ingestion_jobs_status_check CHECK (status IN ('pending','running','done','failed'));

-- Update any existing 'queued' rows to 'pending'
UPDATE ingestion_jobs SET status = 'pending' WHERE status = 'queued';
