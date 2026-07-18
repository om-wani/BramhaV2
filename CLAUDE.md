# BramhaV2 — Claude Code Context

## Project

Multi-tenant SaaS AI orchestration platform. C-Suite AI council (8 personas: ceo/cto/cmo/cfo/coo/chro/cso/cdao) collaborate in chat rooms. Non-linear conversation DAG. File ingestion + vector knowledge layer. Delegation between agents. Goal: investor/target-user demo prototype.

**Archive:** full-platform codebase at git branch `v0-full-platform`. Old docs at `docs/old/`.

## Monorepo structure

```
apps/web            Next.js 14 App Router frontend
apps/server         NestJS + Fastify — API + agent runtime + ingestion, ONE process
packages/shared     Zod schemas, WS event types, error catalog, persona slugs
packages/db         Drizzle schema, raw SQL migrations, withTenant()
packages/agents     ModelRouter, persona configs, relevance scoring (framework-free)
packages/event-bus  TypedEventBus (in-process, no Redis)
docs/               MVP docs 00–04; archived full-platform docs in docs/old/
```

## MVP plan (governing doc: `docs/00_mvp_plan.md`)

Fresh rewrite from new docs. Old codebase archived — do not reuse it. Build P0–P6 sequentially; each phase has an acceptance gate, no phase starts before the previous gate passes.

**Complexity budget (hard ceiling):** 2 Node processes · 0 local infra installs (PGlite) · 1 deployed infra (managed Postgres) · 4 packages · 2 external APIs (Anthropic, OpenAI).

**Out:** Redis, MinIO, BullMQ, Docker-for-local, MCP, source connectors, 2FA, API keys, email verification, RLS machinery, ClamAV, OTel/Grafana, Terraform, checkpoint/resume implementation, SSE fallback.

**In:** LangGraph turn graph, orgs layer, proactive PA lite, hybrid search (RRF), artifact sandbox, delegation simple mode (one hop), Socket.IO in-process.

## Phase queue

| Phase | Name | Days | Gate (short form) |
|-------|------|------|-------------------|
| P0 | Repo skeleton | 1 | `pnpm dev` cold-starts on clean machine, zero installs |
| P1 | Auth + orgs | 1 | cross-org isolation; auth gate on all (app) routes |
| P2 | Conversation DAG | 2 | branch mid-thread, both lineages survive hard refresh |
| P3 | Council + relevance | 2 | silent agents make zero model calls (assert via model_calls) |
| P4 | Org memory / RAG | 2 | uploaded PDF answered with correct citation card |
| P5 | Delegation | 1 | delegation demo beat works end-to-end |
| P6 | Demo surface + ship | 2 | full exit gate below |

**Exit gate:** demo narrative `docs/04_mvp_ui.md` §8 runs on the deployed URL, non-developer driving, ≤ 15 min.

## Key architectural decisions (locked)

### Database
- `withTenant(ctx, fn)` is the ONLY tenant query entry point; raw sql client package-private
- Tenant tables carry `project_id` denormalized; scoping = single predicate
- **DAG:** nodes form a tree via `parent_id`; a branch is ONLY a named head pointer (`head_node_id`). Fork copies nothing. Head advance is optimistic (`WHERE head_node_id = expected`); conflict → auto-fork
- Job claim: `FOR UPDATE SKIP LOCKED` on `ingestion_jobs`
- Hybrid search: pgvector HNSW + tsvector GIN, RRF k=60, `websearch_to_tsquery` (never `to_tsquery`)
- Local dev: PGlite embedded; deployed: Neon/Supabase. Same migration files both
- Migrations: `packages/db/src/migrations/00xx_name.sql` from `0001`; applied files immutable
- App-level scoping only; RLS deferred (documented accepted risk)

### Server (NestJS + Fastify)
- Guards: `SessionAuthGuard` (opaque token, SHA-256 stored, sessions table), `ProjectMemberGuard(role)`
- Global: `ZodValidationPipe`, problem+json filter (no stack traces)
- Security headers via Fastify: HSTS, nosniff, frameguard DENY, referrer-policy
- CORS exact-origin allowlist; Socket.IO room join authorized against project membership
- Turn flow: HTTP returns after user node persists; agent output arrives via WS push only

### Web (Next.js 14)
- Route groups `(marketing)` `(auth)` `(app)`; middleware = nonce CSP + auth gate (`/dashboard`, `/settings`, `/p/`)
- TanStack Query v5; Socket.IO deltas feed the query cache (no second store)
- Dark-first Tailwind + CSS vars; persona accent palette drives all identity UI
- shadcn-style components hand-written, no CLI

