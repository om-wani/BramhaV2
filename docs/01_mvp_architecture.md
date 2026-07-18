# BramhaV2 — MVP Architecture

## 1. Process topology

Two Node processes. One database. Nothing else.

```
┌──────────────────┐   HTTPS (REST)    ┌─────────────────────────────────────┐
│    apps/web      │◄─────────────────►│           apps/server               │
│    Next.js 14    │                   │        NestJS + Fastify             │
│    App Router    │   WebSocket       │                                     │
│                  │◄─────────────────►│  ┌─────────┐ ┌────────┐ ┌────────┐ │
└──────────────────┘   (Socket.IO)     │  │  HTTP   │ │ Agent  │ │ Ingest │ │
                                       │  │ modules │ │runtime │ │ worker │ │
                                       │  └────┬────┘ └───┬────┘ └───┬────┘ │
                                       │       └─── event-bus ───────┘      │
                                       └──────────────────┬──────────────────┘
                                                          │
                                            ┌─────────────▼─────────────┐
                                            │   Postgres + pgvector     │
                                            │  local: PGlite (embedded) │
                                            │  deployed: Neon/Supabase  │
                                            └───────────────────────────┘
```

The agent runtime and ingestion worker are **NestJS modules inside the same process** as the API, communicating through the typed in-process event bus. This is the single biggest simplification vs. v0 (which ran 4 processes over Redis). The seams that made them separate processes are preserved as module boundaries, so re-splitting later is a deployment change, not a rewrite.

## 2. apps/server layout

```
apps/server/src/
  main.ts                  Fastify adapter, security headers, CORS, Socket.IO attach
  app.module.ts
  common/
    guards/                JwtAuthGuard, ProjectMemberGuard(role)
    pipes/                 ZodValidationPipe (global)
    filters/               ProblemJsonExceptionFilter (RFC 7807, no stack traces)
  modules/
    auth/                  register, login, logout, session refresh
    orgs/                  org CRUD, org membership
    projects/              project CRUD, project membership
    rooms/                 room CRUD
    conversation/          node create, branch create/switch, thread read
    files/                 upload (multipart → UPLOADS_DIR), list, delete
    search/                debug endpoint over hybrid search
  agent/
    graph.ts               LangGraph turn graph — compiled once at bootstrap
    relevance.ts           deterministic agent selection (no LLM)
    prompt-builder.ts      persona system prompts, <untrusted_context> wrapping
    delegation.ts          DELEGATE_TO parsing + sub-graph dispatch
    proactive.ts           PA-lite interval check (open loops, rate cap)
  ingestion/
    poller.ts              claims queued ingestion_jobs on interval
    chunker.ts             markdown-aware splitter, ~800 tokens, 15% overlap
    embedder.ts            batch embed via ModelRouter
  gateway/
    events.gateway.ts      Socket.IO namespace, room join auth, event fan-out
```

**Turn flow:** `conversation` module persists the user node → emits `node.created` on the event bus → `agent/` subscriber runs relevance → invokes the LangGraph graph per selected persona → streams tokens through `gateway/` → persists agent nodes via `conversation` service. HTTP request returns as soon as the user node is stored; everything after is push.

## 3. Workspace packages

| Package | Exports | Never contains |
|---------|---------|----------------|
| `packages/shared` | Zod schemas (API DTOs), WS event types, error catalog, persona slugs | runtime deps beyond zod |
| `packages/db` | Drizzle schema, `withTenant()`, `migrate()` | an exported raw `sql` client |
| `packages/agents` | `ModelRouter`, persona configs, relevance scoring fns | Nest/Next imports (framework-free) |
| `packages/event-bus` | `TypedEventBus` (typed `emit`/`on` over Node `EventEmitter`) | Redis, transport logic |

Dependency direction: `web → shared`; `server → shared, db, agents, event-bus`; packages never import from apps.

## 4. apps/web layout

