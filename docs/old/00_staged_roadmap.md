# 00 — MVP Plan & Staged Roadmap (`staged_roadmap.md`)

**Status: governing document, v2.** Docs 01–08 remain the reference for the *full vision*.
This document defines the MVP we are actually building now, the simplifications to the codebase
itself (not just the UI), and the stages after. Where it disagrees with docs 01–08 on scope,
sequencing, or architecture-for-now, this document wins.

> **v2 change (2026-07-18):** v1 of this doc "parked" complexity by hiding features. That was
> insufficient — the complexity is in the *running system* (process topology, service count,
> cross-process hops, dead-weight packages), and it slows every dev/debug cycle whether or not a
> feature is visible. v2 prunes and consolidates the codebase itself. The full-platform code is
> preserved under a git tag, not carried in the working tree.

---

## 1. The goal, restated

A prototype that can be demoed to investors and hands-on-tested by target users:
credible, fast, stable on one box — **not** production-grade, **not** multi-tenant-hardened,
**not** a platform. Inspired by the old plan (docs 03's tasks and acceptance-criteria style are
reused), but rebuilt around a complexity budget.

## 2. The essence (never cut — the four demo moments)

1. **The council** — multiple C-Suite personas answer *selectively* (deterministic relevance
   scoring; silent agents cost zero tokens), streaming in parallel with visible thoughts and
   status.
2. **Non-linear conversation** — branch from any message; Graph view of the decision tree.
3. **Organizational memory** — upload a file / write a note → the council cites it.
4. **Delegation** — an exec hands work to a background specialist; progress visible; report
   lands back in the room.

Anything that doesn't feed one of these four is a candidate for pruning. Nothing that feeds
them may be over-simplified into flakiness.

## 3. Complexity budget (hard limits for the MVP)

| Dimension | Limit |
|---|---|
| Node processes in dev & prod | **2** — `web` (Next.js) + `server` (everything else) |
| Infra containers | **3** — postgres (+pgvector), redis, minio |
| Workspace packages | **4** — `shared`, `db`, `agents`, `event-bus` |
| LLM providers wired | 1 primary + 1 fallback (ModelRouter interface stays) |
| Default personas hired | 5 (Astra, Vulcan, Meridian, Lyra, Ledger) |
| New abstractions | None, unless the demo is blocked without one |

Any change that would exceed a limit needs a written justification appended to this doc.

## 4. Target MVP architecture

### 4.1 Before → after

```
BEFORE (current)                          AFTER (MVP)
apps/web                                  apps/web            (kept, routes trimmed)
apps/api               ─┐                 apps/server         ONE process:
apps/agent-runtime      ├─ 3 Node procs     · API (NestJS+Fastify, unchanged modules)
apps/ingestion-worker  ─┘  + Redis bus      · Socket.IO gateway (no Redis adapter)
                           between them     · agent turn engine + loops (BullMQ, in-proc)
                                            · ingestion pipeline (BullMQ, in-proc)
packages/shared,db,agents,event-bus       same 4 (event-bus → in-process transport)
packages/mcp-connectors                   PRUNED (tag)
infra: pg,redis,minio,clamav,otel,        infra: pg, redis, minio
       grafana,loki,prometheus,mailpit,
       mcp-nodes; Terraform
```

### 4.2 Keep / simplify / prune decisions

