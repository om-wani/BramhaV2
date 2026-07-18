# BramhaV2 Codebase Audit Report

Date: 2026-07-13 (three passes: static audit, deep runtime audit, fix round). Auditor: Claude Code session. Scope: full monorepo — optimization, broken systems, redundancy, security, gaps.

Items marked **[FIXED]** below are resolved — see "Fixed during audit" at the bottom for what changed and how it was verified (this report does not restate the fix inline; only a pointer). All other items remain **unfixed** and are written for an implementing agent, with file:line anchors, rationale, and a concrete fix sketch. Priorities: P0 = broken/blocking, P1 = should fix before next phase, P2 = cleanup/nice-to-have. All 5 P0s (section 0) are fixed as of this pass; the only unfixed P0-adjacent item is 2.2, which turned out to need its own dedicated task (see its note).

---

## 0. Deep-audit P0s (found by actually running things — read these first)

### 0.1 [FIXED] Web ↔ API auth contract never integrated — every authenticated web call 401s
✅ Fixed — see "Fixed during audit" #17.

### 0.2 [FIXED] Conversation DAG hard-caps at ~63-deep — then every INSERT on the chain dies
✅ Fixed — see "Fixed during audit" #17. Went with option (a) from the original fix sketch (dropped the GiST index, recursive CTE for ancestor walks).

### 0.3 [FIXED] API uploads and ingestion-worker use different S3 buckets — every ingestion job 404s
✅ Fixed — see "Fixed during audit" #17.

### 0.4 [FIXED] `system_agent` user + membership mechanism never implemented — agents see zero rows
✅ Fixed — see "Fixed during audit" #17. Went with the trigger-based auto-membership option (not a `system_memberships` view) — SECURITY DEFINER on `projects` INSERT, plus a backfill for pre-existing projects.

### 0.5 [FIXED] None of the 3 app Dockerfiles built or ran correctly
✅ Fixed — see "Fixed during audit" #17. Turned out to be 6 distinct bugs across the 3 files, not just the `pnpm deploy` one originally flagged.

### 0.6 [FIXED] xlsx parses untrusted uploads; npm version is abandoned with HIGH CVEs
✅ Fixed — see "Fixed during audit" #18. Went with the exceljs swap (not pinning SheetJS from their non-npm CDN registry).

### 0.7 [P1, deferred — deliberately not fixed] Remaining `next` HIGH advisories require Next 15
Bumped 14.2.29→14.2.35 this session (several DoS fixes). The middleware-bypass and remaining DoS advisories are only fixed in 15.5.16+. Middleware guards routes here, so plan the Next 15 upgrade (App Router migration cost is low; `output: 'standalone'` and middleware API are compatible). Deliberately not attempted — major-version bump with real breaking-change surface, deserves its own dedicated pass with full regression, not a squeeze-in during an already-large session. Same reasoning applies to the `@opentelemetry/sdk-node` HIGH advisory (needs 0.52→0.217, also a major jump) — lower urgency since the vulnerable component (Prometheus exporter) isn't used in this codebase.

---

## 1. Broken / never-exercised systems

### 1.1 [FIXED] `apps/agent-runtime` and `apps/ingestion-worker` have never been booted
✅ Fixed — see "Fixed during audit" #16 (boot verified) and #17 (agent-runtime's `loadContext` verified to actually return data, not just start cleanly). One hazard from the original note still stands, unaddressed: neither app has a `.env` loader — both read `process.env` directly with no dotenv-equivalent, unlike apps/api's ConfigModule. Works today because bootstrap.sh/docker-compose inject env vars directly; would bite anyone trying to run either with a `.env` file the way apps/api supports.

### 1.2 [P1] `apps/api` `test:e2e` + `test:tenant-probes` unverified in CI context
`vitest.e2e.config.ts` and `vitest.tenant-probes.config.ts` exist; `conversations.e2e.spec.ts` reads `TEST_REDIS_URL` (apps/api/src/modules/conversations/conversations.e2e.spec.ts:31). No CI wiring found that provides it. Verify these suites actually run somewhere; wire into CI with compose services or they will rot.

### 1.3 [P1] `scripts/rollback.sh`, `scripts/dr/`, `scripts/load/`, `scripts/security/` unexercised
Written for T5.x tasks. `scripts/load/*.ts` are flagged unused by knip. Verify each has a runbook reference in docs/07 or delete. Don't ship DR scripts nobody has ever run.

### 1.4 [P2] `apps/web` `test:e2e` = `playwright test` — no playwright config/spec found
Check `apps/web/playwright.config.*` existence; script is aspirational. Either add a minimal smoke spec (login page renders) or remove script.

---

## 2. Security

### 2.1 [FIXED] In-memory rate limiters — single-process only
✅ Fixed this round — see "Fixed during audit" #17 below.

