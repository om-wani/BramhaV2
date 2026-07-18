# 03 — Implementation Phases (`implementation_phases.md`)

The master task list for the Implementation Agent. Execute tasks **in order within each epic**;
epics within a phase may interleave only where `Depends` allows. Every task ships with:
**Files** (primary touchpoints — see `02_project_structure.md`), a **Security Configuration**
checklist (derived from `07_security_compliance.md`) and an **Acceptance Criteria** checklist.
A task is DONE only when both checklists pass and its tests are green in CI.

Global definition of done (applies to EVERY task, not repeated below):
- [ ] Typecheck + eslint (incl. boundaries & security plugins) pass.
- [ ] New logic has colocated vitest tests; changed behavior has updated tests.
- [ ] All cross-boundary payloads are Zod schemas in `packages/shared`.
- [ ] No secrets, no `console.log`, structured Pino logging with redaction only.
- [ ] Audit-relevant actions emit `audit_log` rows.

---

# PHASE 1 — SaaS Shell, Dashboards, Local SecOps & Auth

Goal: a deployable, secure, multi-tenant SaaS skeleton: landing → register → verified login →
project dashboard → empty project workspace shell. No agents yet.

## Epic 1.1 — Repository & toolchain foundation

### T1.1.1 Monorepo scaffold
**Files:** root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.editorconfig`, `.gitignore`
Create Turborepo+pnpm workspace with empty `apps/{web,api,agent-runtime,ingestion-worker}` and
`packages/{shared,db,agents,event-bus,mcp-connectors}` stubs (each: `package.json`, `src/index.ts`,
`tsconfig.json`, `vitest.config.ts`). Pipeline: `lint`, `typecheck`, `test`, `build` with correct
`dependsOn`.
**Security Configuration:**
- [ ] `.gitignore` blocks `.env*` (except `.env.example`), `*.pem`, `*.key`, coverage, `.turbo`.
- [ ] `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- [ ] pnpm config: `save-exact=true`, lockfile committed, `engine-strict=true`.
**Acceptance Criteria:**
- [ ] `pnpm install && pnpm turbo build test lint typecheck` succeeds from clean clone.
- [ ] Adding a file in `packages/shared` and importing from `apps/api` typechecks via workspace ref.

### T1.1.2 Lint, boundaries & pre-commit rails
**Files:** `.eslintrc.cjs` (root+per-pkg), `.pre-commit-config.yaml`/husky, `lint-staged.config.mjs`, `commitlint.config.cjs`
ESLint with `eslint-plugin-boundaries` enforcing the dependency rules in 02-doc, plus
`eslint-plugin-security`. Husky pre-commit: gitleaks, lint-staged (eslint+prettier), typecheck.
Commitlint conventional commits.
**Security Configuration:**
- [ ] gitleaks hook blocks a fixture commit containing a fake AWS key (test it, then remove fixture).
- [ ] Boundaries rule fails a test import of `apps/api` from `packages/shared`.
- [ ] Rule banning vendor SDK imports outside `packages/agents/src/providers/**` active.
**Acceptance Criteria:**
- [ ] A commit with lint errors is rejected locally; clean commit passes in <30 s.

### T1.1.3 Dev environment compose stack
**Files:** `infra/docker/compose.dev.yml`, `scripts/bootstrap.sh`, `scripts/check-env.ts`, `.env.example`
Compose services: postgres:16 (+pgvector image), redis:7, minio, clamav, otel-collector,
grafana+loki+prometheus (optional profile). Networks: `app`, `data`, `mcp-isolated (internal: true)`.
`bootstrap.sh`: install → compose up → wait-healthy → migrate → seed.
**Security Configuration:**
- [ ] All service ports bound to 127.0.0.1 only; dev creds distinct & obviously fake (`dev_only_*`).
- [ ] `check-env.ts` (dotenv-safe) fails fast on missing/extra vars vs `.env.example`.
- [ ] MinIO buckets created with private ACLs by bootstrap; no anonymous policy.
**Acceptance Criteria:**
- [ ] `./scripts/bootstrap.sh` from clean machine reaches healthy stack in one command.
- [ ] `docker compose config` shows `mcp-isolated` as internal network.

### T1.1.4 CI pipelines (build + security lanes)
**Files:** `.github/workflows/{ci.yml,security.yml}`, `.github/dependabot.yml`
`ci.yml`: pnpm cache, lint, typecheck, unit tests, build — required check. `security.yml`:
gitleaks full-history, Semgrep (owasp + ts rules), osv-scanner, `pnpm audit --audit-level=high`
— required check. Dependabot weekly for npm/docker/actions.
**Security Configuration:**
- [ ] Workflows use pinned action SHAs; `permissions:` blocks minimal (`contents: read`).
- [ ] Security lane FAILS the build on high/critical findings (no `continue-on-error`).
**Acceptance Criteria:**
- [ ] Both workflows green on the scaffold; a PR introducing `aws_secret_access_key="AKIA..."` fixture fails security lane (verify then revert).

## Epic 1.2 — Contract layer & database foundation

### T1.2.1 Shared schema package
**Files:** `packages/shared/src/{schemas,events,errors.ts,constants.ts,ws-protocol.ts}`
Implement Zod schemas for Phase-1 domains (users, orgs, projects, members, sessions) + error
catalog (problem+json codes) + constants (limits from 05/07 docs). Export inferred types.
**Security Configuration:**
- [ ] All object schemas use `.strict()` (unknown-key rejection) unless explicitly documented.
- [ ] Email/slug/uuid refinements centralized (one definition each).
**Acceptance Criteria:**
- [ ] `RegisterInput.parse({extra:'x',...})` throws; error catalog has stable unique codes; 100% of schemas have a round-trip test.

### T1.2.2 Drizzle setup + identity/tenancy tables + RLS scaffolding
**Files:** `packages/db/src/{schema/identity.ts,schema/projects.ts,migrations/0001_*.sql,rls.ts,client.ts}`
Tables from 05-doc §1 (`users`, `auth_sessions`, `orgs`, `org_members`, `projects`,
`project_members`) with indexes. Migration creates roles `bramha_app` (no ownership),
`bramha_migrator`; enables + FORCES RLS with policies from 05-doc §9; implements
`withTenant(fn, {userId, projectId?})` running `SET LOCAL app.*` in a transaction.
**Security Configuration:**
- [ ] `FORCE ROW LEVEL SECURITY` on every tenant table; app connects as `bramha_app` only.
- [ ] `withTenant` is the sole exported query entry point; direct client export is package-private.
- [ ] pgTAP (or vitest+testcontainers) test: user B cannot SELECT user A's project rows.
**Acceptance Criteria:**
- [ ] `pnpm db:migrate && pnpm db:seed` idempotent; RLS probe tests pass; EXPLAIN on `projects` lookup uses index.

