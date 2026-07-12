# BramhaV2 Codebase Audit Report

Date: 2026-07-13. Auditor: Claude Code session. Scope: full monorepo — optimization, broken systems, redundancy, security, gaps.

Companion to this report: fixes already applied this session (see "Fixed during audit" at bottom). Everything in sections 1–5 below is **unfixed** and written for an implementing agent. Each item has file:line anchors, rationale, and a concrete fix sketch. Priorities: P0 = broken/blocking, P1 = should fix before next phase, P2 = cleanup/nice-to-have.

---

## 1. Broken / never-exercised systems

### 1.1 [P0] `apps/agent-runtime` and `apps/ingestion-worker` have never been booted
Same disease `apps/api` had (fixed this session): code merged on green unit tests, but the composition root was never executed. Typecheck now passes (fixed this session), but **runtime boot is unverified**. Known hazards:
- `apps/agent-runtime/src/main.ts` — reads `SYSTEM_USER_ID`, `REDIS_URL`, `DATABASE_URL` env vars; no `.env` loader wired at all (nest ConfigModule absent here — plain node process). Needs an env-file story consistent with bootstrap.sh, or documented required-envs check at startup (a `check-env`-style assert).
- `apps/ingestion-worker/src/main.ts` — same. Also `credentialEncryptionKey` handling (grep `CREDENTIAL_ENCRYPTION_KEY`) — verify a key-format assert exists like TotpService's 32-byte check.
- **Fix**: boot both against compose stack, smoke one BullMQ job end-to-end each, fix what falls out. Expect the same class of DI/env/import bugs api had.

### 1.2 [P1] `apps/api` `test:e2e` + `test:tenant-probes` unverified in CI context
`vitest.e2e.config.ts` and `vitest.tenant-probes.config.ts` exist; `conversations.e2e.spec.ts` reads `TEST_REDIS_URL` (apps/api/src/modules/conversations/conversations.e2e.spec.ts:31). No CI wiring found that provides it. Verify these suites actually run somewhere; wire into CI with compose services or they will rot.

### 1.3 [P1] `scripts/rollback.sh`, `scripts/dr/`, `scripts/load/`, `scripts/security/` unexercised
Written for T5.x tasks. `scripts/load/*.ts` are flagged unused by knip. Verify each has a runbook reference in docs/07 or delete. Don't ship DR scripts nobody has ever run.

### 1.4 [P2] `apps/web` `test:e2e` = `playwright test` — no playwright config/spec found
Check `apps/web/playwright.config.*` existence; script is aspirational. Either add a minimal smoke spec (login page renders) or remove script.

---

## 2. Security

### 2.1 [P1] In-memory rate limiters — single-process only
- apps/api/src/modules/auth/auth.service.ts:31 (login/register limiter)
- apps/api/src/modules/auth/twofactor.service.ts:27 (2FA attempts)
Code comments acknowledge it. Fine for one instance; broken the moment api scales horizontally (each pod gets its own bucket → limit multiplied by pod count). Conversations + knowledge services already use Redis Lua rate limiting — port auth limiters to the same pattern. Extract shared helper (see 3.1) first.

### 2.2 [P1] `users` SELECT policy now `USING (true)` (migration 0019)
Applied this session to unblock registration (AuthDbService holds a raw connection, runs pre-session). Pragmatic but broad: any bramha_app connection can now read all `users` rows (including `password_hash`, `totp_secret_enc`) — not just AuthDbService. Defense-in-depth improvement for the implementing agent:
- Option A: column-level `GRANT SELECT (id, email, display_name, avatar_key, status, created_at) ON users TO bramha_app` + separate `bramha_auth` role with full column access used only by AuthDbService's connection string.
- Option B: move all `users` access behind SECURITY DEFINER functions.
Option A is less invasive. Same reasoning applies to `auth_sessions`.

### 2.3 [P1] JWT access tokens lack revocation path
apps/api/src/modules/auth/jwt.service.ts — EdDSA-signed, TTL from shared constants; verification is purely cryptographic. Sessions table exists (`auth_sessions`) for refresh rotation, but a compromised access token is valid until expiry. Verify TTL is short (≤15m); if not, shorten. Consider jti + Redis denylist for logout-all.

### 2.4 [P2] `mcp-web` egress allowlist is env-var default
infra/docker/compose.dev.yml:195 `MCP_WEB_ALLOWLIST` defaults to `api.github.com,docs.anthropic.com`. Fine for dev. Confirm the policy engine (packages/mcp-connectors/src/policy) rejects on empty/missing allowlist rather than allowing all — grep `MCP_WEB_ALLOWLIST` consumer and check the deny-by-default branch.

