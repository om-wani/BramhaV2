-- Migration: 0002_email_verification_tokens
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text        NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evtokens_user ON email_verification_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_evtokens_hash ON email_verification_tokens (token_hash);

-- bramha_app already has SELECT/INSERT/UPDATE/DELETE on all tables from migration 0001
-- No RLS needed (accessed via service account pre-auth)
GRANT SELECT, INSERT, UPDATE ON email_verification_tokens TO bramha_app;