### 2.2 [P1, scope corrected] `users`/`auth_sessions` SELECT policy is `USING (true)`
Investigated this round; the report's original "Option A" (column-level `GRANT SELECT` restricting `bramha_app` to non-sensitive columns, elevated access only via a separate `bramha_auth` role) does not work as described — it was scoped only against `AuthDbService`. **`AdminService` also reads/writes `totp_secret_enc` through the exact same `bramha_app` role** (admin.service.ts:358 lists it in the user table; :414 nulls it out for admin-triggered 2FA reset) via `withAdmin()`. Postgres column privileges are a role-wide, pre-RLS layer — they can't be conditionally scoped per RLS-bypass-GUC the way row policies can. Revoking column access from `bramha_app` broadly would break admin 2FA reset alongside locking out `AuthDbService`.
Actual fix needs a 3-way split, each its own connection pool + DI token: `bramha_app` (no sensitive columns — the general withTenant path), `bramha_auth` (full columns, `AuthDbService` only), and either extend `bramha_auth` to cover the admin-2FA-reset queries too or keep a third role for that path specifically. Non-trivial: new migration, new env vars (`AUTH_DATABASE_URL` or similar), new NestJS provider wiring for the second/third pool, full live re-verification of login + 2FA + admin panel. Scope it as its own task, not a quick follow-up.

### 2.3 [Verified sufficient] JWT access token TTL
Checked: `SESSION_ACCESS_TOKEN_TTL_SECONDS = 900` (15 min, packages/shared/src/constants.ts) — already at the report's own "≤15m" bar. No change made. The jti + Redis denylist idea for logout-all remains a legitimate future enhancement (the report itself framed it as "consider," not a required fix) — worth doing before a real logout-all/security-incident feature is needed, not before.

### 2.4 [P2] `mcp-web` egress allowlist is env-var default
infra/docker/compose.dev.yml:195 `MCP_WEB_ALLOWLIST` defaults to `api.github.com,docs.anthropic.com`. Fine for dev. Confirm the policy engine (packages/mcp-connectors/src/policy) rejects on empty/missing allowlist rather than allowing all — grep `MCP_WEB_ALLOWLIST` consumer and check the deny-by-default branch.

### 2.5 [P2] `graph_checkpoints` + `audit_log` RLS
`audit_log` has no RLS (relrowsecurity=f). Intentional per docs (admin-only reads) but verify no bramha_app SELECT grant exists on it. `_migrations` likewise — harmless but confirm no app-role grant.

### 2.6 [P2] Dev secrets committed in compose file
`dev_only_*` passwords in infra/docker/compose.dev.yml are deliberate dev fixtures — acceptable. But `MCP_JWT_SECRET` default (`dev_only_mcp_jwt_secret`) also flows into mcp servers used by agent-runtime; make prod compose/terraform fail hard when any `dev_only_` value is present (add check to scripts/check-env.ts prod mode).

---

## 3. Redundancy / reinvented wheels

### 3.1 [FIXED] Identical `LUA_RATE_LIMIT` script duplicated
✅ Fixed this round — see "Fixed during audit" #17 below.

### 3.2 [FIXED] `packages/db/src/seed/personas.ts` duplicated migration 0011 persona data
✅ Fixed this round — see "Fixed during audit" #17 below.

### 3.3 [P2] Env parsing hand-rolled in scripts/check-env.ts
`parseEnvFile` (scripts/check-env.ts:7) reimplements dotenv parsing. Works, tested, tiny — acceptable. If dotenv is ever added as a root dep, swap.

### 3.4 [P2] `AuthDbService` bypasses `@bramha/db` with its own postgres pool
apps/api/src/modules/auth/auth-db.service.ts:43 — second `postgres()` pool alongside packages/db's. Intentional (pre-session auth can't use withTenant), but the connection options (max:5, idle_timeout, connect_timeout) duplicate packages/db/src/client.ts. Extract a shared `makePool(url, opts)` in @bramha/db that both use, so pool tuning happens in one place.

### 3.5 [P2] Unused dependencies (knip-verified, spot-check before removing)
- apps/api: `fastify-plugin`, `supertest`+`@types/supertest` (devDeps; e2e config may want them — verify), `pino-pretty` (likely used via CLI pipe — keep), `tsx` (now unused after start:dev switch to tsc watch — REMOVE)
- apps/ingestion-worker: `csv-parse` (extraction pipeline may intend xlsx only), `@bramha/db` (main.ts uses raw postgres?  verify then remove), `@types/dompurify` (dompurify ships own types now)
- apps/web: `@codesandbox/sandpack-react` — confirmed still genuinely unused (grepped for `sandpack` after mounting ArtifactPane this round, zero hits; ArtifactFrame uses its own iframe sandbox, not Sandpack — REMOVE). `@monaco-editor/react` is no longer on this list: ArtifactPane is now mounted (4.1, fixed) and DiffView imports it directly. `@radix-ui/react-dropdown-menu`, `@radix-ui/react-tooltip`, `@tiptap/suggestion` still unverified.
- packages/db: `@bramha/shared` (verify no type-only imports), `drizzle-kit` (db:push still uses it — keep until schema workflow decided)
- packages/mcp-connectors: `ajv` (policy engine validates with zod — remove), `@bramha/shared`

