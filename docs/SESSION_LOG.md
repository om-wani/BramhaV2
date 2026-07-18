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
