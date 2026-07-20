# BramhaV2 — Task Tracker

> Living doc. Rules: `CLAUDE.md` §Task tracking. Update checkboxes as work lands (same commit as the code when possible). Statuses: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` dropped (add reason).
>
> Task IDs are stable — never renumber. Add new tasks at the end of their phase.

**Current phase: P4**

---

## P0 — Repo skeleton (gate: `pnpm dev` cold-starts on clean machine, zero installs beyond Node+pnpm)

- [x] P0.1 Wipe working tree to fresh monorepo root: pnpm workspaces + Turborepo, TS strict base config, shared eslint/prettier
- [x] P0.2 Scaffold `packages/shared` — zod, persona slugs, error catalog stub, WS event type stubs
- [x] P0.3 Scaffold `packages/db` — Drizzle setup, PGlite driver (local) / pg driver (DATABASE_URL set), migration runner + `schema_migrations` table, `withTenant()` skeleton
- [x] P0.4 Migration `0001_init.sql` — `CREATE EXTENSION vector`, all tables from `docs/02_mvp_data_model.md` §3, indexes
- [x] P0.5 Scaffold `packages/agents` — ModelRouter interface + provider wiring (env-driven), persona config type, 8 persona stubs
- [x] P0.6 Scaffold `packages/event-bus` — TypedEventBus over Node EventEmitter, event map from shared
- [x] P0.7 Scaffold `apps/server` — NestJS + Fastify adapter, health endpoint, security headers, CORS allowlist, ZodValidationPipe, problem+json filter, Socket.IO attach
- [x] P0.8 Scaffold `apps/web` — Next.js 14, route groups, middleware (CSP nonce + auth gate stub), Tailwind dark-first tokens, persona palette CSS vars
- [x] P0.9 CI: typecheck + lint + test on push (GitHub Actions)
- [x] P0.10 Gate check: clean-machine cold start (`git clone && pnpm i && pnpm dev`), health answers, migration 0001 applies on PGlite

## P1 — Auth + orgs (gate: cross-org isolation; auth gate on all (app) routes)

- [x] P1.1 Auth module: register (argon2id, zxcvbn ≥3 server-side, auto-verify), login, logout, sliding session (opaque token, SHA-256 in sessions table, HttpOnly Secure Lax cookie)
- [x] P1.2 `SessionAuthGuard` + open-redirect-safe `next` handling + enumeration-proof generic errors
- [x] P1.3 Orgs module: create org (creator=owner), org members CRUD
- [x] P1.4 Projects module: create project under org, project members CRUD, `ProjectMemberGuard(role)`
- [x] P1.5 Web: register/login screens (zxcvbn dynamic import), dashboard (org switcher, project cards, create dialogs), settings (name, password change)
- [x] P1.6 Middleware auth gate live on `/dashboard` `/settings` `/p/`
- [x] P1.7 Gate check: two users / two orgs isolation test (API-level e2e) + logged-out redirect test

## P2 — Conversation DAG (gate: branch mid-thread, both lineages survive hard refresh)

- [x] P2.1 Rooms module: create room (kind council|one_on_one, persona picker), list, main branch auto-create
- [x] P2.2 Conversation module: node insert + optimistic head advance (auto-fork on conflict), branch create from node, thread read (ancestry CTE)
- [x] P2.3 Socket.IO gateway: cookie-auth handshake, membership-checked room join, `node:created` / `branch:created` fan-out
- [x] P2.4 Web room screen v1: thread view, composer, message cards (user/system), TanStack Query + WS cache feed
- [x] P2.5 Branch rail: branch tree, switch, hover `⑂ Branch from here`, name dialog
- [x] P2.6 Gate check: e2e — send 3 messages, branch off #2, post to both branches, hard refresh, both lineages correct

## P3 — Agent council + relevance (gate: silent agents make zero model calls, asserted via model_calls)

- [x] P3.1 ModelRouter impl: claude-sonnet-4-6 primary, 2 retries, gpt-4o-mini fallback, streaming; `model_calls` logging; embed batching
- [x] P3.2 Relevance engine: mention/expertise/lexical/fatigue scoring, threshold .35, cap 4, top-1 fallback, 1:1 skip; domain embeddings cached at bootstrap; ONE embed per turn
- [x] P3.3 LangGraph turn graph: select → retrieve(stub []) → respond (sequential, peers-see-peers) → delegate?(stub) → finalize; MemorySaver; persist-only-in-finalize
- [x] P3.4 Prompt builder: persona system prompt, council context, `<untrusted_context>` wrapper + tag-strip, citation instruction
- [x] P3.5 Streaming pipeline: `node:delta` seq events → gateway → web typewriter render; `node:error` discard path
- [x] P3.6 Council panel UI: 8 live scores from `turn:selection`, dimmed silent, "silent = $0" footer; `@` mention popover in composer
- [x] P3.7 Gate check: finance-question test — CFO+CEO respond, others zero rows in model_calls; @mention override test

## P4 — Org memory / RAG (gate: uploaded PDF answered with correct citation card)

- [x] P4.1 Files module: multipart upload → UPLOADS_DIR, magic-byte MIME check, 25MB cap, list/delete, `file:status` events
- [x] P4.2 Ingestion worker: SKIP LOCKED poller, markdown-aware chunker (~800 tok, 15% overlap), pdf/docx/txt/md/csv extractors, batch embed, chunk insert, 3-attempt failure path
- [~] P4.3 `searchKnowledge`: hybrid RRF query in packages/db, wired into retrieve node (replace stub), reuse turn embedding
- [ ] P4.4 Citation flow: inline `[Source: f #n]` parse → validate against real chunk set → metadata.citations → citation chips + excerpt popover
- [ ] P4.5 Files UI: dropzone on project home, files page with live status + chunk side panel
- [ ] P4.6 Artifact sandbox: detect html artifact in response → `metadata.artifact` → sandboxed iframe card (allow-scripts, null origin) + expand dialog
- [ ] P4.7 Gate check: e2e — upload fixture PDF, ask doc-only question, response cites correct file/chunk

## P5 — Delegation (gate: delegation demo beat end-to-end)

- [ ] P5.1 Signal parse (`DELEGATE_TO:` regex, strip line, single-hop enforcement) + delegation_tasks lifecycle
- [ ] P5.2 Delegation sub-graph: target persona respond with task + 10-node context + own retrieval; result as child of delegating node; failure path (`delegation_failed` flag, thread continues)
- [ ] P5.3 UI: indented delegated node, `↳ from {persona}` chain badge, streaming
- [ ] P5.4 Gate check: e2e delegation beat (demo narrative beat 6)

## P6 — Demo surface + ship (gate: FULL EXIT GATE — demo narrative §8 on deployed URL, non-dev, ≤15 min)

- [ ] P6.1 PA lite: open-loop capture in finalize, 30-min scanner, 24h stale + 4h rate cap + 1:1-only conditions, `metadata.proactive` badge
- [ ] P6.2 `pnpm seed:demo`: account, org Northwind, project Q3 Strategy, ready market-research.pdf, backdated open loop in Vulcan 1:1
- [ ] P6.3 Landing page + polish pass (motion, empty states, skeletons, no-layout-shift streaming)
- [ ] P6.4 `check-env --strict` + prod hardening pass (headers verified, CSP report-only spot check)
- [ ] P6.5 Deploy: VPS + Caddy + managed Postgres (pgvector), systemd units, deploy runbook in docs/
- [ ] P6.6 Golden-path Playwright spec (demo beats 1–6)
- [ ] P6.7 EXIT GATE: non-developer dry run on deployed URL, ≤15 min, all 7 beats

---

## Backlog (post-MVP, do not start)

- [ ] B.1 PostgresSaver checkpoint/resume (`docs/03_mvp_agents.md` §9)
- [ ] B.2 RLS re-enable (`docs/old/05`)
- [ ] B.3 S3 storage driver
- [ ] B.4 Redis event-bus transport + Socket.IO adapter
