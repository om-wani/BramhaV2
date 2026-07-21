# BramhaV2 — Session Log

> Append-only. One entry per working session, newest first. Rules: `CLAUDE.md` §Task tracking.
> Entry template:
>
> ```
> ## YYYY-MM-DD — <one-line summary>
> **Branch/commits:** <branch> @ <short-sha>..<short-sha>
> **Done:** <what landed, task IDs>
> **Decisions:** <choices made + why, or "none">
> **Next:** <single most important next step>
> ```

---

## 2026-07-21 — P5 complete + P6.1–P6.6 complete; P6.7 EXIT GATE ready for deploy

**Branch/commits:** `claude/mvp-plan-simplify-1zfx9b` @ 3e797bd..1bb0a21
**Done:** P5.1 fix (delegation regex restricted to final line, /m removed, (?:^|\n) prefix, emitDelegationFn wired); P5.2 (delegation sub-graph: invokeTurnGraph with isDelegated:true, delegated node as child of delegating agent node, failure path catches+sets failed+no rethrow, delegation_tasks lifecycle pending→running→done/failed); P5.3 (indented delegated node UI, ↳ from {persona} badge, streaming unchanged); P5.4 (p5 gate check: 25 assertions, 124 agents tests pass); P6.1 (PA lite: open-loop capture 1:1-only, 30-min setInterval scanner, 24h/4h guards, proactive badge, CAS fix on branch head advance); P6.2 (seed:demo: Northwind account, Q3 Strategy, market-research.pdf 3 pre-seeded chunks, backdated open loop); P6.3 (landing page 3 feature cards, room empty state, streaming layout-shift fix); P6.4 (check-env --strict script, referrerPolicy in helmet, upgrade-insecure-requests in prod CSP); P6.5 (deploy runbook docs/05_deploy.md, deploy/ systemd units + Caddyfile); P6.6 (Playwright golden-path spec 6 beats, @playwright/test installed).
**Decisions:** P5.1: DELEGATE_TO must be final line only — /m flag allowed mid-response triggers (security/reliability issue). P5.2: delegated turn uses `parentId: delegatingNodeId` (not user node), `isDelegated: true` prevents cascade, no branch head advance for delegated nodes. P6.1: forwardRef circular dep pattern for AgentsModule ↔ ProactiveModule; publicDomainEmbeddings getter exposes map to scanner. P6.2: chunkCount is computed DTO field, not stored column. P6.3: pre-existing webpack .js extension resolution issue in packages/shared (not caused by P6 changes). P6.6: Playwright installed with --engine-strict=false due to Node 23.5 vs expected 20/22/24 engine constraint.
**Next:** P6.7 EXIT GATE — deploy to VPS using docs/05_deploy.md runbook, run `pnpm seed:demo`, non-developer dry run of all 7 demo beats in ≤15 min on deployed URL.

---

## 2026-07-19 — P2 complete: socket gateway, room screen, branch rail, gate

**Branch/commits:** `claude/mvp-plan-simplify-1zfx9b` @ e261cbd..{latest}
**Done:** P2.3–P2.6. Socket.IO gateway (cookie auth, room:join, node:created/branch:created fan-out); aligned gateway with shared types (event shapes, event names, branchId in internal event, event emissions from conversation.service); web room screen (thread, composer, socket WS cache feed); branch rail (switch, hover ⑂, create dialog with focus trap); P2 gate passes.
**Decisions:** activeBranchIdRef pattern for stale-closure-safe socket handlers; split socket lifecycle / handler effects; .returning() without column selection required for DrizzleDb union type.
**Next:** P3 — Agent council + relevance: ModelRouter, relevance engine, LangGraph turn graph, prompt builder, streaming.

---

## 2026-07-19 — P2.4: web room screen — thread view, composer, WS cache feed

**Branch/commits:** `claude/multi-agent-ai-orchestration-zt6xvw` @ current
**Done:** P2.4. Room screen at `/p/[org]/[project]/r/[roomId]` — slug→ID resolution via two-step org/project lookup; branch list (first branch named 'main'); thread load via TanStack Query; message cards with persona avatar (CSS var colors), display names, pre-rendered content, relative timestamps; composer (Enter=send, Shift+Enter=newline, disabled during inflight); Socket.IO connect on mount with `room:join`, `node:created` updates query cache, `room:leave` + disconnect on unmount; skeleton cards while loading; error states. Also created project page at `/p/[org]/[project]` with room list + create-room dialog as navigation hub.
**Decisions:** No `marked`/`dompurify` in package.json so content rendered as `<pre>` with whitespace-pre-wrap — spec permits this fallback. `fieldSizing: content` cast as `React.CSSProperties` to satisfy strict TS (non-standard CSS prop). Socket singleton from `getSocket()` used as-is — disconnect on unmount; reconnects on remount.
**Next:** P2.5 — branch rail UI (branch tree, switch, hover ⑂ Branch from here, name dialog).

---

## 2026-07-19 — P1 complete: auth + orgs + projects + web screens + gate