### T1.2.3 Seed & fixtures
**Files:** `packages/db/src/seed/{index.ts,fixtures.ts}`
Dev seed: 2 orgs, 3 users (owner/member/outsider), 2 projects — the standing fixture set every
future RLS probe reuses.
**Security Configuration:**
- [ ] Seed refuses to run when `NODE_ENV=production`.
**Acceptance Criteria:**
- [ ] Re-running seed is idempotent (upserts, stable UUIDs from fixtures file).

## Epic 1.3 — API gateway & auth

### T1.3.1 NestJS skeleton with security middleware
**Files:** `apps/api/src/{main.ts,app.module.ts,common/**}`
Fastify adapter; helmet-equivalent headers per 07-doc §A4; strict CORS allowlist from env;
`ZodValidationPipe` global; problem+json exception filter (no stacks); Pino with redaction;
OpenAPI at `/docs` (disabled in prod); `health` module (liveness + readiness pinging pg/redis).
**Security Configuration:**
- [ ] Response headers verified by test: HSTS, nosniff, frameguard, referrer-policy, CSP.
- [ ] CORS test: disallowed origin gets no ACAO header; credentials mode only for exact origins.
- [ ] Error filter test: thrown Error returns problem+json, no `stack`, code `internal_error`.
**Acceptance Criteria:**
- [ ] `GET /health/ready` 200 with dependency latencies; OpenAPI JSON valid; supertest e2e harness runs.

### T1.3.2 Registration, email verification, login, sessions
**Files:** `apps/api/src/modules/auth/**`
Endpoints: `POST /auth/register`, `POST /auth/verify`, `POST /auth/login`, `POST /auth/refresh`,
`POST /auth/logout`, `GET /auth/me`. argon2id hashing; access JWT (EdDSA, 15 min, kid header);
refresh rotation with family-reuse detection (05-doc §1 `auth_sessions`); cookies
`HttpOnly Secure SameSite=Lax`; email via dev mailpit container.
**Security Configuration:**
- [ ] Full checklist of 07-doc §3 items implemented & individually tested: lockout, rate limit,
      constant-time compare, generic errors, token hashing (sha256) at rest, single-use verify tokens.
- [ ] Refresh-reuse test: replaying a rotated token revokes the whole family (all sessions 401).
- [ ] JWT validation asserts iss/aud/exp/nbf and rejects `alg:none` / HS256 downgrade.
**Acceptance Criteria:**
- [ ] e2e: register → verify → login → me → refresh → logout happy path.
- [ ] Unverified users get 403 `email_unverified` on project creation.
- [ ] Audit rows for register/login/fail/logout with ip+ua.

### T1.3.3 TOTP 2FA + recovery codes
**Files:** `apps/api/src/modules/auth/twofactor.*`
Enroll (secret AES-GCM via `MASTER_KEY`), QR provisioning URI, challenge on login when enabled,
10 recovery codes (argon2 hashed, single-use).
**Security Configuration:**
- [ ] Secret never returned after enrollment; recovery codes shown once; ±1 step TOTP window only.
- [ ] 2FA challenge rate-limited (5/15 min) and bound to a short-lived pre-auth token, not email.
**Acceptance Criteria:**
- [ ] e2e: enroll → logout → login requires code → recovery code works exactly once.

### T1.3.4 Users, orgs, projects, memberships CRUD + guards
**Files:** `apps/api/src/modules/{users,orgs,projects}/**`, `common/guards/*`
Profile (name/avatar-key), org CRUD (owner role), project CRUD within org, member invite (by
email, role enum), `ProjectMemberGuard(role)` + `AdminGuard`. `RlsSessionInterceptor` wires every
request through `withTenant`.
**Security Configuration:**
- [ ] IDOR test matrix: outsider user hits every route with victim IDs → 403/404, zero data.
- [ ] Role escalation test: `editor` cannot change roles; last-owner removal blocked.
- [ ] All mutations audited with actor/target.
**Acceptance Criteria:**
- [ ] e2e covers create org→project→invite→accept→role change→archive; OpenAPI complete for all routes.

### T1.3.5 API keys (scoped, hashed)
**Files:** `apps/api/src/modules/users/api-keys.*`
Prefixed keys `bmv2_<8id>_<32rand>`; store sha256; scopes (`read`, `write`); last-used tracking.
**Security Configuration:**
- [ ] Raw key shown once; lookup by prefix+hash compare; per-key rate bucket.
**Acceptance Criteria:**
- [ ] Key auth works on `GET /auth/me`; revoked key 401s within 1 request.

## Epic 1.4 — Web app shell

### T1.4.1 Next.js scaffold + design system
**Files:** `apps/web/{next.config.mjs,middleware.ts,app/layout.tsx}`, `components/ui/**`, tailwind config
App Router, Tailwind+shadcn init, dark-first tokens + persona accent palette (06-doc §9), base
layout, typed `api-client.ts` (Zod-parsed), TanStack Query provider.
**Security Configuration:**
- [ ] next.config CSP: nonce-based script-src, `frame-ancestors 'none'`, no `unsafe-inline` styles beyond Tailwind requirement documented.
- [ ] `middleware.ts` sets security headers on all routes; auth-gate for `(app)` group.
**Acceptance Criteria:**
- [ ] Lighthouse a11y ≥ 95 on landing; CSP violations zero in console on all Phase-1 pages.

### T1.4.2 Landing + pricing pages
**Files:** `apps/web/app/(marketing)/**`
Per 06-doc §7 landing spec; static, responsive, zero client JS beyond nav; SEO meta + OG images.
**Security Configuration:**
- [ ] No third-party scripts; external links `rel="noopener noreferrer"`.
**Acceptance Criteria:**
- [ ] CLS < 0.1, LCP < 2 s local; renders correctly at 360px/768px/1440px.

