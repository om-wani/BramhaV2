# BramhaV2 — MVP Plan (Governing Doc)

## 1. What we are building

A demo-grade prototype of the BramhaV2 idea: a **C-Suite AI council** that a founder talks to in one workspace. Eight executive personas that decide *for themselves* whether a message concerns them, a conversation that **branches like git** instead of scrolling forever, an **org memory** the council actually cites, and **delegation** between agents that the user can watch happen.

Audience: investors and target-market users. Success is a 15-minute live demo that lands all four of those moments without a developer at the keyboard.

This is not the platform. The platform (full spec: `docs/old/`, code: branch `v0-full-platform`) stays archived until the demo earns the right to build it.

## 2. The four essence pillars

Every scoping decision below was tested against one question: *does cutting this weaken a pillar?* If no — cut.

| # | Pillar | Demo moment |
|---|--------|-------------|
| 1 | **Selective council** | User asks a finance question; CFO and CEO answer, the other six stay visibly silent. Deterministic scoring, zero tokens for silent agents — this is the cost story investors ask about. |
| 2 | **Branching DAG** | User branches off any message, explores an alternative, switches back. Original thread untouched. |
| 3 | **Org memory / RAG** | User uploads a PDF; minutes later an agent cites it with a source card. |
| 4 | **Delegation** | One agent hands a sub-task to another mid-conversation; the result returns to the thread with a visible chain. |

## 3. Complexity budget (hard ceiling)

| Dimension | Budget |
|-----------|--------|
| Node processes | **2** — `apps/web`, `apps/server` |
| Local infra | **0 installs** — PGlite (embedded Postgres + pgvector) |
| Deployed infra | **1** — managed Postgres (Neon or Supabase) |
| Workspace packages | **4** — `shared`, `db`, `agents`, `event-bus` |
| External APIs | **2** — Anthropic (primary LLM), OpenAI (fallback LLM + embeddings) |

Anything that would exceed a cell in this table is out of scope by definition, no discussion needed.

## 4. In / out

### In (and why it survived the cut)

- **LangGraph turn loop** — the orchestration story is the product; faking it with a for-loop would leave nothing real to demo or grow.
- **Orgs layer** (users → orgs → projects) — investors need to see the multi-tenant shape, and retrofitting it later touches every table.
- **Proactive PA (lite)** — one narrow behavior: follow up on a stale open loop in a 1:1 room, rate-capped. Enough to demo "it remembers and comes back to you."
- **Hybrid search** (pgvector + BM25, RRF) — pure-vector retrieval visibly misses exact terms (names, SKUs) during live demos; the lexical leg is cheap insurance.
- **Delegation, simple mode** — one hop, synchronous, no approval machinery.
- **Artifact sandbox** — sandboxed iframe render of agent-produced HTML; high demo value, small surface.
- **Socket.IO, in-process** — streaming council responses is the demo; polling would kill it.

### Out (each with its documented re-entry point)

| Cut | MVP replacement | Re-entry point |
|-----|-----------------|----------------|
| Redis (pub/sub, Socket.IO adapter) | `packages/event-bus` in-process emitter | Swap emitter transport; Socket.IO Redis adapter |
| BullMQ | `ingestion_jobs` table polled in-process | Same job rows become BullMQ payloads |
| MinIO / S3 | Local disk `UPLOADS_DIR` | Swap storage driver behind `FileStorage` interface |
| RLS + GUC machinery | App-level `WHERE project_id` via `withTenant()` | Re-enable policies from `docs/old/05`; **accepted MVP risk, documented** |
| MCP tools + policy engine | None | Full spec in `docs/old/04` |
| Source connectors (GitHub/SQL/crawl) | File upload only | `docs/old/03` Phase 4 |
| 2FA, API keys, email verification | Password auth, auto-verified | `docs/old/07` |
| ClamAV, OTel, Grafana, Terraform | pino logs, manual deploy | Productionization |
| Checkpoint/resume (LangGraph) | `MemorySaver`; abort = no resume | `PostgresSaver` — interface documented in `docs/03_mvp_agents.md` §9, **not implemented** |
| SSE fallback | WebSocket only | Productionization |
| Daily standup, full PA engine | Proactive-lite only | `docs/old/04` |

## 5. Phases

Sequential; each has an acceptance gate. No phase starts until the previous gate passes.

### P0 — Repo skeleton (1 day)
Fresh monorepo: pnpm workspaces + Turborepo, TS strict everywhere. `apps/web` (Next.js 14), `apps/server` (NestJS + Fastify), 4 packages, PGlite bootstrapping, migration runner, CI (typecheck + lint + test).
**Gate:** `pnpm dev` starts both processes cold on a clean machine with zero installs beyond Node + pnpm; health endpoint answers.

### P1 — Auth + orgs (1 day)
Register / login / logout, argon2id, session cookie (HttpOnly Secure SameSite=Lax), zxcvbn ≥ 3 server-enforced. Orgs, org members, projects, project members. Auth-gated app shell.
**Gate:** two users in two orgs cannot see each other's projects; middleware blocks all `(app)` routes when logged out.

### P2 — Conversation DAG (2 days)
Rooms, messages as DAG nodes, branches as head pointers, branch-off-any-node, branch switcher UI, Socket.IO realtime fan-out.
**Gate:** create room → send messages → branch mid-thread → both branches render correct lineage after a hard refresh.

### P3 — Agent council + relevance (2 days)
Eight personas, deterministic relevance engine, LangGraph turn graph, ModelRouter with fallback, token streaming into the thread, relevance-score inspector UI.
**Gate:** finance question wakes CFO + CEO only; `@mention` overrides; silent agents make zero model calls (assert via call log).

### P4 — Org memory / RAG (2 days)
File upload → in-process ingestion job → chunk → embed → pgvector. Hybrid search with RRF. `searchKnowledge()` in every agent turn. Citation cards. Artifact sandbox.
**Gate:** upload PDF → ask a question answerable only from it → agent response carries a correct citation card.

### P5 — Delegation (1 day)
`DELEGATE_TO:` signal parsing, delegation sub-graph, result posted as child node, chain badge in UI.
**Gate:** demo step 6 (§ demo narrative) works end-to-end.

### P6 — Demo surface + ship (2 days)
`pnpm seed:demo`, landing page, polish pass, single-box deploy (Caddy + managed Postgres), `check-env --strict`, golden-path Playwright spec.
**Gate:** the exit gate below.

## 6. Exit gate

The demo narrative in `docs/04_mvp_ui.md` §8 runs end-to-end **on the deployed URL**, driven by a **non-developer**, in **≤ 15 minutes**, exercising all four pillars. Nothing else counts as done.

## 7. Doc map

| Doc | Owns |
|-----|------|
| `00_mvp_plan.md` (this) | Scope, budget, phases, exit gate |
| `01_mvp_architecture.md` | Processes, modules, packages, security, env |
| `02_mvp_data_model.md` | Schema, DAG semantics, hybrid search SQL, migrations |
| `03_mvp_agents.md` | Personas, relevance, LangGraph, RAG, delegation, PA lite |
| `04_mvp_ui.md` | Routes, screens, WS contract, demo narrative |
| `docs/old/` | Archived full-platform specs (superseded) |