### 3.6 [P2] `RagChunk` type defined in agent-runtime instead of shared
apps/agent-runtime/src/pa/context-bundle.ts:89. Knowledge service (api) returns chunks with its own shape. When T2.3.4 hybrid search wires agent-runtime → api search, these will collide. Move canonical RagChunk into @bramha/shared/schemas.

---

## 4. Gaps (declared but not delivered)

### 4.1 [FIXED] Artifact renderer UI orphaned
✅ Fixed this round — see "Fixed during audit" #17 below. One gap remains: docs/06 §8 specifies the pane should auto-slide-open on the first `artifact.stream.chunk` realtime event; that event listener doesn't exist on the web side yet (no `useArtifactStream`-style hook, unlike `useAgentStream`/`useActivityEvents`). What's mounted now is a manual toggle (an "Artifacts" button in RoomHeader) — fully functional, just not the auto-open convenience. Worth a follow-up, not urgent.

### 4.2 [FIXED] `apps/web/lib/auth.ts` orphaned
✅ Fixed this round — see "Fixed during audit" #17 below.

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

### Round 3: all P0s from section 0, xlsx CVE, P1 batch (third commit round)

17. **All 5 P0s in section 0 closed** — web/API auth contract (access_token cookie + guard fallback + refresh-and-retry), DAG depth cap (dropped the GiST index, recursive-CTE ancestor walk, verified live at depth 100), S3 bucket wiring (4 named buckets aligned with ingestion-worker, `updateFileStorageKey` added, and a real, previously-undiscovered bug fixed along the way: the upload quota check did `SELECT SUM(...) ... FOR UPDATE`, which Postgres flatly rejects — **upload had never worked, ever**, now locks the project row instead), system_agent (migration 0026, verified agent-runtime's `loadContext` actually resolves data through RLS), and all 3 Dockerfiles (6 distinct bugs across api/web/ingestion — wrong deploy pattern, wrong healthcheck host/port/path, inverted logger env check, missing `@bramha/shared`/`tsconfig.base.json` copies, missing `public/`, wrong standalone-output paths, nonexistent healthcheck target — every container now builds, boots, and passes its own HEALTHCHECK against the live compose network). Two more real bugs surfaced and fixed while verifying 0.2's fix: `orgs`/`project` creation was RLS-blocked from migration 0001 onward (same INSERT-time bootstrap class of bug as the `users` fix in 0019 — `OrgsService.create()`/`ProjectsService.create()` had never worked either; migration 0025), and the `conversations.e2e.spec.ts` fixture (first successful run ever) had its own bug omitting `orgs.owner_id`.
18. **xlsx CVE (0.6)** — swapped SheetJS's abandoned npm package for exceljs; rewrote the extractor (no `sheet_to_csv` equivalent — manual row/cell walk + CSV quoting), added 4 tests (this extractor had zero prior coverage). Found and fixed a collateral regression the swap caused: exceljs's shipped types globally augment `Buffer` (a known upstream wart), and separately pulled a second, newer `@types/node@26` into the lockfile that pnpm resolved for the unrelated `mcp-connectors` package too, breaking 3 files there. Pinned `@types/node` workspace-wide via `pnpm.overrides` so one package's tooling deps can't do that again.
19. **P1 batch** — extracted the duplicated `LUA_RATE_LIMIT` script (byte-identical in conversations/knowledge) into `apps/api/src/modules/common/redis/rate-limit.ts` (`enforceRateLimit` + the lower-level `incrementCounterWithExpiry`), then ported the in-memory auth/2FA rate limiters (IP bucket, account lockout, 2FA challenge attempts — all single-process-only, broken under horizontal scaling) onto the same Redis primitive, preserving each one's original HTTP status semantics (401 for auth, 429/503 for conversations/knowledge). Verified live against real Redis: lockout counter reaches the threshold with the correct TTL, IP bucket independently enforces too. Deleted `packages/db/src/seed/personas.ts` (421 lines, fully unreferenced, migration 0011 is canonical). Mounted `ArtifactPane` into `ChatRoom` behind a new toggle button in `RoomHeader` (`DiffView`/`VersionSwitcher` were never independently orphaned — `ArtifactPane` already imports both; the whole subtree just needed one mount point) — added tests for the toggle (RoomHeader.test.tsx) since none existed. Wired `apps/web/lib/auth.ts`'s `redirectToLogin` into the api-client's failed-refresh path (session fully expired, not just the access token) — the missing other half of the 0.1 fix; added 4 tests covering the refresh/retry/redirect/dedup behavior, since api-client.ts had zero prior coverage. Investigated 2.2 (`users` SELECT policy) and 2.3 (JWT revocation) — found the report's suggested 2.2 fix would break admin's 2FA-reset flow (see the corrected note in section 2), confirmed 2.3's TTL already meets the report's own bar. Both left for a dedicated follow-up rather than a rushed fix.

Full-workspace regression after every round in this session: 0 typecheck errors, all tests green (892 across 10 packages as of round 3), tenant-probe suite 28/28 live, db suite 50/50 live.