### T1.4.3 Auth screens
**Files:** `apps/web/app/(auth)/**`
Register (zxcvbn meter), login, verify interstitial, 2FA challenge, forgot/reset flows wired to
1.3.x endpoints with problem+json error mapping to friendly copy.
**Security Configuration:**
- [ ] Generic failure copy (no enumeration); paste allowed in password fields; autocomplete attrs correct (`new-password`/`current-password`/`one-time-code`).
**Acceptance Criteria:**
- [ ] Playwright: full register→verify(mailpit)→2FA→login journey green.

### T1.4.4 Project dashboard + settings pages
**Files:** `apps/web/app/(app)/{dashboard,settings}/**`
Per 06-doc §7: project cards, new-project wizard (blank template only this phase), profile,
security (sessions list + revoke, 2FA mgmt), api-keys pages.
**Security Configuration:**
- [ ] Session revoke takes effect on next request (test); avatar upload deferred to Phase 2 pipeline (placeholder initials avatar now — no raw upload path exists this phase).
**Acceptance Criteria:**
- [ ] Playwright: create project → appears on dashboard → archive hides it; revoke-other-session flow works.

### T1.4.5 Workspace shell (empty rooms)
**Files:** `apps/web/app/(app)/p/[projectId]/**` (layout + placeholder pages), `components/rooms/RoomHeader.tsx`
Nav rail with all rooms (06-doc §2) routing to placeholder pages ("Room under construction"),
project switcher, membership-gated layout.
**Security Configuration:**
- [ ] Direct URL to a non-member project → 404 page (not 403 with existence leak).
**Acceptance Criteria:**
- [ ] Keyboard nav (`g c` etc.) works; active room highlighted; breadcrumbs correct.

**PHASE 1 EXIT GATE:** all above green in CI; `security.yml` clean; RLS probe suite (identity
tables) green; demo: register→verify→2FA→create project→walk empty rooms.

---

# PHASE 2 — Graph Chat DB, Real-time UI, Artifact Engine & Secure Ingestion

Goal: fully working non-linear chat (user-only, no agents yet), streaming infrastructure,
sandboxed artifacts, secure uploads + knowledge layer, CEO's Office, Storage Room.

## Epic 2.1 — Conversation DAG core

### T2.1.1 DAG schema + append-only machinery
**Files:** `packages/db/src/schema/conversations.ts`, `migrations/00xx_dag.sql`
Tables per 05-doc §3 (`rooms`, `room_participants`, `conversations`, `conversation_nodes`,
`node_links`, `branches`, `user_room_state`) with ltree, triggers (append-only enforcement,
depth/path maintenance, node_links cycle guard), indexes, RLS policies.
**Security Configuration:**
- [ ] UPDATE/DELETE on `conversation_nodes` raises exception even as `bramha_app` (trigger test).
- [ ] RLS probes for all new tables added to fixture suite.
- [ ] Cycle-guard test: inserting a link closing a loop fails.
**Acceptance Criteria:**
- [ ] Property test: 1000 random appends/forks maintain `depth = parent.depth+1` and valid ltree paths; ancestor slice of depth-500 chain < 10 ms in test container.

### T2.1.2 Conversation service + REST API
**Files:** `apps/api/src/modules/{rooms,conversations}/**`
Implement the operations contract (05-doc §3): `appendNode` (idempotency-key, optimistic
head-advance with auto-fork), `fork`, `slice`, `graph`, branch CRUD, room CRUD
(conference auto-created per project; meeting/call creation).
**Security Configuration:**
- [ ] Idempotency-Key replay returns the original node (no dupes); keys stored 24 h in Redis.
- [ ] Membership guard on every route; node content Zod-validated incl. mention list; max content 32 kB.
- [ ] Rate limit: 20 msg/min/user (bucket test).
**Acceptance Criteria:**
- [ ] Concurrency test: 2 parallel appends to same head → one advances branch, other lands as sibling + auto-fork branch created (no lost writes across 100 iterations).
- [ ] `graph` endpoint returns nodes+edges+branches paginated; e2e for fork/switch/rename branch.

### T2.1.3 Event bus package + realtime gateway
**Files:** `packages/event-bus/src/**`, `apps/api/src/modules/realtime/**`
Typed publish/subscribe wrapper (Zod payloads, channel builders with `:{projectId}` suffix);
Socket.IO gateway with Redis adapter; `WsAuthGuard` (JWT on handshake, membership on every
`room.join`); relay of `conv.*` events; presence channel; SSE fallback endpoint
`GET /events/:conversationId` (last-event-id resume).
**Security Configuration:**
- [ ] WS join to non-member room refused (test); server never relays a channel the socket didn't successfully join.
- [ ] Handshake with expired JWT → disconnect with `auth_expired`; re-auth flow client-side.
- [ ] Per-user socket cap 5; message-size cap 64 kB; malformed frames dropped + counted.
**Acceptance Criteria:**
- [ ] Two browsers in one room see each other's messages < 300 ms locally; SSE fallback passes the same e2e with WS disabled.

### T2.1.4 Chat room UI (user-only) with branching
**Files:** `apps/web/components/chat/**`, `app/(app)/p/[projectId]/conference/page.tsx`, `lib/{socket.ts,stores/*}`
MessageList (virtualized), Composer, BranchChips, branch-from-message, branch switcher +
crossfade, sibling swipe group, unread cursors (`user_room_state`), typing indicators.
**Security Configuration:**
- [ ] All message text rendered via safe markdown pipeline (rehype-sanitize allowlist; no raw HTML pass-through) — XSS fixture corpus test (`<img onerror>`, javascript: links, etc.).
**Acceptance Criteria:**
- [ ] Playwright: send, branch from an old message, switch branches, reload → state persists; 5k-node conversation scrolls at 60 fps (virtualization verified).

### T2.1.5 Graph view
**Files:** `apps/web/components/graph/**`, `app/.../graph/[conversationId]/page.tsx`
React Flow DAG per 06-doc §4 (dagre layout, node drawer, open-in-room, branch-from-node, live
inserts, subtree pagination).
**Security Configuration:**
- [ ] Node previews sanitized same as chat; drawer fetches by id through guarded API only.
**Acceptance Criteria:**
- [ ] 500-node graph renders < 1.5 s; clicking "open in room at node" lands scrolled to that node on the right branch.

## Epic 2.2 — Artifact engine

