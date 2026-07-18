# MVP Architecture

## Process topology

```
┌─────────────────┐        ┌──────────────────────────────────────┐
│   apps/web      │ HTTP   │   apps/server                        │
│   Next.js 14    │◄──────►│   NestJS + Fastify                   │
│   App Router    │        │   ┌──────────┬──────────┬──────────┐ │
│                 │ WS     │   │  API     │  Agent   │ Ingest   │ │
│                 │◄──────►│   │  modules │  runtime │  worker  │ │
└─────────────────┘        │   └──────────┴──────────┴──────────┘ │
                           │         in-process event emitter      │
                           └──────────────────────────────────────┘
                                          │
                              ┌───────────┴───────────┐
                              │       Postgres         │
                              │   + pgvector ext       │
                              │  (PGlite local /       │
                              │  Neon/Supabase prod)   │
                              └───────────────────────┘
```

## apps/web — Next.js 14 App Router

- Route groups: `(marketing)`, `(auth)`, `(app)`
- Middleware: nonce-based CSP, auth gate (`/dashboard`, `/settings`, `/p/`, `/admin`)
- TanStack Query v5 for server state
- Socket.IO client for realtime
- Dark-first Tailwind + CSS variables
- Persona accent palette: 8 colors (ceo/cto/cmo/cfo/coo/chro/cso/cdao)
- shadcn-style components (hand-written, no CLI)
- zxcvbn strength meter: dynamic import in useEffect only (never static — adds 800KB)

## apps/server — NestJS + Fastify

Single process. Three logical layers inside:

**API modules** (`src/modules/`):
- `auth` — register, login, logout, session refresh
- `orgs` — org CRUD, membership
- `projects` — project CRUD, membership
- `rooms` — room creation, metadata
- `messages` — DAG node write, branch ops
- `files` — upload, presign, delete
- `search` — hybrid search endpoint

**Agent runtime** (`src/agent/`):
- LangGraph turn graph (compile once, invoke per turn)
- `ModelRouter` — primary + fallback providers, Vercel AI SDK
- Persona compiler — system prompt builder from persona config
- Relevance engine — deterministic scoring, agent selection
- Delegation handler — sub-task dispatch + result merge

**Ingestion worker** (`src/ingestion/`):
- In-process job polling (DB rows, not BullMQ)
- Chunker (markdown-aware, fixed-size + sentence overlap)
- Embedder (via ModelRouter embedding provider)
- pgvector upsert

**Shared infra**:
- `InProcessEventEmitter` — typed pub/sub replacing Redis pub/sub
- `withTenant(fn, ctx)` — only query entry point from `packages/db`
- Drizzle ORM + raw SQL migrations

## Guards + security

- `JwtAuthGuard` — validates session JWT from HttpOnly cookie
- `ProjectMemberGuard(role)` — checks org → project membership
- `ZodValidationPipe` — global request validation
- Problem+JSON exception filter (no stack traces in prod)
- Security headers: HSTS, nosniff, frameguard deny, referrer-policy
- CORS: exact-origin allowlist from env
- argon2id passwords (m=19456, t=2, p=1)
- Open redirect prevention: `startsWith('/') && !startsWith('//')`
- Email enumeration prevention: generic errors on register, forgot-pw, not-found
- Markdown/XSS sanitization on all user content
- `<untrusted_context>` wrapping around all RAG/external content in agent prompts

## packages

| Package | Contents |
|---------|----------|
| `packages/shared` | Zod schemas, WS protocol types, error catalog, event types |
| `packages/db` | Drizzle schema, raw SQL migrations, `withTenant()` |
| `packages/agents` | `ModelRouter`, persona configs, relevance engine, prompt builder |
| `packages/event-bus` | `InProcessEventEmitter` typed wrapper |

## Database

- Postgres + pgvector extension
- Local dev: PGlite (embedded, zero-install, no Docker)
- Deployed: managed Postgres (Neon or Supabase free tier)
- Drizzle ORM for type-safe queries
- Raw SQL migration files: `packages/db/src/migrations/00xx_name.sql`
- App-level `WHERE project_id` scoping (RLS deferred to productionization)
- `withTenant(fn, ctx)` is the only query entry point — never expose raw `sql` client

## Realtime

- Socket.IO (in-process, no Redis adapter)
- Rooms: `project:{projectId}`, `room:{roomId}`
- Events: `message:created`, `message:delta` (streaming), `branch:created`, `member:joined`
- Agent streaming: server-side LangGraph token stream → Socket.IO `message:delta` events

## File storage

- MVP: local disk (`uploads/` directory, gitignored)
- Extension point: swap to S3-compatible on productionization
- Max file size: 50 MB
- Accepted: PDF, DOCX, TXT, MD, CSV, XLSX, PPTX, PNG, JPG

## ModelRouter

- Wraps Vercel AI SDK
- Primary provider: Anthropic (claude-sonnet-4-6 default)
- Fallback provider: OpenAI (gpt-4o-mini)
- Embedding provider: OpenAI (text-embedding-3-small)
- Config via env: `LLM_PRIMARY`, `LLM_FALLBACK`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
- Retry: 2 attempts on primary, then fallback

## Checkpoint/resume (documented, not implemented)

LangGraph graph has a `checkpointSaver` injection point. In MVP: `MemorySaver` (in-process, no persistence). Abort = no resume. Extension: swap in `PostgresSaver` from `@langchain/langgraph-checkpoint-postgres` for durable state.

## Environment variables (minimal MVP set)

```
DATABASE_URL           # Postgres connection string (PGlite: use 'pglite://local')
ANTHROPIC_API_KEY
OPENAI_API_KEY
JWT_SECRET             # 32+ char random
SESSION_SECRET         # 32+ char random
NEXT_PUBLIC_API_URL    # e.g. http://localhost:3001
NEXT_PUBLIC_WS_URL     # e.g. http://localhost:3001
UPLOADS_DIR            # local disk path, default ./uploads
NODE_ENV
```
