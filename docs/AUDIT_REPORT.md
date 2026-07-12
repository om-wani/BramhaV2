# BramhaV2 Codebase Audit Report

Date: 2026-07-13 (two passes: static audit + deep runtime audit). Auditor: Claude Code session. Scope: full monorepo — optimization, broken systems, redundancy, security, gaps.

Companion to this report: fixes already applied this session (see "Fixed during audit" at bottom). Everything in sections 0–5 below is **unfixed** and written for an implementing agent. Each item has file:line anchors, rationale, and a concrete fix sketch. Priorities: P0 = broken/blocking, P1 = should fix before next phase, P2 = cleanup/nice-to-have.

---

## 0. Deep-audit P0s (found by actually running things — read these first)

### 0.1 [P0] Web ↔ API auth contract never integrated — every authenticated web call 401s
`apps/web/lib/api-client.ts` sends only cookies (`credentials: 'include'`); it never stores or sends an access token. `JwtAuthGuard` (apps/api/src/modules/auth/guards/jwt-auth.guard.ts:19) reads ONLY the `Authorization: Bearer` header. Login response returns `accessToken` in the JSON body and sets just the `refresh_token` cookie (auth.controller.ts). Result: the entire authenticated web app is non-functional against the real API — every `api.get/post/patch/delete` after login gets 401. Zero grep hits for `Authorization|accessToken` under apps/web/lib|stores|hooks.
**Fix (recommended)**: set the access token as an `access_token` httpOnly cookie at login/refresh (SameSite=Strict; matches existing CSP posture), and teach JwtAuthGuard to fall back to that cookie when no Authorization header is present (keep header path for API-key/bearer clients). Alternative: in-memory token store + fetch wrapper on web — worse (XSS exfil surface, page-refresh loss, refresh-race complexity).

### 0.2 [P0] Conversation DAG hard-caps at ~63-deep — then every INSERT on the chain dies
`idx_conversation_nodes_conv_path` GiST index over `ltree` path (0006): inserting node #64 in a linear chain fails with Postgres `stack depth limit exceeded` (2MB default stack; reproduced live — failure at exactly depth 63 with UUID-underscore labels). One node per message ⇒ any active conversation hits this wall almost immediately. The db test "500-node chain" codifies the requirement and fails.
**Fix options** (agent must pick one; (a) is the surgical default):
- (a) Drop the GiST index + `path <@` queries; do ancestor/descendant walks with a recursive CTE over `(conversation_id, parent_id)` btree — chat-scale conversations are thousands of nodes, CTE is fine, and `path` column can stay for display/debug.
- (b) Shorten labels (e.g. 8-char hash of node id) — only delays the wall ~4× and adds a collision/lookup layer. Not recommended.
- (c) Raise `max_stack_depth` — fragile, needs matching OS ulimit everywhere, still a cliff. Not recommended.
Whichever is chosen, update docs/05 §DAG and the failing perf test to match.

### 0.3 [P0] API uploads and ingestion-worker use different S3 buckets — every ingestion job 404s
API writes uploads to a single `S3_BUCKET` (default `bramha-artifacts`; apps/api/src/modules/common/s3/s3.module.ts:31) with key `staging/{projectId}/{fileId}` (files.service.ts:160). Ingestion reads the same key from `S3_BUCKET_STAGING` = `bramha-staging` (apps/ingestion-worker/src/main.ts:51,90). Compose provisions the 4-bucket layout; the API simply never adopted it. Also 3-way env-name drift: `.env.example` says `S3_ACCESS_KEY/S3_SECRET_KEY`, API reads `AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY`, ingestion reads `S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY`.
**Fix**: make the API's S3Module provide the 4 named buckets (staging/clean/quarantine/artifacts) from the same env names ingestion uses; presign uploads into STAGING, artifacts into ARTIFACTS; align `.env.example` + bootstrap.sh + compose on ONE credential var pair.