### T2.2.1 Artifact schema + streaming API
**Files:** `packages/db/src/schema/artifacts.ts`, `apps/api/src/modules/artifacts/**`
Tables per 05-doc §4 (content in S3); endpoints: create/update (server-side used by runtime later,
user-side for manual docs), get version content via presigned or proxied stream;
`artifact.stream.chunk` bus events; render-token endpoint for the sandbox route.
**Security Configuration:**
- [ ] Version content immutable (new version per change); size cap 2 MB enforced pre-store; sha256 verified.
- [ ] Render tokens: 5 min TTL JWT bound to (artifactId, version); artifact-serving route requires it.
**Acceptance Criteria:**
- [ ] Streaming a 200 kB artifact in 2 kB chunks reassembles byte-identical (sha check) with ordered seq handling + gap re-request.

### T2.2.2 Sandboxed artifact renderer
**Files:** `apps/web/components/artifacts/**`, artifact-serving route (`apps/web/app/artifact-frame/route.ts` or `apps/api` static route)
ArtifactPane with tabs/versions/diff per 06-doc §8; `ArtifactFrame` iframe `sandbox="allow-scripts"`,
null origin, CSP `default-src 'none'; script-src 'unsafe-inline'` (frame-only), postMessage bridge
(height/console/errors); Sandpack runner for `react` kind; code/markdown/mermaid/csv viewers.
**Security Configuration:**
- [ ] Escape-attempt corpus test: artifact JS cannot read `document.cookie` of parent, cannot `top.location`, cannot fetch API origin (CSP blocks), postMessage from wrong origin ignored.
- [ ] In prod config, frame served from `ARTIFACT_ORIGIN` env (separate domain) — asserted by config test.
**Acceptance Criteria:**
- [ ] `react` artifact with a stateful counter runs; `html` artifact renders; malformed code shows error overlay not a blank pane; version diff view works.

## Epic 2.3 — Secure file ingestion & knowledge layer

### T2.3.1 Upload flow (presigned) + file registry
**Files:** `apps/api/src/modules/files/**`, `packages/db/src/schema/files.ts`, `apps/web/components/chat/FileDropzone.tsx`
Per 05-doc §5 + 3.2 dataflow: metadata → presigned PUT to `staging/` → confirm → enqueue
`ingest.file`. File cards in chat with scan-state machine; avatar upload from Phase 1 now
switches to this pipeline.
**Security Configuration:**
- [ ] Presigned PUT: 60 s TTL, exact content-length range, key server-generated (no user paths).
- [ ] Declared MIME/extension allowlist enforced BEFORE presign; per-user quota 10 uploads/h, 500 MB/project (configurable).
- [ ] Bucket policy test: direct GET on `staging/*` and `clean/*` without presign → 403.
**Acceptance Criteria:**
- [ ] 50 MB file uploads with progress; refresh mid-upload → resumable or clean restart; card reaches `Scanning` state.

### T2.3.2 Ingestion worker: security gate
**Files:** `apps/ingestion-worker/src/{main.ts,security/**}`
BullMQ consumer implementing the ordered fail-closed gate of 07-doc §4: size, magic-byte vs
declared, allowlist, ClamAV, per-type disarm (sharp re-encode, pdf strip, svg sanitize/rasterize,
zip caps), quarantine mover + `ingest.*` events.
**Security Configuration:**
- [ ] Hostile fixture corpus in `test/`: EICAR (→quarantined), PDF-with-JS (→disarmed, flag logged), GIF-renamed-.pdf (→rejected mime mismatch), 10⁶:1 zip bomb (→rejected ratio), SVG with onload (→sanitized), polyglot JPEG/HTML (→re-encode strips).
- [ ] ClamAV down ⇒ queue pauses (jobs delayed), NEVER bypass; alert log emitted.
- [ ] Worker container in compose has no egress except minio/pg/redis/clamav (network assert script).
**Acceptance Criteria:**
- [ ] Clean file: staging→clean move, `files.scan_status='clean'`, chat card `Ready`; each hostile fixture ends in documented terminal state with audit rows.

### T2.3.3 Extraction, chunking, embedding
**Files:** `apps/ingestion-worker/src/{extractors/**,chunking.ts,embedder.ts}`, `packages/db/src/schema/knowledge.ts`, `packages/agents/src/{model-router.ts(embeddings),providers/*,token-count.ts}`
Extractors (pdf, docx, md, csv, txt, code w/ tree-sitter); heading-aware chunker (512/64);
**first ModelRouter slice**: `embeddings()` with provider abstraction, batching, retry;
`knowledge_chunks` inserts with tsvector + HNSW index migration.
**Security Configuration:**
- [ ] Embedding API calls: request size caps, provider key from env only in worker, chunk text logged never (ids only).
- [ ] `knowledge_chunks` RLS + composite `(project_id, origin)` index verified by EXPLAIN test.
**Acceptance Criteria:**
- [ ] 30-page PDF → chunks with correct heading_trails, token_counts ±5% of tokenizer, embeddings dimension matches config; re-ingest same file replaces chunks (no dupes).

### T2.3.4 Hybrid search API
**Files:** `apps/api/src/modules/files/search.*` (or `knowledge` module), `packages/db` query helpers
Implement 04-doc §2.3 hybrid retrieval (lexical+vector RRF, origin dedupe, recency boost) as a
service + `POST /projects/:id/knowledge/search` endpoint (used by UI now, PA engine in Phase 3).
**Security Configuration:**
- [ ] Cross-tenant vector probe: tenant B search never returns A's chunks (test with adversarial identical text in both tenants).
**Acceptance Criteria:**
- [ ] Relevance smoke suite: 20 seeded Q→chunk pairs, top-3 hit rate ≥ 90%; p95 < 400 ms on 50k chunks.

### T2.3.5 Storage Room UI
**Files:** `apps/web/components/storage/**`, `app/.../storage/page.tsx`
File explorer + preview pane + ingestion history per 06-doc §6 (source connectors deferred to
Phase 3 — dialog present but only `manual upload` enabled).
**Security Configuration:**
- [ ] Preview via short-TTL presigned GET; pdf.js sandboxed (no eval), csv preview caps 10k rows.
**Acceptance Criteria:**
- [ ] Upload in conference room → appears in Storage Room with origin chip; preview all supported types; quarantined file shows red badge, no download affordance.