- Route groups: `(marketing)` `/`, `(auth)` `/login /register`, `(app)` everything gated.
- `middleware.ts`: nonce-based CSP + auth gate (`/dashboard`, `/settings`, `/p/`) via session cookie presence; server verifies on every API call.
- Data: TanStack Query v5; Socket.IO client feeds deltas into the query cache (no second store).
- Styling: dark-first Tailwind + CSS variables; 8-color persona accent palette (`--persona-ceo` … `--persona-cdao`); hand-written shadcn-style components (no CLI).
- zxcvbn: **dynamic import inside useEffect only** (800 KB — never static).

## 5. Realtime contract

Socket.IO, in-process (no adapter). Handshake carries the session cookie; the gateway authorizes `join room:{roomId}` against project membership before subscribing.

| Event | Direction | Payload |
|-------|-----------|---------|
| `node:created` | S→C | full persisted node |
| `node:delta` | S→C | `{ nodeId, seq, text }` — streaming tokens, seq for ordering |
| `node:error` | S→C | `{ nodeId, code }` — stream failed; client discards partial |
| `branch:created` | S→C | branch row |
| `file:status` | S→C | `{ fileId, status }` |
| `turn:selection` | S→C | `{ userNodeId, scores: PersonaScore[] }` — feeds relevance inspector |

Client renders streaming nodes optimistically; `node:created` is authoritative and replaces the streamed buffer.

## 6. Storage

- Files: local disk under `UPLOADS_DIR` (default `./uploads`, gitignored), path stored in DB. `FileStorage` interface (`put/get/delete`) so S3 is a driver swap later.
- Limits: 25 MB/file. Accepted: pdf, docx, txt, md, csv. MIME sniffed server-side (magic bytes), not trusted from the client.

## 7. ModelRouter (`packages/agents`)

```ts
interface ModelRouter {
  stream(req: ChatRequest): AsyncIterable<TextDelta>;  // primary → retry ×2 → fallback → throw
  embed(texts: string[]): Promise<number[][]>;          // batched, 1536-dim
}
```

- Primary chat: Anthropic `claude-sonnet-4-6`. Fallback: OpenAI `gpt-4o-mini`. Embeddings: OpenAI `text-embedding-3-small`.
- Vercel AI SDK underneath; providers chosen by env, injected once at bootstrap.
- Every call logged (persona, model, token counts) to a `model_calls` table — this is how P3's "silent agents cost zero" gate is asserted.

## 8. Security baseline (MVP, non-negotiable)

- argon2id (m=19456, t=2, p=1); zxcvbn ≥ 3 enforced server-side.
- Session: opaque token in HttpOnly Secure SameSite=Lax cookie; server-side session row with expiry.
- Open redirect: `next` param must satisfy `startsWith('/') && !startsWith('//')`.
- Enumeration: register/forgot-password/not-found collapse to generic messages.
- Headers (Fastify): HSTS, nosniff, `X-Frame-Options: DENY`, referrer-policy; CSP nonce-based with `frame-ancestors 'none'`.
- CORS: exact-origin allowlist from env.
- All user/RAG content sanitized before render; all retrieved chunks wrapped in `<untrusted_context>` in prompts (see `03_mvp_agents.md` §5).
- Artifact sandbox: `<iframe sandbox="allow-scripts">` served from a null origin — no `allow-same-origin`, ever.
- **Accepted risk:** tenant isolation is app-level (`withTenant`), not RLS. Documented; RLS re-entry spec in `docs/old/05`.

## 9. Environment

```
DATABASE_URL          # postgres://… ; unset locally → PGlite at .data/pglite
ANTHROPIC_API_KEY
OPENAI_API_KEY
SESSION_SECRET        # 32+ random chars
APP_ORIGIN            # exact web origin for CORS/CSP
UPLOADS_DIR           # default ./uploads
NODE_ENV
```

`check-env --strict` (P6) fails the boot if any required var is missing in production.

## 10. Deployment (demo)

Single VPS: Caddy (TLS, reverse proxy) → `web` :3000 and `server` :3001; managed Postgres with pgvector enabled; `pnpm build && pnpm start` under systemd. No containers required.