### 0.4 [P0] `system_agent` user + `system_memberships` never implemented — agents see zero rows
agent-runtime requires `SYSTEM_USER_ID` env and runs all queries under it via withTenant, but no migration/seed creates any system user, and docs/05 §9 rule 2's `system_memberships` view doesn't exist anywhere (only grep hit is the docs line). RLS membership policies therefore filter every agent-runtime query to 0 rows — agents boot but can never read personas/conversations/memory.
**Fix**: migration creating a reserved `system_agent` user (fixed UUID, no password, status system), auto-membership mechanism (trigger adding it to project_members on project creation, or a `system_memberships` view UNION'd into the policies), bootstrap.sh exporting `SYSTEM_USER_ID`, and a tenant-probe asserting the system user sees exactly its projects.

### 0.5 [P0] Dockerfile.api runtime stage cannot build
`npm install --omit=dev` at infra/docker/Dockerfile.api:72 dies on `workspace:*` (EUNSUPPORTEDPROTOCOL) — npm can't read pnpm workspace protocol. Same disease Dockerfile.mcp-node had; that file's fixed `pnpm deploy --prod --legacy` pattern (commit 696dc9d) is the proven template. Dockerfile.web also fails to build (its `pnpm --filter @bramha/web build` stage) — diagnose after api. Dockerfile.ingestion copies the whole pnpm-symlinked `/build/node_modules` (line 76) — verify COPY dereferences to a working tree or convert to the deploy pattern too. None of the three app images currently build.

### 0.6 [P1] xlsx parses untrusted uploads; npm version is abandoned with HIGH CVEs
`xlsx@0.18.5` (ingestion extraction pipeline) has prototype-pollution + ReDoS advisories; the npm package is no longer updated (official distribution moved to cdn.sheetjs.com). It parses user-uploaded spreadsheets post-ClamAV — malware scan does not stop ReDoS/proto-pollution.
**Fix**: swap to `exceljs` for xlsx/csv extraction, or pin SheetJS ≥0.20.2 from the official CDN registry. Keep extraction inside the worker sandbox either way.

### 0.7 [P1] Remaining `next` HIGH advisories require Next 15
Bumped 14.2.29→14.2.35 this session (several DoS fixes). The middleware-bypass and remaining DoS advisories are only fixed in 15.5.16+. Middleware guards routes here, so plan the Next 15 upgrade (App Router migration cost is low; `output: 'standalone'` and middleware API are compatible).

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

### Deep-audit pass (same day, second commit)

8. **withTenant was broken on every call** — `SET LOCAL app.user_id = ${param}`: Postgres forbids bind parameters in SET (syntax error at $1), so the sole sanctioned query path threw on EVERY invocation; unit tests mock withTenant so all were green. Fixed packages/db/src/rls.ts with parameterizable `SELECT set_config('…', $1, true)` (transaction-local). Also fixed the same pattern in 32 test-file sites (rls.test.ts, conversations.test.ts, rls-probes.test.ts) — those suites skip without DATABASE_URL, which is why it was never caught.
9. **RLS infinite recursion** — project_members/org_members policies (0001) subselected their own tables → Postgres 42P17 on ANY membership-scoped query. Migration `0020_fix_rls_recursion.sql`: SECURITY DEFINER `current_user_project_ids()`/`current_user_org_ids()` + repointed the 4 self/mutually-recursive policies.
10. **graph_checkpoints cross-tenant read** — policy was "any authenticated user" (0012); checkpoint bytea is serialized agent state = conversation content. Migration `0021_graph_checkpoints_tenancy.sql`: added `project_id` column + membership-scoped policy.
11. **audit_log had no RLS at all** with SELECT granted to bramha_app — any user could read the whole cross-tenant audit trail. Migration `0022_audit_log_rls.sql`: FORCE RLS, open INSERT, admin-only (app.is_admin GUC) SELECT. Added dedicated probe.
12. **Append-only DAG guard never enforced** — `pg_trigger_depth() > 0` is always true inside a directly-fired trigger, so UPDATE/DELETE on conversation_nodes silently succeeded. Migration `0023_fix_append_only_guard.sql`: `> 1` (direct=reject at depth 1, FK-cascade=allow at 2). Verified both directions live.
13. **next build was broken** (never run before) — `@bramha/shared` index re-exported Node-only `telemetry.js` (OTel SDK → grpc → `net`) into client bundles. Removed from index; added `./telemetry` subpath export (zero consumers existed). `next build` now passes.
14. **Tenant probe suite fixture bugs** — `'\x00'` eaten by JS template escaping (→ `'\\x00'`), `sql.array()` misuse crashing cleanup every run (→ plain arrays; the accumulated stale rows had been masking results). Registered graph_checkpoints + audit_log in the schema-coverage set. Suite now 27/27 green against live DB; db package 48/49 (the 1 failure = the ltree depth cap, item 0.2).
15. **CVE bumps** — next 14.2.29→14.2.35, dompurify →3.4.8 (direct dep).
16. **Runtime boots verified** — agent-runtime and ingestion-worker both boot against the compose stack and shut down gracefully on SIGTERM (compile ≠ run; item 1.1 closed, but see 0.4 for why agents still can't read data).