## Epic 2.4 — CEO's Office

### T2.4.1 Notes backend + backlinks + note-delta ingestion
**Files:** `apps/api/src/modules/notes/**`, `packages/db/src/schema/notes.ts`, ingestion-worker `note_delta` handler
CRUD, folder move, soft delete/restore, wikilink parser → `note_links`, debounced `note_delta`
jobs re-embedding changed blocks (origin=`ceo_office`, stale-swap per 05-doc §11).
**Security Configuration:**
- [ ] Note content sanitized server-side (same markdown pipeline); RLS probes; note images use file pipeline.
**Acceptance Criteria:**
- [ ] Editing one section re-embeds only its chunks (chunk-id stability test); backlinks update on save; deleted note's chunks removed within one housekeeping cycle.

### T2.4.2 Office UI (TipTap three-pane)
**Files:** `apps/web/components/office/**`, `app/.../office/**`
Per 06-doc §5: tree, TipTap markdown editor with wikilink autocomplete, backlinks pane, local
graph, daily note, sync-state indicator.
**Security Configuration:**
- [ ] Paste sanitization (HTML paste → markdown); wikilink autocomplete queries guarded endpoint.
**Acceptance Criteria:**
- [ ] Playwright: create note, link `[[Other Note]]`, see backlink, search finds note content via knowledge search (proves the memory loop), sync indicator cycles synced→syncing→synced.

**PHASE 2 EXIT GATE:** demo — user chats with self in conference room, branches a message,
views the DAG, uploads a PDF that flows to Storage Room + becomes searchable, writes a note that
becomes searchable, creates a manual document artifact rendered in the sandbox. Hostile-file
corpus fully green. Cross-tenant probes green for all new tables.

---

# PHASE 3 — Multi-Agent Orchestration Engine, Event Bus Maturity & Isolated MCP

Goal: the council comes alive — personas, ModelRouter chat, PA engine, turn engine, C-Suite
streaming turns, delegation to workers, MCP infrastructure, thought/status streaming UI.

## Epic 3.1 — Model & persona foundation

### T3.1.1 ModelRouter chat streaming + policies
**Files:** `packages/agents/src/{model-router.ts,providers/{anthropic,openai,ollama}.ts,semantic-cache.ts}`, `packages/db/src/schema/agents.ts`
Full 01-doc §4: normalized stream (`thought|content|tool_call|usage`), failover ladder, circuit
breakers, per-turn/day budget accounting to `token_usage`, prompt-cache flags, semantic cache for
utility calls. Schema: `agent_personas`, `agent_model_policies`, `project_agents` + RLS + seed
from 08-doc §5.
**Security Configuration:**
- [ ] Provider keys only via env in runtime processes; never persisted; router redacts keys from errors.
- [ ] Budget breach aborts stream mid-flight (test with mock provider) and writes partial usage.
- [ ] Vendor-SDK import boundary lint rule proven against a violation fixture.
**Acceptance Criteria:**
- [ ] Mock-provider tests: failover on 429, mid-stream abort, usage math exact; swapping a persona's model via DB row takes effect next turn (hot-reload test); real-provider smoke test behind env flag.

### T3.1.2 Persona compiler
**Files:** `packages/agents/src/persona.ts`, `packages/db/src/seed/personas.ts`
Template compiler per 08-doc §1 (stable ordering, shared clauses), compiled-prompt cache with
bust-on-update, seed all 8 C-Suite + 7 workers + policies + default grants.
**Security Configuration:**
- [ ] `safety_clauses` present in EVERY compiled prompt (assert in compiler, not just seed).
- [ ] Template engine escapes/strips template injection from project brief (`{{...}}` in user data stays literal).
**Acceptance Criteria:**
- [ ] Byte-stability test: same inputs → identical prompt across runs (cache-prefix guarantee); admin edit → recompiled once.

## Epic 3.2 — PA engine (deterministic)

### T3.2.1 Relevance scorer + turn policies
**Files:** `apps/agent-runtime/src/{pa/relevance.ts,orchestrator/turn-policies.ts}`
Exact formula 04-doc §2.1 (BM25 lexicon, expertise centroid from tag embeddings computed at seed,
mention/summon detection, ownership, open loops, fatigue, seeded jitter) + per-room policies.
**Security Configuration:**
- [ ] Scorer treats message text as data only (no eval/regex-DoS: linear-time patterns, input length caps).
**Acceptance Criteria:**
- [ ] Table-driven suite (≥30 scenarios from 04-doc): mention beats everything; CFO wakes on "pricing"; fatigue suppresses double-reply; conference θ silences all-but-relevant; deterministic across runs.

### T3.2.2 Working memory + context bundles + rolling summaries
**Files:** `apps/agent-runtime/src/pa/{working-memory.ts,context-bundle.ts,summarizer.ts}`, `packages/db` (working_memory, checkpoints tables)
Fact/open-loop heuristics, capped stores; bundle assembler with exact section order + token
budgeting; shared per-branch rolling summary via utility tier at 3.5k threshold.
**Security Configuration:**
- [ ] RAG block and any file/MCP content wrapped by the shared `untrustedContext()` wrapper (breakout corpus test).
- [ ] Bundle hard cap enforced even if token-count underestimates (safety margin 5%).
**Acceptance Criteria:**
- [ ] Bundle golden tests: given fixture conversation, bundle matches snapshot within budget; summary job fires exactly once per threshold crossing; open loop closes when agent answers it.

## Epic 3.3 — Turn engine & C-Suite loop

### T3.3.1 Orchestrator turn engine
**Files:** `apps/agent-runtime/src/orchestrator/{turn-engine.ts,budget-guard.ts}`, `main.ts`
Consume `conv.node.created` → roster → scores → speaker set → enqueue `agent-turns` jobs
(per-conversation concurrency group ≤3); budgets (turn_depth ≤4, delegation caps, daily USD
circuit breaker + `agents_paused` check per event).
**Security Configuration:**
- [ ] Engine runs as system-membership identity (05-doc §9.2) — RLS probe: engine processing project A job cannot read project B rows.
- [ ] Poison-message handling: malformed events → DLQ + alert, consumer keeps running.
**Acceptance Criteria:**
- [ ] Simulated 3-agent room: user message → correct speaker set enqueued in score order; depth-4 agent chain stops; pause flag halts scheduling within 1 event.