**Branch/commits:** `claude/mvp-plan-simplify-1zfx9b` @ 9cbfed0..34eb69e
**Done:** P1.1–P1.7. Auth module (argon2id, zxcvbn≥3, SHA-256 session tokens, sliding expiry, enumeration-proof); SessionAuthGuard with NestJS DI fixed via unplugin-swc (esbuild doesn't emit decorator metadata); Orgs CRUD with owner-gated membership; Projects CRUD with ProjectMemberGuard(role) mixin + createProject transaction atomicity; Web register/login (zxcvbn dynamic import only, strength 0-2=weak) + dashboard (org switcher, project cards, create dialogs, a11y-correct modals) + settings stubs; middleware auth gate live; 56 server tests pass, web build clean.
**Decisions:** unplugin-swc required in vitest.config to emit decorator metadata (esbuild default can't); migrate.ts must reuse PGlite singleton not create second instance (same data dir crashes); DELETE /orgs returns 204 (spec); register always returns 201 (enumeration prevention); strengthScore init to 0 not -1 to prevent zxcvbn race bypassing strength gate; CSP nonce read from x-nonce header in root layout async server component.
**Next:** P2 — Conversation DAG: rooms module, node insert + head advance + auto-fork, Socket.IO gateway, room screen UI, branch rail, gate.

---

## 2026-07-19 — P0 complete: full monorepo skeleton built and verified

**Branch/commits:** `claude/mvp-plan-simplify-1zfx9b` @ f756451..{latest}
**Done:** All P0 tasks (P0.1–P0.10). packages/shared (29 tests), packages/db (12 tests + 0001_init.sql + PGlite migration), packages/agents (18 tests — ModelRouter, relevance scoring, 8 personas), packages/event-bus (6 tests), apps/server (NestJS+Fastify, health endpoint, 4 tests), apps/web (Next.js 14 App Router, route groups, middleware CSP+auth-gate, Tailwind dark-first, 8 persona CSS vars, TanStack Query v5, Socket.IO stub). CI yaml verified (lint/typecheck/test/build all pass). Gate: 45+ tests pass, `pnpm typecheck` clean, `next build` succeeds all 8 routes.
**Decisions:** next.config.ts → .mjs (Next.js 14.2.29 doesn't support .ts config); postcss.config.js → .cjs (Next.js requires() it, ESM fails with "type":"module"); btoa() instead of Buffer in Edge middleware; Socket.IO path /backend/socket.io so Next.js rewrite proxy catches handshake; frameguard must be explicitly set to {action:'deny'} (helmet default is SAMEORIGIN); APP_ORIGIN asserted present in production at bootstrap.
**Next:** P1 — auth + orgs: register/login/logout (argon2id, zxcvbn ≥3), session cookie (opaque token, SHA-256), orgs module, projects module, SessionAuthGuard live, web auth screens, gate check.

## 2026-07-19 — Task tracker + session log created

**Branch/commits:** `claude/mvp-plan-simplify-1zfx9b` @ e9ba43a..
**Done:** Created `docs/TASKS.md` (full P0–P6 task breakdown with per-phase gates, stable IDs, backlog) and this log. Wired update rules into `CLAUDE.md` (§Task tracking & session log).
**Decisions:** Task IDs stable/never renumbered; log is append-only newest-first; both files updated in the same commit as the work they describe.
**Next:** Start P0.1 — wipe working tree to fresh monorepo root.

## 2026-07-19 — MVP docs rewritten from scratch (redo with correct model)

**Branch/commits:** `claude/mvp-plan-simplify-1zfx9b` @ 23e49cf..e9ba43a
**Done:** Full redo of all 5 MVP docs + CLAUDE.md. Fixed DAG spec (branches = head pointers only, fork copies nothing, optimistic head advance + auto-fork). Added per-phase acceptance gates, one-embed-per-turn rule, `FOR UPDATE SKIP LOCKED` job claim, `websearch_to_tsquery`, one-hop delegation cap, citation validation, session auth (opaque token) instead of JWT. Demo narrative expanded to 7 timed beats.
**Decisions:** Docs are source of truth over old CLAUDE.md wording; `model_calls` table added as the mechanism to prove "silent = $0".
**Next:** P0 repo skeleton.

## 2026-07-19 — Old docs archived, first MVP docs written

**Branch/commits:** `claude/mvp-plan-simplify-1zfx9b` @ ee41523..23e49cf
**Done:** Moved 10 full-platform docs to `docs/old/` + README pointer. Wrote first version of 5 MVP docs (00–04). Rewrote CLAUDE.md for fresh-build MVP. (Superseded same day by the rewrite above.)
**Decisions:** Archive-branch-and-fresh-build confirmed; `v0-full-platform` pushed as remote branch (tag push 403'd).
**Next:** (superseded)

## 2026-07-18 (approx) — MVP replanning arc (3 iterations)

**Branch/commits:** `claude/mvp-plan-simplify-1zfx9b` @ ..ee41523
**Done:** v1 plan (feature parking) rejected → v2 plan (prune + consolidate, commit ee41523) rejected → plan-mode ground-up replan approved with corrections: LangGraph stays, orgs stay, PA lite in scope, checkpoint/resume documented not implemented. Archive branch `v0-full-platform` created and pushed.
**Decisions:** Fresh rewrite over reuse; complexity budget (2 processes / 0 local infra / 4 packages); no Docker locally (PGlite).
**Next:** (completed above)
