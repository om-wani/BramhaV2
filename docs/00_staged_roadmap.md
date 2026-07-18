# 00 — Staged Roadmap (`staged_roadmap.md`)

**Status: governing document.** Docs 01–08 remain the reference for *how* each system is built.
This document decides *what gets built when*. Where they disagree on scope or sequencing, this
document wins. The old phase plan in `03_implementation_phases.md` is retained as the task
encyclopedia — its tasks are re-bucketed into stages here (§9).

---

## 1. Why this document exists

Docs 01–08 describe the full end-state: zero-trust MCP mesh, sandboxed code execution,
tenant-isolation fuzzing batteries, Terraform/WAF/HA, SIEM pipelines. All of it is right for the
destination — and almost none of it is visible in a demo or needed by the first ten users.

This roadmap re-cuts the same vision into four stages where **every stage ends in something you
can put in front of a person**: Stage 0 an investor/user demo, Stage 1 real pilot users,
Stage 2 paying customers, Stage 3 scale. Complexity is deferred, not deleted — every parked item
keeps its reference into docs 01–08 and a named stage where it returns.

## 2. The essence (never cut, at any stage)

The four things that *are* the pitch. Any simplification that damages one of these is
over-simplification:

1. **The council** — multiple C-Suite personas with distinct voices that answer *selectively*
   (only the relevant ones speak — the deterministic relevance engine is the token-frugality
   story), streaming in parallel with visible reasoning and status.
2. **Non-linear conversation** — branch from any message into a parallel thread; see the whole
   decision tree in the Graph view. No other chat product demos this.
3. **Organizational memory** — upload a file or write a note; the council cites it. "Your company
   remembers" is the moat narrative.
4. **Delegation** — an exec hands work to a background specialist, the Activity pane shows it
   running, and a report lands back in the room. This is what makes it a *team*, not a chatbot.

Everything else — MCP, sandboxes, IaC, admin analytics — is scaffolding around these four.

## 3. Reality check (as of 2026-07-18)

The codebase is far ahead of "MVP": Phases 1–4 of the old plan are substantially built
(migrations through `0026`, ~890 tests green across 10 packages, all audit P0s fixed — see
`AUDIT_REPORT.md`). So "diluting" does **not** mean rebuilding smaller. It means:

