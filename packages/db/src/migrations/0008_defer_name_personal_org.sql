-- 0008 — defer display name to onboarding
--
-- Signup now collects only email + password. The user's display name is asked
-- during onboarding ("What should we call you?"), so name must be nullable at
-- registration time. A personal org is auto-provisioned at register (see
-- auth.service); no schema change needed for that beyond this.

ALTER TABLE users ALTER COLUMN name DROP NOT NULL;