### T3.3.2 C-Suite LangGraph loop + core tools
**Files:** `apps/agent-runtime/src/agents/{csuite-loop.ts,checkpointer.ts,tools/*}` (create_artifact, search_knowledge, read_node/branch, summon_agent, end_turn)
Graph per 04-doc §3 with Postgres checkpointer, streaming to bus channels, node persistence with
`token_usage`, working-memory self-update. (delegate_task/mcp_call/run_code in later epics.)
**Security Configuration:**
- [ ] Tool args Zod-validated inside runtime (defense in depth vs model output); tool iteration cap 6; tools outside persona allowlist absent from schema list (test).
- [ ] Thought stream persisted to S3 key referenced in node meta — never in Postgres content (size).
**Acceptance Criteria:**
- [ ] e2e with mock model: turn streams thought+content, creates artifact via tool, persists node on correct branch parent; interrupt flag mid-stream → checkpoint + `interrupted` status; usage row written.

### T3.3.3 Live agent chat UI (streaming, thoughts, status, mentions)
**Files:** `apps/web/components/chat/{ThoughtsCollapse,StatusTag,AgentChip,MentionMenu}.tsx`, stream store
Render simultaneous agent streams, thought collapse w/ token ticker, status pills (exact labels
04-doc §3), @mention autocomplete from roster, stop buttons (per-agent + global), system lines for
summons, sibling parallel-reply UI.
**Security Configuration:**
- [ ] Streamed content sanitized incrementally (no partial-tag XSS during streaming — fixture test).
**Acceptance Criteria:**
- [ ] Playwright with mock runtime: two agents stream simultaneously in distinct bubbles; stop halts one and leaves the other; @CTO summons Vulcan; thoughts expand/collapse live.

### T3.3.4 Interrupts & summons engine
**Files:** `apps/agent-runtime/src/orchestrator/interrupts.ts`
Full 04-doc §5.1/5.2: stop (abort+checkpoint), summon scheduling, agent interjection via
`interrupt_threshold`, redirect (abort-all on branch), Redis interrupt flags checked between
graph nodes.
**Security Configuration:**
- [ ] Interrupt authz: only room members / roster agents can raise; interrupt events audited.
**Acceptance Criteria:**
- [ ] Scenario suite: user stop mid-tool-call cancels cleanly (no orphan jobs); CFO interjects on unpriced commitment fixture; redirect clears queue (BullMQ inspected).

## Epic 3.4 — Delegation & workers

### T3.4.1 Delegation manager + specialist loop
**Files:** `apps/agent-runtime/src/{delegation/**,agents/specialist-loop.ts}`, `packages/db/src/schema/delegations.ts`, `apps/api/src/modules/delegations/**`
Full lifecycle 04-doc §4: `delegate_task` tool, authority validation, isolated worker context,
budget guard (usd/seconds/toolCalls), group bus (caps), report-back turn scheduling, cancel API,
read-model endpoints for Activity pane.
**Security Configuration:**
- [ ] Worker context contains ONLY spec+scoped RAG (snapshot test proves no transcript leakage).
- [ ] Authority matrix enforced (CMO cannot spawn code-reviewer — test); per-agent concurrent cap 3; runaway worker killed at maxSeconds with partial result.
**Acceptance Criteria:**
- [ ] e2e: Vulcan delegates research → worker runs (mock model) → progress events → completed → Vulcan's report-back node appears parented to origin without stealing branch head; cancel mid-run works.

### T3.4.2 Background Activity pane
**Files:** `apps/web/components/activity/**`
Per 06-doc §2: collapsed strip, live delegation/ingest entries, progress, cost, cancel, approval
inline actions (approvals functional next epic).
**Acceptance Criteria:**
- [ ] Delegation from 3.4.1 visibly progresses queued→running→completed; cancel button cancels; pane state persists per project.
**Security Configuration:**
- [ ] Pane data via guarded read-model only (no raw bus payloads with internal ids leaking to non-members — WS scoping test).

## Epic 3.5 — MCP infrastructure

### T3.5.1 Connector registry, client pool & policy engine
**Files:** `packages/mcp-connectors/src/{registry.ts,client/**}`, `packages/db` (mcp_connectors, mcp_grants), `apps/api/src/modules/approvals/**`
Manifest validation (04-doc §6.1), grants schema+admin API, policy engine (grant→classification→
args validation→secret-scan→rate bucket), capability JWT mint/verify (60 s, jti single-use),
approval flow endpoints + expiry sweep.
**Security Configuration:**
- [ ] Full 04-doc §6.2 path unit-tested including: missing grant, scope mismatch, oversized args, secret-pattern in args (denied+alerted), replayed jti (denied), expired token.
- [ ] Approval decisions require fresh session auth; payload hash bound (tamper test).
**Acceptance Criteria:**
- [ ] `mcp_call` tool wired into csuite loop; denied call surfaces as tool error the agent can read; approval modal round-trip approves a write call (mock connector).

### T3.5.2 First-party MCP servers (filesystem, database, git, web)
**Files:** `packages/mcp-connectors/src/servers/**`, `infra/docker/Dockerfile.mcp-node`, compose services on `mcp-isolated`
Four servers per 02-doc: fs (chroot `/data/{projectId}`), db (read-only tx, statement timeout,
row caps), git (clone/read), web (allowlisted fetch). mTLS with runtime; creds injected from
secrets at job time.
**Security Configuration:**
- [ ] fs path-traversal corpus (`../`, symlinks, null bytes) all denied; db `INSERT` attempt fails (read-only tx test); web fetch to non-allowlisted host denied; containers pass no-egress network assertion except manifest targets.
- [ ] Runtime/model never receives raw connector credentials (grep-level test on bundle + logs).
**Acceptance Criteria:**
- [ ] Live e2e in compose: agent reads a project file, queries seeded read-only Postgres, fetches an allowlisted URL — each with correct status pills + audit rows incl. argsHash.

