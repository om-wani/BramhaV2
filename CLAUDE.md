# BramhaV2 — Claude Code Context

## Project

Multi-tenant SaaS AI orchestration platform. C-Suite AI council (CEO/CTO/CMO/CFO/COO/CHRO/CSO/CDAO personas) collaborate in chat rooms. Non-linear conversation DAG. File ingestion + vector knowledge layer. Delegation between agents. Goal: investor/user demo prototype.

**Archive:** full-platform codebase at git branch `v0-full-platform`. Old docs at `docs/old/`.

## Monorepo structure

```
apps/web            Next.js 14 App Router frontend
apps/server         NestJS + Fastify (API + agent runtime + ingestion, one process)
packages/shared     Zod schemas, WS protocol types, event types, error catalog
packages/db         Drizzle ORM schema, raw SQL migrations, withTenant()
packages/agents     ModelRouter, persona configs, relevance engine, prompt builder
packages/event-bus  InProcessEventEmitter (typed pub/sub, no Redis)
docs/               MVP docs (00–04); old full-platform docs in docs/old/
infra/              docker-compose.yml (Postgres+pgvector only, no Redis/MinIO)
```

## MVP plan (governing doc: `docs/00_mvp_plan.md`)

Fresh rewrite from new docs. Old codebase archived. Build P0–P6 sequentially.

**Complexity budget:** 2 Node processes, 1 infra container (Postgres+pgvector), 4 packages.

**No:** Redis, MinIO, BullMQ, Docker required locally (PGlite for local dev), MCP, source connectors, 2FA, API keys, email verify, RLS machinery, ClamAV, OTel/Grafana, Terraform, checkpoint/resume impl, SSE fallback.

**Yes:** LangGraph turn loop, orgs layer, proactive PA lite, hybrid search, artifact sandbox, delegation simple mode, Socket.IO in-process.

## Phase queue

| Phase | Name | Days |
|-------|------|------|
| P0 | Repo skeleton | 1 |
| P1 | Auth + orgs | 1 |
| P2 | Conversation DAG | 2 |
| P3 | Agent council + relevance | 2 |
| P4 | Org memory / RAG | 2 |
| P5 | Delegation | 1 |
| P6 | Demo surface + ship | 2 |

Exit gate: demo narrative in `docs/04_mvp_ui.md` runs end-to-end, non-developer, ≤ 15 min.

## Key architectural decisions (locked)

### Database
- `packages/db` — Drizzle ORM + raw SQL migrations
- `withTenant(fn, ctx)` is the ONLY query entry point (exported from index.ts)
- Raw `sql` client never exported
- Local dev: PGlite (embedded, zero-install)
- Deployed: Neon or Supabase managed Postgres
- App-level `WHERE project_id` scoping (RLS deferred to productionization)
- Migration files: `packages/db/src/migrations/00xx_name.sql` starting at `0001`

### Server (NestJS + Fastify)
- `apps/server/src/modules/` — feature modules
- Guards: `JwtAuthGuard`, `ProjectMemberGuard(role)`
- Global: `ZodValidationPipe`, problem+json exception filter (no stack traces)
- Security headers via Fastify (HSTS, nosniff, frameguard deny, referrer-policy)
- CORS: exact-origin allowlist from env

### Web (Next.js 14)
- Route groups: `(marketing)`, `(auth)`, `(app)`
- Middleware: nonce-based CSP, auth gate (protected: `/dashboard`, `/settings`, `/p/`)
- TanStack Query v5 for data fetching
- Socket.IO client for realtime
- Dark-first Tailwind + CSS variables
- Persona accent palette: 8 colors (ceo/cto/cmo/cfo/coo/chro/cso/cdao)
- shadcn-style components (hand-written, no CLI)

### Security (non-negotiable)
- argon2id passwords (m=19456, t=2, p=1)
- zxcvbn ≥ 3 enforced server-side; dynamic import client-side (avoids 800KB bundle)
- Open redirect prevention: `startsWith('/') && !startsWith('//')`
- Email enumeration prevention: generic errors (register, forgot-pw, not-found)
- CSP nonce-based; `frame-ancestors 'none'`
- All RAG/external content wrapped in `<untrusted_context>` in agent prompts
- Markdown/XSS sanitization on all user content
- Artifact sandbox: sandboxed iframe, null origin, allow-scripts only

### Agent system
- LangGraph turn graph (compiled once, invoked per turn)
- ModelRouter: Anthropic claude-sonnet-4-6 primary, OpenAI gpt-4o-mini fallback
- Relevance engine: mention (0.4) + expertise cosine (0.3) + BM25 (0.2) + recency fatigue (−0.1); threshold 0.35
- `searchKnowledge(projectId, query, k=6)` wired into every agent turn
- Delegation signal: `DELEGATE_TO: {persona} TASK: {description}` at end of response
- Checkpoint/resume: `MemorySaver` only in MVP; `PostgresSaver` extension point documented

## Development mode

**Subagent-driven development** via `superpowers:subagent-driven-development`.
- Fresh implementer subagent per task
- Spec compliance review then code quality review after each task
- No pausing between tasks (continuous execution)
- **Caveman mode (full)** active

## Docs index

| File | Content |
|------|---------|
| `docs/00_mvp_plan.md` | **Governing doc** — phases, complexity budget, cut list, exit gate |
| `docs/01_mvp_architecture.md` | Process topology, module layout, security, env vars |
| `docs/02_mvp_data_model.md` | Full schema, DAG ops, hybrid search SQL, migration convention |
| `docs/03_mvp_agents.md` | Personas, relevance engine, LangGraph loop, delegation, RAG, streaming |
| `docs/04_mvp_ui.md` | Screen-by-screen spec, demo narrative (exit gate) |
| `docs/old/` | Archived full-platform specs (superseded) |

## Important bugs to never repeat

1. **Keyboard chord order**: `if (gPressed)` check MUST come before `if (e.key === 'g')` — otherwise g+g chord unreachable
2. **useMemo with custom hooks**: Cannot call custom hooks inside useMemo — inline array directly
3. **useEffect cleanup**: Always `clearTimeout(timer)` before `removeEventListener` in keyboard nav
4. **Active state nested routes**: `pathname === href || pathname.startsWith(href + '/')` not just `===`
5. **AnyAuthGuard**: Must throw `UnauthorizedException` (not return false) when both JWT and API key fail
6. **Open redirect**: Block `https://evil.com` AND `//evil.com` (protocol-relative)
7. **Enumeration prevention**: Collapse specific error branches (e.g., 409 on register) to single generic catch
8. **zxcvbn**: Dynamic import in useEffect only — never static import at module level
9. **h1→h3 heading skip**: Always include sr-only h2 for landmark sections
10. **aria-label on bare div**: Add `role="region"` to make it effective