- **Stop investing** in the deep-platform tracks (MCP, IaC, chaos/load, admin analytics).
- **Hide** what doesn't serve the demo (park in place — code stays compiled and tested).
- **Wire the few gaps** in the golden path (notably: agents currently get **zero RAG** — the
  `searchKnowledge` stubs return `[]`, so essence item 3 doesn't actually work end-to-end yet).
- **Polish and deploy** one box that a non-developer can drive.

Ripping out working, tested code would be rework later and risk now. Parking is free.

## 4. Stage map

| Stage | Name | Audience | One-line goal | Exit gate (summary) |
|---|---|---|---|---|
| **0** | **MVP / Prototype** ← current | Investors + target users (guided) | A 15-minute demo of the four essence items, running on one box | Demo narrative (§5.1) runs end-to-end by a non-developer, from seed data, no terminal |
| 1 | Pilot | 3–5 design-partner orgs | Real users on real documents, weekly, with a feedback loop | 3 external orgs active 4+ weeks without founder hand-holding |
| 2 | Productionize | Paid beta | Safe to take strangers' money and data | Old Phase 4 exit gate + trimmed Phase 5 delivery gates |
| 3 | Scale | GA / enterprise | HA, compliance posture, enterprise auth | Remainder of old Phase 5; pen-test pass |

---

## 5. Stage 0 — MVP / Prototype (CURRENT STAGE)

**Goal:** a deployed prototype that demos the four essence items in 15 minutes, and that a
curious target user can be handed for a supervised session. Single tenant in practice (RLS stays
on because it's already built and tested — but no new tenancy investment).

### 5.1 The demo narrative — build to this spine

Every remaining Stage-0 task exists to make this script work flawlessly. This is the acceptance
test for the whole stage:

1. **Login** → dashboard → open the demo project workspace.
2. **Conference room.** Ask a product-and-pricing question. Ledger (CFO) and Lyra (CMO) answer —
   streaming simultaneously, thoughts collapsible, status pills flickering — while Vulcan and
   Meridian stay silent. *Point at the screen: "only the relevant execs spoke; the others cost
   zero tokens."*
3. **Branch.** Hover an earlier message → "Branch from here" → ask "what if we went freemium
   instead?" → a parallel thread. Open the **Graph view**: the whole decision tree, live.
4. **Memory.** Drag a pricing PDF into the composer → card goes Uploading → Scanning → Ready →
   it appears in the Storage Room. Ask the pricing question again — answers now **cite the
   document** with linked sources.
5. **Delegation.** Ask Vulcan for a competitive teardown → "I've put our researcher on it" →
   Activity pane shows the worker running with live progress → report lands back in the room as
   an artifact.
6. **Notes.** Write a decision in the CEO's Office ("We decided: usage-based pricing, floor at
   $49"). Back in the conference room, ask "what did we decide on pricing?" — the council
   recalls it. *"You never told the agents. The org remembered."*

### 5.2 In scope — and its actual status

| Capability | Docs ref | Status | Stage-0 posture |
|---|---|---|---|
| Auth (email+password, sessions, 2FA, API keys) | 03 §1.3 | Built | **Freeze.** No new auth work. |
| Workspace shell, dashboard, settings | 06 §2,7 | Built | Polish pass only (M0.5) |
| Conference + meeting + 1:1 rooms | 06 §3 | Built | Keep; demo uses conference + one 1:1 |
| Turn engine, relevance scoring, budgets | 04 §2,5 | Built | Freeze; tune θ/weights only if demo misfires |
| Streaming UI: parallel bubbles, thoughts, status pills, stop | 06 §3.2 | Built | Keep |
| Branching + auto-fork + Graph view | 04 §5.3, 06 §4 | Built | Keep |
| Upload → security gate → extract → chunk → embed | 03 §2.3 | Built | Keep (gate stays — never bypass ClamAV) |
| Hybrid knowledge search API | 03 §2.3.4 | Built | Keep |
| **RAG into agent turns** | 04 §2.3 | **Stubbed — returns `[]`** | **M0.1 — the critical gap** |
| CEO's Office notes + backlinks + silent sync | 06 §5 | Built | Keep; trim right-pane extras if flaky |
| Artifacts: streaming, versions, sandboxed render | 06 §8 | Built | M0.4 auto-open nit |
| Delegation happy path + Activity pane | 04 §4 | Built | Keep happy path; edge cases → Stage 1 |
| Persona roster (8 C-Suite + 7 workers) | 08 | Built (seed) | Demo seed hires 5 (§5.3 M0.2) |

### 5.3 Remaining work — the Stage-0 punch list

Small, ordered, and finite. This replaces the old Phase 2–4 task queues as the only active work.

- **M0.1 — Wire RAG into agent turns.** Replace both `searchKnowledge` stubs
  (`apps/agent-runtime/src/agent/agent-worker.ts:280`,
  `apps/agent-runtime/src/delegation/delegation-worker.ts:189`) with the hybrid-search service
  (direct DB query via `withTenant`, same RRF path as the knowledge module — move the canonical
  `RagChunk` type to `@bramha/shared` while at it, per audit 3.6). Chunk provenance ids flow
  through so the UI can render citation links.
  *Accept:* upload a PDF → ask about its contents → agent answer cites it (demo step 4 works).
- **M0.2 — Demo seed.** `pnpm seed:demo`: demo org/user, one project with council hired
  (**Astra, Vulcan, Meridian, Lyra + Ledger**), a seeded conversation with one existing branch,
  two pre-ingested documents, one artifact, three CEO's Office notes. Idempotent; refuses
  `NODE_ENV=production` unless `--demo-box` flag.
  *Accept:* fresh box + seed → demo starts at step 1 with no manual setup.
- **M0.3 — Golden-path smoke test.** One Playwright spec that walks §5.1 (mock model provider)
  against the compose stack; wired into CI as the *only* required e2e for Stage 0. Fixes the
  aspirational `apps/web` e2e script (audit 1.4) and gives the existing e2e configs a CI home
  (audit 1.2, minimal version).
  *Accept:* spec green in CI; breaking any demo step turns CI red.
- **M0.4 — Artifact pane auto-open** on first `artifact.stream.chunk` (audit 4.1 leftover —
  add the missing `useArtifactStream` listener; manual toggle stays as fallback).
- **M0.5 — Demo polish pass.** Hide parked surfaces from nav (admin diagnostics, connect-source
  options other than manual upload, approvals strip); empty/loading states on every demo-path
  screen; landing page copy matches the pitch (Council / Branching / Memory / Delegation);
  persona bio cards present in 1:1 headers.
- **M0.6 — Single-box deploy.** `compose.prod-sim` on one VPS behind Caddy (TLS), real provider
  key for one primary model + one fallback, conservative daily USD budgets, `check-env --strict`
  mode (audit 4.4: reject `dev_only_*` values, validate key material) wired into the box's start
  script.
  *Accept:* the demo runs on the public URL, not localhost.
- **M0.7 — Hygiene.** Re-verify the two "(temporary)" commits: middleware auth gate is already
  restored (verified 2026-07-18); confirm the session-service change (`e79602e`) is intended and
  drop the "(temporary)" markers from history going forward. Remove confirmed-dead deps from
  audit 3.5 (`sandpack-react`, `tsx` in api, `ajv` in mcp-connectors).

Nothing else is Stage-0 work. If it isn't on this list and doesn't block §5.1, it waits.

### 5.4 Explicit dilutions (accepted now, restored later)

| Full-vision item | Stage-0 simplification | Returns in |
|---|---|---|
| ECS/Terraform, WAF, CDN, multi-AZ (01 §7, old P5) | One VPS, docker compose, Caddy | Stage 2–3 |
| Multi-provider failover ladder + semantic cache (01 §4) | One primary + one fallback via existing ModelRouter config; no cache tuning | Stage 1–2 |
| MCP connectors, policy engine, capability tokens (04 §6) | Not surfaced; code parked | Stage 2 |
| `run_code` sandbox containers (01 §6.3) | Absent; prototyper worker uses artifacts only | Stage 2 |
| Source connectors: GitHub/SQL/crawl (03 §3.5.3) | Hidden; manual upload only | Stage 1 |
| Approval flow for write actions | Parked with MCP (nothing writes externally in Stage 0) | Stage 2 |
| Admin dashboard | Persona/ModelPolicy editor + agents-paused kill switch only; diagnostics charts parked | Stage 1–2 |
| Observability stack (OTel/Grafana/Loki) | Pino logs + budget alerts; compose profile off | Stage 2 |
| Proactive PA turns, daily standup, cross-room confidentiality routing (04 §2.4, old T4.2–4.3) | Flags off | Stage 1 |
| Tenant-isolation battery, load/chaos suites (old T4.4–4.5) | Existing probe suite stays green in CI; no fuzzing/chaos investment | Stage 2 |
| 8-persona default roster | 5 hired in demo seed; others remain hireable seed data | Stage 1 |
| Payments/billing | Static pricing page only | Stage 1 (manual) → 2 (self-serve) |

### 5.5 Parking rules

1. **Nothing is deleted.** Parked code stays compiled, tested, and green in CI — it's already
   paid for; keeping it green is cheaper than excising and rebuilding.
2. Parking = removed from nav/UI, feature flag or seed default off, **zero new investment**.
3. Shipped security controls are floors, never dilution targets: RLS + tenancy chain, upload
   security gate (ClamAV stays mandatory), markdown sanitization, artifact iframe sandbox,
   budget guards, append-only DAG. Dilution only defers *building new* controls.
4. Every parked item has a named return stage (§5.4) and keeps its docs 01–08 spec.

### 5.6 Stage-0 exit gate

- §5.1 demo narrative executed end-to-end on the deployed public URL by someone who didn't build
  it, starting from `seed:demo`, in ≤ 15 minutes, zero terminal usage, zero known crashes.
- M0.3 golden-path spec green in CI alongside the existing test suite.
- A written one-page demo script (talk track) checked into `docs/runbooks/demo_script.md`.

---

## 6. Stage 1 — Pilot (design partners)

**Goal:** 3–5 target-market orgs using it weekly on their own documents; a feedback loop that
tells us what Stage 2 must contain. Entry: Stage-0 gate passed.

- **Unpark:** GitHub source connector first (biggest pilot ask expected), full 8-persona roster,
  proactive follow-ups + daily standup (off by default, per-project opt-in), admin diagnostics
  lite (token spend per project/day — the table exists).
- **New:** onboarding wizard ("hire your council" flow from the dashboard template), in-app
  feedback widget, email notification on delegation completion, owner-visible usage/cost page.
- **Hardening only where pilots will actually step:** Next.js 15 upgrade (audit 0.7 — dedicated
  pass), auth role split for sensitive columns (audit 2.2 — its own task, as scoped there),
  e2e + tenant-probe suites fully wired in CI (audit 1.2).
- **Billing:** manual invoicing or free design-partner agreements. No payment rails yet.

**Exit gate:** 3 external orgs active for 4+ consecutive weeks; a new org gets from signup to
first council answer without a founder present; top-10 feedback themes documented and triaged
into Stage 2 scope.

## 7. Stage 2 — Productionize (paid beta)

**Goal:** safe to take strangers' money and data. Entry: pilot retention proves demand.

- **Unpark:** MCP infrastructure + zero-trust policy engine + approval flow (04 §6), `run_code`
  sandbox (01 §6.3), SQL/URL source connectors, full admin dashboard.
- **Tenancy for real:** tenant-isolation verification battery as a required CI check
  (old T4.4), schema-driven probe coverage, basic load test (old T4.5 subset).
- **Delivery:** Terraform staging + prod (old T5.2), CI/CD with image signing (T5.4), WAF/CDN
  with separate artifact origin (T5.3), observability profile on (T5.5 subset).
- **Business:** self-serve billing (Stripe), per-plan quotas mapped to the existing budget guards.

**Exit gate:** old Phase-4 exit gate + staged deploy pipeline live + billing round-trips.

## 8. Stage 3 — Scale & enterprise

Remainder of old Phase 5: HA/DR drills (T5.6), SIEM + alert pack (T5.5 full), pen test + ASVS
pass (T5.7), enterprise auth (SSO/SAML), compliance posture (SOC 2 groundwork), performance work
driven by real usage. Scope is deliberately vague until Stage 2 data exists.

## 9. Old-phase → stage mapping

`03_implementation_phases.md` remains the task encyclopedia; execute its tasks when their stage
arrives, with its security checklists intact.

| Old plan | Now lives in |
|---|---|
| Phase 1 (shell, auth) | Built — frozen in Stage 0 |
| Phase 2 (DAG, artifacts, ingestion, office) | Built — Stage 0 golden path (+ M0.1/M0.4 gaps) |
| Phase 3 epics 3.1–3.4 (personas, PA, turns, delegation) | Built — Stage 0 golden path |
| Phase 3 epic 3.5 (MCP) | Built but parked → Stage 2 (3.5.3 GitHub connector early → Stage 1) |
| Phase 4 T4.1–4.3 (rooms UX, routing, proactive) | Built — rooms in Stage 0; routing/proactive parked → Stage 1 |
| Phase 4 T4.4–4.5 (tenancy battery, chaos) | → Stage 2 |
| Phase 4 T4.6 (admin) | Minimal in Stage 0 → full in Stage 1–2 |
| Phase 5 (IaC, WAF, CI/CD, observability, HA, pen test) | → Stage 2 (delivery basics) and Stage 3 (HA/DR/SIEM/pen test) |

## 10. Operating rules from here

1. New work is admitted **only** if it serves the current stage's exit gate. "While we're in
   here" improvements to parked systems are not admitted.
2. CI stays fully green, including parked code. A red test in a parked module still blocks.
3. The audit report's open P1/P2 items are scheduled by stage above (0.7→S1, 2.2→S1, 1.2→S0/S1,
   4.4→S0-M0.6); anything unlisted is Stage 2+.
4. Each stage transition gets a short written retro appended to this doc: what the gate showed,
   what moved between stages, why.