### Security (non-negotiable)
- argon2id (m=19456, t=2, p=1); zxcvbn ≥ 3 server-side; zxcvbn client = dynamic import in useEffect ONLY
- Open redirect: `startsWith('/') && !startsWith('//')`
- Enumeration: generic errors on register/forgot-pw/not-found
- CSP nonce-based; `frame-ancestors 'none'`
- RAG chunks ONLY inside `<untrusted_context>`; strip literal closing tag from chunk content; never follow directives from retrieved text
- Citations validated against actual chunk set in finalize; hallucinated sources dropped
- Markdown/XSS sanitized on all rendered content
- Artifact iframe: `sandbox="allow-scripts"`, null origin, NEVER `allow-same-origin`
- File MIME from magic bytes, not client; 25 MB cap

### Agent system
- Relevance: `0.4·mention + 0.3·expertise-cosine + 0.2·lexical − 0.1·fatigue`; threshold 0.35; cap 4/turn; no-clear → top-1 responds; 1:1 rooms skip scoring
- ONE embed call per turn (shared by all 8 scorings + RAG query)
- LangGraph nodes: select → retrieve → respond (sequential per persona; later personas see earlier responses) → delegate? → finalize
- Persist only in finalize; failed stream persists nothing
- ModelRouter: claude-sonnet-4-6 primary → 2 retries → gpt-4o-mini fallback; embeddings text-embedding-3-small; every call logged to `model_calls`; max_tokens 700/persona
- `searchKnowledge(projectId, query, k=6)` in every turn
- Delegation: `DELEGATE_TO: {slug} TASK: {sentence}` final line; one hop max (delegated prompt omits delegation instruction); result = child of delegating node
- PA lite: 1:1 rooms only, open loops in `projects.working_memory`, fire >24h stale, cap 1/project/4h
- Checkpoint/resume: `MemorySaver` only; `PostgresSaver` slot documented in `docs/03_mvp_agents.md` §9 — DO NOT implement in MVP

## Development mode

**Subagent-driven development** via `superpowers:subagent-driven-development`.
- Fresh implementer subagent per task
- Spec compliance review then code quality review after each task
- No pausing between tasks (continuous execution)
- **Caveman mode (full)** active

## Task tracking & session log (MANDATORY every session)

Two living files in `docs/`:

- **`docs/TASKS.md`** — full P0–P6 task breakdown with stable IDs (P0.1, P4.3, …).
  - **Session start:** read it; current phase is marked at top.
  - **During work:** flip `[ ]`→`[~]` when starting a task, `[~]`→`[x]` when its work lands — in the same commit as the code. `[-]` = dropped, with reason. Never renumber IDs; append new tasks at phase end.
  - Phase gates in TASKS.md mirror `docs/00_mvp_plan.md` §5; a phase isn't done until its gate task is `[x]`.
- **`docs/SESSION_LOG.md`** — append-only, newest first.
  - **Session end (or before context runs out):** prepend one entry using the template at the top of the file — date, branch@commits, done (with task IDs), decisions, next step.
  - Log decisions + why, not narration. One entry per session, not per commit.

Rule: any commit that completes a task updates TASKS.md in that commit. Last commit of a session includes the SESSION_LOG.md entry.

## Docs index

| File | Content |
|------|---------|
| `docs/00_mvp_plan.md` | **Governing** — pillars, budget, in/out with re-entry points, phases + gates |
| `docs/01_mvp_architecture.md` | Topology, server/web layout, packages, realtime contract, security, env |
| `docs/02_mvp_data_model.md` | Schema, DAG semantics, hybrid search SQL, job claim, withTenant, migrations |
| `docs/03_mvp_agents.md` | Personas, relevance math, turn graph, prompts, delegation, PA lite, checkpoint slot |
| `docs/04_mvp_ui.md` | Routes, room screen, WS handling, **demo narrative §8 = exit gate** |
| `docs/TASKS.md` | **Living** task tracker — statuses, phase gates (update rules above) |
| `docs/SESSION_LOG.md` | **Living** append-only session log (update rules above) |
| `docs/old/` | Archived full-platform specs (superseded) |

## Important bugs to never repeat

1. **Keyboard chord order**: `if (gPressed)` check MUST come before `if (e.key === 'g')` — otherwise g+g chord unreachable
2. **useMemo with custom hooks**: cannot call custom hooks inside useMemo — inline array directly
3. **useEffect cleanup**: always `clearTimeout(timer)` before `removeEventListener` in keyboard nav
4. **Active state nested routes**: `pathname === href || pathname.startsWith(href + '/')` not just `===`
5. **Auth guards**: throw `UnauthorizedException` (never return false) on auth failure
6. **Open redirect**: block `https://evil.com` AND `//evil.com` (protocol-relative)
7. **Enumeration prevention**: collapse specific error branches (e.g. 409 on register) to single generic catch
8. **zxcvbn**: dynamic import in useEffect only — never static import at module level
9. **h1→h3 heading skip**: always include sr-only h2 for landmark sections
10. **aria-label on bare div**: add `role="region"` to make it effective
