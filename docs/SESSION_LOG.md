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
