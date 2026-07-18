# BramhaV2 MVP Plan

## Goal

Investor + target-user demo prototype. Runs on one box. Non-developer can drive the golden path in ≤ 15 min. Ships within days, not months.

## Four essence pillars (non-negotiable demo moments)

1. **Selective council** — agents join/stay-silent based on deterministic relevance score; silence = zero tokens
2. **Branching DAG** — user can branch off any node, explore alternatives, non-linear conversation
3. **Org memory / RAG** — file upload → chunked → hybrid search → cited in agent turns
4. **Delegation** — one agent hands off sub-task to specialist; result flows back to thread

## Complexity budget

| Layer | Allow |
|-------|-------|
| Node processes | 2 (`web`, `server`) |
| Infra (local) | 1 (Postgres + pgvector via PGlite, embedded, zero-install) |
| Infra (deployed demo) | 1 managed Postgres (Neon or Supabase) |
| Workspace packages | 4 (`shared`, `db`, `agents`, `event-bus`) |

No Redis. No MinIO. No BullMQ. No Docker required for local dev.

## Cut for MVP (documented extension points, not implemented)

- Redis / Socket.IO cluster adapter (in-process emitter instead)
- MinIO / S3 file storage (local disk or DB-stored blobs)
- BullMQ (DB-polled job rows, in-process runner)
- MCP server integration + policy engine
- Source connectors (GitHub, SQL, web crawl)
- 2FA, API keys, email verification (auto-verify in MVP)
- Row-level security / GUC machinery (app-level `WHERE project_id` scoping; RLS documented as productionization step)
- ClamAV, OTel, Grafana, Loki, Prometheus
- Terraform / cloud IaC
- Daily standup, proactive PA scheduling (proactive-lite only: stale open-loop follow-up, rate-capped)
- Checkpoint/resume LangGraph state (interface documented, not implemented; stop = abort)
- SSE fallback (WebSocket only)

## Phases

### P0 — Repo skeleton (1 day)
Fresh `apps/web` (Next.js 14) + `apps/server` (NestJS/Fastify) + 4 packages. PGlite local, managed Postgres prod. Turborepo + pnpm workspaces. No content yet.

### P1 — Auth + orgs (1 day)
Registration, login, session cookies (HttpOnly, Secure, SameSite=Lax). argon2id. zxcvbn strength meter (client dynamic import). Org creation, org membership, project creation. No email verify (auto-verified). 

Data: `users`, `orgs`, `org_members`, `projects`, `project_members`.

### P2 — Conversation DAG (2 days)
Create room, send message, receive streamed agent response. DAG: `conversation_nodes` (parent_id + depth) + `branches` (head pointer). Branch-off any node. Socket.IO for realtime (in-process, no Redis adapter). Persona-tagged messages.

### P3 — Agent council + relevance (2 days)
8 C-Suite personas (Astra/CEO, Vulcan/CTO, Meridian/CMO, Lyra/COO, Ledger/CFO, Iris/CHRO, Sage/CSO, Orion/CDAO). Deterministic relevance: mention score + expertise cosine + BM25 lexical + recency fatigue. Silent agents skip entirely. LangGraph turn loop. ModelRouter (primary + fallback provider). Streaming SSE from server → Socket.IO push.

### P4 — Org memory / RAG (2 days)
File upload (local disk). Chunking + embedding (pgvector HNSW). Hybrid search: vector cosine + tsvector BM25 → RRF fusion. `searchKnowledge` wired into agent turn context. Citation cards in UI. Artifact sandbox (sandboxed iframe, null origin).

### P5 — Delegation (1 day)
Simple delegation: one persona hands off sub-task to named specialist. Specialist turn runs, result posted back as child node. UI shows delegation chain.

### P6 — Demo surface + ship (2 days)
`pnpm seed:demo` script. Nav/route trim. Polish pass. Single-box deploy (Caddy). `check-env --strict`. Golden-path Playwright spec.

## Exit gate

The §7 demo narrative (docs/04_mvp_ui.md) runs end-to-end on deployed URL, driven by non-developer, ≤ 15 min.

## Archive pointer

Old full-platform codebase: git branch `v0-full-platform`. Old docs: `docs/old/`.