### T3.5.3 Knowledge source connectors (GitHub/SQL/URL sync)
**Files:** `apps/ingestion-worker/src/sources/**`, `apps/api/src/modules/sources/**`, Storage Room connect dialog enablement
`knowledge_sources` CRUD (credential_ref → secrets manager), sync jobs (repo clone via git MCP
node, sql schema+sampled rows introspection, url crawl), scheduled re-sync, ingestion history UI.
**Security Configuration:**
- [ ] PATs/DB creds go straight to secrets manager; API returns only `credential_ref`; list endpoints never echo secrets (contract test).
- [ ] Crawl limits: same-origin, depth 3, 200 pages, robots.txt honored; repo clone size cap 500 MB.
**Acceptance Criteria:**
- [ ] Connect a fixture repo → files chunked/embedded → agent answers a question about the repo citing chunks; failed-auth source shows actionable error in UI.

**PHASE 3 EXIT GATE:** demo — in the conference room, CEO asks a product+pricing question; Iris
and Ledger answer (others stay silent = token frugality proven via usage rows), Iris delegates
research (visible in Activity pane), CFO interjects, user stops an agent mid-stream, Vulcan reads
a connected repo via MCP with approval-gated write denied. Chaos test: kill agent-runtime pod
mid-turn → no corruption, turn marked interrupted, system recovers.

---

# PHASE 4 — Spatial Rooms, Tenant-Isolation Verification & Async Interruption Maturity

Goal: full room metaphor (meetings, 1:1s, proactive PAs), cross-room context routing, hardened
multi-tenancy proofs, production-grade interruption/concurrency behavior.

### T4.1 Meeting rooms & 1:1 call rooms (full UX)
**Files:** `apps/web/app/.../{meeting,call}/**`, `components/rooms/CreateMeetingDialog.tsx`, rooms module extensions
Meeting creation (subset roster, seed prompt), auto-provisioned 1:1 rooms per hired agent,
persona bio cards, room archive.
**Security Configuration:**
- [ ] Roster changes re-checked server-side (cannot add non-hired persona via API tamper); room archive revokes WS channels within 5 s.
**Acceptance Criteria:**
- [ ] Playwright: create "Pricing War-Room" with Ledger+Orion; only they speak; 1:1 with Vulcan is isolated (Lyra never appears); turn policies (θ per room type) verified via usage rows.