**Keep as-is (built, tested, debugged — rebuilding = new bugs, zero demo value):**
auth (email+password, sessions), Postgres schema + migrations + RLS + `withTenant` (RLS costs
nothing at runtime now that it's fixed; ripping it out touches every table for negative value),
conversation DAG + branching + auto-fork, hybrid knowledge search, chunking/embedding, artifact
engine + sandboxed iframe, notes + backlinks + silent sync, persona compiler + relevance scorer
+ turn policies, ModelRouter.

**Simplify (real code changes, listed as tasks in §6):**
- Process topology: 3 backend processes → 1 (`apps/server`). Workers become Nest-lifecycle
  modules; BullMQ stays (Redis already carries rate limits, interrupt flags, idempotency keys —
  removing Redis would be rework, not simplification).
- Event bus: same typed interface, **in-process emitter** transport (one process = no
  serialization hop); Redis pub/sub transport kept behind the interface for Stage 2.
- Realtime: Socket.IO without the Redis adapter; drop the SSE fallback path.
- Interrupts: keep **stop** and **@mention summon** only. Drop redirect-classification (utility
  LLM call) and agent-interjection tuning.
- Delegation: keep the single-worker happy path (delegate → progress → report-back). Drop
  worker-group collaboration channels and the approval flow (nothing writes externally in MVP).
- Upload security gate: keep size caps, magic-byte vs declared MIME, extension allowlist, sharp
  re-encode, PDF disarm. **ClamAV dropped for MVP** (demo users upload their own files);
  returns in Stage 2 as a hard gate.
- Email verification: auto-verify flag (`AUTH_AUTOVERIFY=true`) for MVP; mailpit container gone.
- Observability: Pino logs only. OTel/Grafana/Loki/Prometheus wiring removed.

**Prune from the working tree (preserved under the archive tag, §5):**
`packages/mcp-connectors` and all MCP grants/policy code paths; api modules `approvals`,
`sources` (GitHub/SQL/crawl sync); ingestion `sources/**`; agent-runtime `pa/proactive-*`,
`pa/daily-standup`, `orchestrator/{backpressure,queue-fairness}`; admin diagnostics pages
(persona/model editor + agents-paused kill switch **stay** — needed to tune the demo);
`infra/terraform`, `scripts/{dr,load,security}`, compose services clamav/otel/grafana/loki/
prometheus/mailpit/mcp-nodes; OTel telemetry exports in `shared`.

## 5. Pruning strategy (how we cut without losing anything)

1. **Tag first:** `git tag v0-full-platform` on the pre-prune commit. Every pruned line is one
   `git checkout v0-full-platform -- <path>` away. No `archive/` directory, no dead code riding
   along in the working tree.
2. **Prune only cleanly separable units.** A module is prunable when deleting it leaves the
   workspace green (typecheck + tests). If it's entangled with a keeper, *hide it* instead and
   record the entanglement here — do not destabilize working code to satisfy the prune list.
3. **Delete its tests with it.** CI must describe the MVP, not the full platform.
4. **Security floors survive pruning:** RLS + tenancy chain, markdown/XSS sanitization, artifact
   iframe sandbox, upload gate (minus ClamAV, explicitly accepted above), budget guards,
   append-only DAG, secrets hygiene. These are shipped and stay.

## 6. MVP task plan

Style follows docs/03: ordered epics, **Files**, **Acceptance**. Security checklists are
inherited from the floors in §5.4 plus per-task notes. Execute in order; M2 may start once
M1.2 is green.

### Epic M1 — Collapse the runtime (kill accidental complexity first)

**T M1.1 — Tag & prune.**
**Files:** deletions per §4.2 prune list; `pnpm-workspace.yaml`, `turbo.json`, root tsconfig refs.
Tag `v0-full-platform`. Remove pruned units workspace-by-workspace, keeping the tree green after
each removal (one commit per unit — reviewable, individually revertable).
**Acceptance:** full workspace typecheck + tests green; `grep -r "mcp-connectors\|approvals\|
proactive" --include="*.ts" src` finds no live imports; CI time measurably down.

**T M1.2 — Single server process.**
**Files:** `apps/server/*` (renamed from `apps/api`), absorbing `apps/agent-runtime/src` and
`apps/ingestion-worker/src` as Nest modules (`AgentRuntimeModule`, `IngestionModule`) whose
BullMQ workers start in `onApplicationBootstrap`; `packages/event-bus` in-process transport.
The turn engine consumes `conv.node.created` from the in-process bus; the Socket.IO gateway
subscribes in-process (Redis adapter and SSE endpoint removed).
**Acceptance:** `pnpm dev` starts exactly web + server; user message → relevance scoring →
streaming agent turn → persisted node works end-to-end with Redis used only for queues/flags/
rate-limits; existing turn-engine/PA/ingestion test suites pass relocated; kill -9 the server
mid-stream, restart → room recovers (turn marked interrupted, no corruption).

**T M1.3 — Three-container dev stack, one-command boot.**
**Files:** `infra/docker/compose.dev.yml`, `scripts/bootstrap.sh`, `scripts/check-env.ts`,
`.env.example`.
Compose = postgres+pgvector, redis, minio. Auto-verify auth flag; ClamAV step removed from the
ingestion gate (gate order otherwise unchanged); single `.env` consumed by both processes.
**Acceptance:** clean machine → `./scripts/bootstrap.sh` → working stack in ≤ 5 min; register →
login with no email step; upload → Ready without ClamAV present.

### Epic M2 — Golden path (make the four demo moments real)

**T M2.1 — Wire RAG into agent turns** *(the critical gap — agents currently retrieve nothing)*.
**Files:** `apps/server/src/agent-runtime/agent-worker.ts` (the `searchKnowledge` stub),
delegation worker's stub, `packages/shared` (canonical `RagChunk`).
Same-process call into the knowledge module's hybrid search (RRF path already built) via
`withTenant`; chunk provenance ids flow to the UI as citation links.
**Acceptance:** upload a PDF → ask about its contents → agent answer cites the doc with a
working source link; noise question → no citations (no forced RAG stuffing).

**T M2.2 — Delegation, simple mode.**
**Files:** delegation manager/worker (post-prune), Activity pane.
Single specialist per delegation, progress events, report-back node parented to origin. Group
channels/approval branches already pruned in M1.1.
**Acceptance:** "Vulcan, get a competitive teardown" → Activity pane shows live progress →
report artifact lands in-room; cancel works; two concurrent delegations don't interleave state.

**T M2.3 — Artifact pane auto-open + citation cards.**
**Files:** `apps/web` artifact stream hook (missing `useArtifactStream`), message renderer.
Pane slides open on first `artifact.stream.chunk` (manual toggle stays); `[src:chunk_id]`
citations render as cards linking into Storage Room preview.
**Acceptance:** demo steps 4–5 need zero manual pane management.

### Epic M3 — Demo surface

**T M3.1 — Route & nav trim.**
**Files:** `apps/web` nav rail, route groups, admin pages.
Visible: dashboard, conference, meetings, 1:1s, office, storage, graph, settings, admin
(persona editor + kill switch only). Gone (deleted, not hidden — v2 rule): connect-source
dialog, approvals strip, admin diagnostics, API-keys page (auth for MVP is browser-only).
**Acceptance:** every reachable screen is demo-ready; no dead nav items; 404s for pruned routes.

**T M3.2 — Demo seed.**
**Files:** `packages/db/src/seed/demo.ts`, `pnpm seed:demo`.
Demo org/user/project; council of 5 hired; one seeded conversation with an existing branch; two
pre-ingested docs; one artifact; three office notes. Idempotent; refuses `NODE_ENV=production`
without `--demo-box`.
**Acceptance:** fresh box + seed → demo narrative (§7) starts at step 1 with zero manual setup.

**T M3.3 — Polish pass.**
Empty/loading states on every demo-path screen; landing copy pitches the four essence items;
persona bio cards in 1:1 headers; roster chips show silent-vs-speaking clearly (the token-
frugality talking point needs to be *visible*).
**Acceptance:** walkthrough by someone who didn't build it produces no "what's this?" moments.

### Epic M4 — Ship it

**T M4.1 — Single-box deploy.**
**Files:** `docker-compose.prod-sim.yml` (trimmed to web+server+pg+redis+minio+caddy),
`scripts/check-env.ts --strict` (reject `dev_only_*`, validate key material).
Caddy for TLS; real provider key, conservative daily USD budgets.
**Acceptance:** demo runs on the public URL; `--strict` failing any check aborts boot.

**T M4.2 — Golden-path smoke test.**
**Files:** `apps/web/playwright.config.ts`, one spec.
One Playwright spec walking §7 with the mock model provider, in CI as the only required e2e.
**Acceptance:** green in CI; breaking any demo step turns CI red.

**T M4.3 — Demo script.** `docs/runbooks/demo_script.md`: the talk track for §7, timed ≤ 15 min.

## 7. The demo narrative (acceptance test for the whole MVP)

1. Login → dashboard → demo workspace.
2. Conference room: product+pricing question → Ledger and Lyra stream simultaneously (thoughts,
   status pills) while Vulcan and Meridian stay visibly silent.
3. Branch from an earlier message ("what if freemium?") → parallel thread → Graph view, live.
4. Drag in a pricing PDF → Uploading→Ready → re-ask → answers cite the document.
5. Vulcan delegates research → Activity pane progress → report lands in-room.
6. Write a decision note in the CEO's Office → council recalls it in conference.

**MVP exit gate:** the narrative runs end-to-end on the deployed URL, driven by a
non-developer, from `seed:demo`, ≤ 15 min, zero terminal usage. M4.2 spec green in CI.

## 8. Explicit dilutions and where they return

| Dilution (MVP) | Returns | How |
|---|---|---|
| ClamAV out of upload gate | Stage 2 | restore from tag; hard gate before paid data |
| Email verification off (auto-verify) | Stage 1 | flag flip + mail provider |
| MCP connectors + policy engine + approvals | Stage 2 | restore from `v0-full-platform` |
| Source connectors (GitHub/SQL/crawl) | Stage 1 (GitHub first) | restore from tag |
| Proactive PA, daily standup, interjection/redirect | Stage 1 | restore from tag |
| SSE fallback, Redis bus transport, multi-node scaling paths | Stage 2 | interfaces kept; transports reinstated |
| `run_code` sandbox, Terraform/WAF/HA, OTel stack, chaos/load/tenancy battery | Stage 2–3 | per docs 01/07 and old Phase 4–5 tasks |
| 2FA + API keys surfaced | Stage 1–2 | code kept; UI re-exposed |

## 9. Stages after MVP (brief — detail when we get there)

- **Stage 1 — Pilot:** 3–5 design-partner orgs on real documents. Unpark GitHub connector,
  proactive follow-ups, full roster, email verification, owner cost visibility; onboarding
  wizard; feedback loop. *Exit: 3 external orgs active 4+ weeks unassisted.*
- **Stage 2 — Productionize:** paid beta. Re-split processes where load demands (the module
  seams from M1.2 are the future service boundaries), restore ClamAV/MCP/approvals/sandbox,
  tenant-isolation battery in CI, Terraform+CI/CD+WAF, Stripe. *Exit: old Phase 4 gate +
  delivery pipeline live.*
- **Stage 3 — Scale/enterprise:** HA/DR, SIEM, SSO/SAML, pen test (old Phase 5 remainder).

## 10. Operating rules

1. Work is admitted only if it serves the MVP exit gate (§7). "While we're in here"
   improvements to pruned/parked systems are not admitted.
2. The complexity budget (§3) is a gate on every PR, same standing as CI.
3. Prune rule 2 (§5) is binding: never destabilize a working keeper to complete a prune.
4. CI describes the MVP only; the full platform lives at `v0-full-platform` and returns
   stage-by-stage (§8), not by default.
