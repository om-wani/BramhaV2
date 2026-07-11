-- Migration: 0018_session_tfv
-- Add two_factor_verified flag to auth_sessions so token refresh preserves
-- whether 2FA was actually completed at login time, rather than deriving it
-- from the user's current TOTP enrollment state (which changes independently).

ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS two_factor_verified boolean NOT NULL DEFAULT false;