### T4.2 Cross-room context routing rules
**Files:** `apps/agent-runtime/src/pa/context-bundle.ts` (routing layer), project settings
Codify what crosses rooms: knowledge chunks (all rooms, always), rolling summaries (same room
only), working-memory facts (agent-global per project), 1:1 confidentiality flag (facts learned
in a flagged 1:1 excluded from other rooms' bundles until user "debriefs" them).
**Security Configuration:**
- [ ] Confidential-1:1 leak test: fact planted in flagged 1:1 never appears in conference bundle (snapshot assertions across 20 generations).
**Acceptance Criteria:**
- [ ] Fact learned in conference is available to same agent in its 1:1; meeting-room summary does not bleed into other meetings; routing matrix documented in code and mirrored in project settings UI.

### T4.3 Proactive PA behaviors
**Files:** `apps/agent-runtime/src/pa/*` (proactivity), notifications queue
Stale open-loop follow-ups (04-doc §2.4), delegation-report nudges, daily standup summary note
(optional per project) posted to CEO's Office.
**Security Configuration:**
- [ ] Proactive turns rate-limited (1/h/agent, off by default); cannot fire in archived rooms.
**Acceptance Criteria:**
- [ ] Clock-advanced test: unanswered question to Meridian → follow-up appears in the right room ≤ policy window with follow-up badge; toggling off silences it.

### T4.4 Tenant-isolation verification battery (the Phase-4 security centerpiece)
**Files:** `apps/api/test/tenant-probes/**`, CI wiring in `security.yml`
Automated cross-tenant probe suite per 07-doc §4: every tenant table, every API route, vector
search, S3 presign, WS join/relay, bus channels, MCP capability tokens, delegation read models —
executed as tenant B against tenant A fixtures + a fuzzing layer (random IDs, role downgrades).
**Security Configuration:**
- [ ] Suite runs in CI as a required check; any returned row/200 fails build with a table/route report.
- [ ] Adds regression probes automatically: script asserts every table with `project_id` column has a probe (schema-driven, so new tables can't be forgotten).
**Acceptance Criteria:**
- [ ] Battery green; intentionally breaking one RLS policy in a scratch branch turns it red (verified once, reverted); report artifact uploaded to CI run.

### T4.5 Concurrency & interruption hardening
**Files:** `apps/agent-runtime/src/orchestrator/**`, load-test scripts `scripts/load/*`
Formalize auto-fork merge affordance UI, queue fairness (per-conversation round-robin), backpressure
(WS slow-consumer drop-to-SSE-resume), idempotent job replays, chaos suite (kill workers/redis
failover mid-turn).
**Security Configuration:**
- [ ] Interrupt flags and queue admin endpoints admin-guarded; chaos scripts refuse prod env.
**Acceptance Criteria:**
- [ ] k6/artillery scenario: 20 rooms × 3 agents × 5 min sustained — zero lost nodes, zero duplicate nodes (idempotency), p95 first-token < 2.5 s (mock model), branch integrity invariant checker passes; Redis failover mid-stream recovers with ≤1 retried turn.

### T4.6 Admin dashboard v1 + diagnostics
**Files:** `apps/web/app/(admin)/**`, `apps/api/src/modules/admin/**`
Per 06-doc §7: users admin, persona/policy editors (live prompt preview, cost estimates),
connector grant matrix, diagnostics (token spend charts from `token_usage_daily`, queue depths,
error rates, audit search).
**Security Configuration:**
- [ ] Admin routes: `AdminGuard` + 2FA-required + every view/action audited (admin-reads-tenant-data events surfaced to org owners per T11 threat).
**Acceptance Criteria:**
- [ ] Change Ledger's model in UI → next turn uses it (verify via usage row); grant matrix edit immediately affects policy engine; audit search finds the change.

**PHASE 4 EXIT GATE:** tenant battery green in CI; load/chaos suites green; full room-metaphor
demo across two isolated tenant accounts side-by-side.

---

# PHASE 5 — Production IaC, CI/CD, WAF, Diagnostics & High-Availability Deployment

Goal: everything from 07-doc Stage E — real infrastructure, hardened delivery, observability,
runbooks, launch.

### T5.1 Production containerization & sandbox runtime
**Files:** `infra/docker/Dockerfile.{api,web,agent-runtime,ingestion,mcp-node}`, `infra/docker/sandbox/**`, `infra/sandbox/src/**`
Multi-stage distroless images (nonroot, read-only fs, healthchecks); sandbox host service
implementing `run_code` pool per 01-doc §6.3 (dev: docker + seccomp profile; prod flag for
gVisor runtime class).
**Security Configuration:**
- [ ] trivy scan zero high/critical; images pinned by digest; sandbox escape corpus (network attempt, fork bomb, /proc probing, 1 GB alloc, 60 s spin) all contained & killed within caps.
- [ ] `run_code` tool disabled automatically if sandbox host unhealthy (fail-closed).
**Acceptance Criteria:**
- [ ] Full stack runs from built images (not source) via compose.prod-sim; `run_code` executes python+node fixtures with stdout captured, artifacts of 3.4 flows still green.

### T5.2 Terraform foundation (network, data, services)
**Files:** `infra/terraform/modules/{network,rds,elasticache,s3,ecs-services}/**`, `envs/staging/**`
Three-tier VPC per 07-doc §6, RDS (multi-AZ, KMS, PITR), ElastiCache TLS, S3 buckets
(staging/clean/quarantine/artifacts/audit-export with policies), ECS services for all units,
secrets from ASM/Doppler, remote state (S3+lock) — staging env applied.
**Security Configuration:**
- [ ] tfsec/checkov clean (no critical); SG matrix exactly least-privilege pairs (automated policy test via terraform-compliance); isolated subnet route tables have no IGW/NAT; VPC endpoints for S3/ASM/ECR.
- [ ] State bucket encrypted+versioned+access-logged; no secrets in state (sops for the few needed).
**Acceptance Criteria:**
- [ ] `terraform apply` staging from clean state converges; app reachable via ALB; DB/Redis unreachable from public internet (external scan script); teardown/re-apply idempotent.

### T5.3 Edge: WAF, CDN, TLS, artifact origin isolation
**Files:** `infra/terraform/modules/waf/**`, CDN config, web/artifact distributions
CloudFront (or equivalent) for web + SEPARATE distribution/domain for artifact frames; WAF managed
rules + rate rules + bot control (staging count-mode → prod block), TLS 1.2+, HSTS preload.
**Security Configuration:**
- [ ] WAF blocks test SQLi/XSS payload probes (staged verification); rate rule triggers on scripted flood; artifact domain has no cookies and distinct origin (browser-verified).
**Acceptance Criteria:**
- [ ] Artifact sandbox e2e re-run against staging domains passes; security-headers scan (Mozilla Observatory equivalent) grade A.

### T5.4 CI/CD delivery pipeline
**Files:** `.github/workflows/{docker-publish.yml,deploy.yml,e2e.yml}`
Build→SBOM(syft)→trivy→cosign sign→push (OIDC, no static keys); deploy: staging auto on main
(migrations w/ lock + auto-rollback on failed health), prod on tag with environment approval;
Playwright e2e lane against ephemeral compose; secret masking verified.
**Security Configuration:**
- [ ] Deploy role scoped to exact resources; signature verification at deploy (unsigned image rejected — tested); migrations run as `bramha_migrator` only; prod deploy events audit-logged + notified.
**Acceptance Criteria:**
- [ ] Tag `v0.1.0-rc1` → staging soak → approval → prod deploy < 15 min with zero-downtime (rolling, verified by uptime probe during deploy); one-command rollback restores previous task defs.

### T5.5 Observability, SIEM & alerting
**Files:** `infra/terraform/modules/observability/**`, otel wiring in all apps, dashboards-as-code
OTel traces (user→turn→tool→MCP chain via trace_id), Prometheus metrics (queue depth, token
spend rate, first-token latency, sandbox pool), Loki/CloudWatch logs, audit stream → Firehose →
object-locked S3 + OpenSearch; alert pack: auth anomalies, budget breaches 80/100%, DLQ growth,
egress denials, ClamAV down, WAF spikes; on-call routing.
**Security Configuration:**
- [ ] Log pipeline redaction verified end-to-end (fixture secret never reaches storage); audit export bucket object-lock compliance mode; SIEM latency < 30 s asserted by synthetic event.
**Acceptance Criteria:**
- [ ] Trace for one full agent turn visible end-to-end in staging; every alert fired once via synthetic trigger and routed; diagnostics dashboard (T4.6) now backed by prod metrics.

### T5.6 HA, backup & DR drills
**Files:** `infra/terraform/envs/prod/**`, `scripts/dr/**`, runbook docs
Multi-AZ everything, autoscaling policies (queue-depth for workers, CPU/RPS for api/web), RDS
PITR + weekly automated snapshot-restore drill with checksum verification, Redis failover test,
game-day script.
**Security Configuration:**
- [ ] Restore drill uses isolated VPC (no prod cred reuse); DR docs include key-rotation and breach runbooks per 07-doc §6.
**Acceptance Criteria:**
- [ ] Kill an AZ's tasks in staging → self-heal < 5 min, zero 5xx sustained; restore drill produces queryable DB with row-count checksums matching; RTO ≤ 4 h / RPO ≤ 15 min documented and demonstrated.

### T5.7 Launch hardening & pen-test pass
**Files:** fixes wherever found; `docs/runbooks/*`
External dependency review, OWASP ASVS L2 self-assessment against 07-doc, focused pen test
(auth, tenancy, sandbox, MCP, upload) — internal or contracted; fix criticals; freeze.
**Security Configuration:**
- [ ] ASVS checklist ≥ 95% pass, zero criticals/highs open; gitleaks/Semgrep/CodeQL/probe-battery all green on release commit.
**Acceptance Criteria:**
- [ ] Signed release `v1.0.0`; go-live checklist executed; post-launch monitoring week-1 review scheduled with alert thresholds tuned.

**PHASE 5 EXIT GATE = LAUNCH.**

---

## Dependency overview

```
P1 (shell/auth) ─→ P2 (DAG/artifacts/ingestion) ─→ P3 (agents/MCP) ─→ P4 (rooms/tenancy/chaos) ─→ P5 (prod)
Within P2: 2.1 ∥ 2.2 after 2.1.3;  2.3 ∥ 2.1;  2.4 after 2.3.3
Within P3: 3.1 → 3.2 → 3.3 → 3.4;  3.5 after 3.3.2 (mcp_call tool slot)
Within P4: 4.1→4.2→4.3;  4.4 anytime;  4.5 after 4.1;  4.6 anytime after 3.x
```
