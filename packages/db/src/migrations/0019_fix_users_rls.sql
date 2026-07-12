-- Migration: 0019_fix_users_rls
--
-- AuthDbService (apps/api/src/modules/auth/auth-db.service.ts) owns all reads/writes
-- to `users` and `auth_sessions`. It intentionally holds its own raw `postgres.Sql`
-- connection — separate from the tenant-scoped `withTenant()` path in @bramha/db —
-- because auth operations (register, login-by-email, session issuance/rotation,
-- password reset, email verification) inherently run before any session exists to
-- derive `app.user_id` from. That connection never sets `app.user_id`, so the
-- `users_isolation` / `sessions_isolation` policies from 0001 (FOR ALL, single
-- USING clause reused as WITH CHECK) reject every statement AuthDbService issues,
-- including its own INSERT/SELECT/UPDATE calls made by id/email — not just the
-- registration INSERT.
--
-- This matches the pattern already established for the other tables AuthDbService
-- owns (email_verification_tokens, recovery_codes, api_keys, password_reset_tokens
-- from 0002-0005): none of them carry RLS. Correctness for these identity-bootstrap
-- tables is enforced by AuthDbService's parameterized queries, not DB-level RLS.

DROP POLICY IF EXISTS users_isolation ON users;
DROP POLICY IF EXISTS sessions_isolation ON auth_sessions;

ALTER TABLE users         DISABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions DISABLE ROW LEVEL SECURITY;