### 2.5 [P2] `graph_checkpoints` + `audit_log` RLS
`audit_log` has no RLS (relrowsecurity=f). Intentional per docs (admin-only reads) but verify no bramha_app SELECT grant exists on it. `_migrations` likewise — harmless but confirm no app-role grant.

### 2.6 [P2] Dev secrets committed in compose file
`dev_only_*` passwords in infra/docker/compose.dev.yml are deliberate dev fixtures — acceptable. But `MCP_JWT_SECRET` default (`dev_only_mcp_jwt_secret`) also flows into mcp servers used by agent-runtime; make prod compose/terraform fail hard when any `dev_only_` value is present (add check to scripts/check-env.ts prod mode).

---

## 3. Redundancy / reinvented wheels

### 3.1 [P1] Identical `LUA_RATE_LIMIT` script duplicated
- apps/api/src/modules/conversations/conversations.service.ts:178
- apps/api/src/modules/knowledge/knowledge.service.ts:45
Byte-identical (verified by diff). Extract to `apps/api/src/modules/common/redis/rate-limit.ts` as `redisRateLimit(redis, key, limit, windowSec)`. Then auth limiters (2.1) migrate onto it too. Also `realtime.gateway.ts:33` has a similar-but-different socket-cap Lua — leave that one.

### 3.2 [P1] `packages/db/src/seed/personas.ts` (421 lines) duplicates migration 0011 persona data
Unreferenced by seed.ts (only seed.test.ts imports it). Two sources of truth for persona prompts — they WILL drift (0011's CFO apostrophe bug was already fixed only in the migration). Either: (a) delete personas.ts and keep 0011 canonical, or (b) generate a future migration from personas.ts. Recommend (a) — persona edits post-launch happen via Admin API, not seeds.

### 3.3 [P2] Env parsing hand-rolled in scripts/check-env.ts
`parseEnvFile` (scripts/check-env.ts:7) reimplements dotenv parsing. Works, tested, tiny — acceptable. If dotenv is ever added as a root dep, swap.

### 3.4 [P2] `AuthDbService` bypasses `@bramha/db` with its own postgres pool
apps/api/src/modules/auth/auth-db.service.ts:43 — second `postgres()` pool alongside packages/db's. Intentional (pre-session auth can't use withTenant), but the connection options (max:5, idle_timeout, connect_timeout) duplicate packages/db/src/client.ts. Extract a shared `makePool(url, opts)` in @bramha/db that both use, so pool tuning happens in one place.

### 3.5 [P2] Unused dependencies (knip-verified, spot-check before removing)
- apps/api: `fastify-plugin`, `supertest`+`@types/supertest` (devDeps; e2e config may want them — verify), `pino-pretty` (likely used via CLI pipe — keep), `tsx` (now unused after start:dev switch to tsc watch — REMOVE)
- apps/ingestion-worker: `csv-parse` (extraction pipeline may intend xlsx only), `@bramha/db` (main.ts uses raw postgres?  verify then remove), `@types/dompurify` (dompurify ships own types now)
- apps/web: `@codesandbox/sandpack-react`, `@monaco-editor/react` (artifact renderer never wired — see 4.1), `@radix-ui/react-dropdown-menu`, `@radix-ui/react-tooltip`, `@tiptap/suggestion`
- packages/db: `@bramha/shared` (verify no type-only imports), `drizzle-kit` (db:push still uses it — keep until schema workflow decided)
- packages/mcp-connectors: `ajv` (policy engine validates with zod — remove), `@bramha/shared`

### 3.6 [P2] `RagChunk` type defined in agent-runtime instead of shared
apps/agent-runtime/src/pa/context-bundle.ts:89. Knowledge service (api) returns chunks with its own shape. When T2.3.4 hybrid search wires agent-runtime → api search, these will collide. Move canonical RagChunk into @bramha/shared/schemas.

---

## 4. Gaps (declared but not delivered)

### 4.1 [P1] Artifact renderer UI orphaned
apps/web/components/artifacts/{ArtifactPane,DiffView,VersionSwitcher}.tsx — zero imports anywhere. Sandpack + Monaco deps installed for them (3.5). Backend artifacts module works (T2.2.1 done). The UI (T2.2.2) was written but never mounted into any route/page. Implementing agent: mount ArtifactPane in the chat room layout per docs/06 §artifact-pane, or delete and re-plan.

### 4.2 [P1] `apps/web/lib/auth.ts` orphaned
Unreferenced. Web auth currently inlined in route handlers/pages? Verify intended usage; consolidate or delete.

### 4.3 [P2] `searchKnowledge` stub in agent-runtime returns []
apps/agent-runtime/src/agent/agent-worker.ts (searchKnowledge) — "Phase 3 stub". Agents currently get zero RAG. Fine per phase plan; flagging so it's not forgotten: wire to knowledge service hybrid search (T2.3.4) via internal HTTP or direct DB query.

### 4.4 [P2] `check-env.ts` has no prod mode
Validates presence only. Add `--strict` flag: reject `dev_only_*`/`generate_with_bootstrap_sh` values, verify MASTER_KEY base64-decodes to 32 bytes, JWT keys parse as PEM. Wire into deploy pipeline.

### 4.5 [P2] `users`/`auth_sessions` FORCE-RLS flag left set with RLS disabled
Cosmetic residue of migration 0019 (relforcerowsecurity=t, relrowsecurity=f — no effect). Next migration touching these tables should `ALTER TABLE users NO FORCE ROW LEVEL SECURITY` for hygiene.

---

## 5. Optimization / code quality

### 5.1 [P2] `apps/api` start:dev uses `&` job control in npm script
`"start:dev": "tsc --watch --preserveWatchOutput & node --watch dist/main.js"` — works but orphans the tsc watcher if node crashes, and Ctrl+C behavior is shell-dependent. Better: `concurrently -k "tsc --watch --preserveWatchOutput" "node --watch dist/main.js"` (one devDep) or npm-run-all. Low urgency.

### 5.2 [P2] `problem-json.filter` logs full error objects
Check apps/api/src/common/filters/problem-json.filter.ts — ensure stack/detail never leaks into the HTTP body in prod (currently OK per phase-1 spec — re-verify after any edit) and that logger redaction (packages/shared redaction.ts) is applied to request logging paths.

### 5.3 [P2] Duplicated per-service `dev_only` connection strings
bootstrap.sh, compose.dev.yml, .env.example, apps/api/.env template all repeat `dev_only_postgres_password` etc. Single-source into .env consumed by compose (`env_file:`) if churn becomes annoying. Cosmetic.

### 5.4 [P2] `apps/agent-runtime` room-type strings
apps/agent-runtime/src/pa/proactive-scheduler.ts:37 `roomType: string` with comment listing the union — use `RoomType` from @bramha/shared (same fix as agent-graph.ts this session). Grep agent-runtime for remaining `roomType: string`.

---

## Fixed during audit (this session — already committed or staged)

1. **agent-runtime + ingestion-worker: 0 tsc errors** (were 19 + 3). Fixes: missing `zod` dep (ingestion-worker); pnpm `overrides: ioredis ^5.11.1` (bullmq pinned 5.10.1 → dual-class type clash); ioredis named import in main.ts; `RoomType` union on loadContext dep; **implemented missing `loadProjectFacts` production dep** (agent-worker.ts — was typed as required, never implemented; queries agent_working_memory joined to rooms, excludes current conversation); loadContext now returns roomType + roomIsConfidential (JOIN rooms); zod v4 `z.record(key, value)` arity in delegate-task; `InterruptEvent` derived from schema (exactOptionalPropertyTypes); `claimProactiveTurn` SET arg order `EX ttl NX` (ioredis overload); SYSTEM_USER_ID narrowing; test-file strictness fixes. Tests: agent-runtime 247/247, ingestion-worker 57/57.
2. **Real migration runner** packages/db/src/migrate.ts — applies raw SQL in order, `_migrations` bookkeeping table, idempotent. `db:migrate` script now points at it (was broken `drizzle-kit migrate`). Verified: 18 applied then "up to date".
3. **bootstrap.sh completed** — was a stub with "skipped" placeholders. Now: prereqs → install → root .env → generates apps/api/.env with fresh Ed25519 JWT keypair + secrets → web .env.local → check-env → builds workspace packages → compose up → waits postgres → migrate → seed. Syntax-checked; migrate+seed verified against live db.
4. **.env.example** — added JWT_PRIVATE/PUBLIC_KEY_BASE64 with generation instructions.
5. **SQL ident escape** apps/ingestion-worker/src/sources/sql-sync.ts:123 — hostile external-DB table name could break out of quoted identifier; now `"` doubled.
6. **Deleted** apps/ingestion-worker/src/sources/gitlab-sync.ts — 8-line unused re-export alias.
7. **tsx** added where actually used (packages/db devDep, root devDep for scripts/).
