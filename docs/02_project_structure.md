# 02 — Project Structure (`project_structure.md`)

Complete annotated directory tree of the BramhaV2 monorepo. The Implementation Agent MUST create
directories/files as tasks in `03_implementation_phases.md` demand them — this document is the map,
not an instruction to scaffold everything empty on day one.

Conventions: Turborepo + pnpm workspaces. `apps/*` are deployable units, `packages/*` are internal
libraries, `infra/*` is infrastructure, `docs/*` is this suite. Every package has its own
`tsconfig.json` extending `tsconfig.base.json`, its own `vitest.config.ts`, and exports only
through `src/index.ts` (enforced by eslint boundaries rules).

```
bramhav2/
├── README.md
├── package.json                      # pnpm workspace root; scripts: dev, build, test, lint, typecheck
├── pnpm-workspace.yaml               # apps/*, packages/*, infra/sandbox
├── turbo.json                        # task pipeline (build depends on ^build, etc.)
├── tsconfig.base.json                # strict TS config shared by all packages
├── .editorconfig
├── .gitignore                        # includes .env*, *.pem, coverage/, .turbo/
├── .env.example                      # EVERY env var documented; dotenv-safe validates against it
├── .pre-commit-config.yaml           # gitleaks, eslint, typecheck-staged, conventional-commit lint
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                    # lint + typecheck + unit tests + build on PR
│   │   ├── security.yml              # gitleaks full-history, npm audit/osv-scanner, Semgrep SAST, CodeQL
│   │   ├── e2e.yml                   # Playwright against compose stack
│   │   ├── docker-publish.yml        # buildx multi-stage builds, SBOM (syft), sign (cosign)
│   │   └── deploy.yml                # staging on main; prod on tag via OIDC→cloud (no long-lived keys)
│   ├── dependabot.yml                # npm + docker + github-actions ecosystems, weekly
│   └── CODEOWNERS
│
├── docs/                             # THIS documentation suite (01..08)
│
├── apps/
│   ├── web/                          # ── Next.js 15 frontend ──────────────────────────────
│   │   ├── next.config.mjs           # CSP headers, image domains, standalone output
│   │   ├── middleware.ts             # auth session check, security headers, locale
│   │   ├── app/
│   │   │   ├── (marketing)/
│   │   │   │   ├── page.tsx          # landing page
│   │   │   │   ├── pricing/page.tsx
│   │   │   │   └── layout.tsx
│   │   │   ├── (auth)/
│   │   │   │   ├── login/page.tsx
│   │   │   │   ├── register/page.tsx
│   │   │   │   ├── verify/page.tsx   # email verification
│   │   │   │   └── two-factor/page.tsx
│   │   │   ├── (app)/                # authenticated shell (sidebar, command palette)
│   │   │   │   ├── layout.tsx        # project switcher, nav, presence provider
│   │   │   │   ├── dashboard/page.tsx            # project management dashboard
│   │   │   │   ├── settings/
│   │   │   │   │   ├── profile/page.tsx
│   │   │   │   │   ├── security/page.tsx         # password, 2FA, sessions
│   │   │   │   │   └── api-keys/page.tsx
│   │   │   │   └── p/[projectId]/    # ── PROJECT WORKSPACE (the "office") ──
│   │   │   │       ├── layout.tsx                # room nav rail, activity pane, budget meter
│   │   │   │       ├── page.tsx                  # workspace overview / office lobby
│   │   │   │       ├── conference/page.tsx       # Conference Room (all C-Suite)
│   │   │   │       ├── meeting/[roomId]/page.tsx # Meeting Rooms (agent subsets)
│   │   │   │       ├── call/[agentId]/page.tsx   # 1:1 Call Rooms
│   │   │   │       ├── office/page.tsx           # CEO's Office (TipTap notes)
│   │   │   │       ├── office/[noteId]/page.tsx
│   │   │   │       ├── storage/page.tsx          # Storage/Server Room (explorer+preview)
│   │   │   │       ├── graph/[conversationId]/page.tsx  # full conversation DAG view
│   │   │   │       └── settings/page.tsx         # project settings, members, sources
│   │   │   ├── (admin)/admin/
│   │   │   │   ├── page.tsx                      # admin overview
│   │   │   │   ├── users/page.tsx
│   │   │   │   ├── agents/page.tsx               # persona & ModelPolicy editor
│   │   │   │   ├── connectors/page.tsx           # MCP connector registry + scopes
│   │   │   │   └── diagnostics/page.tsx          # token spend, queue depth, error rates
│   │   │   └── api/auth/[...nextauth]/route.ts   # Auth.js handlers
│   │   ├── components/
│   │   │   ├── chat/                 # MessageList, MessageBubble, Composer, FileDropzone,
│   │   │   │                         # BranchChips, ThreadRail, AgentChip, ThoughtsCollapse,
│   │   │   │                         # StatusTag, InterruptButton, MentionMenu(@agent)
│   │   │   ├── artifacts/            # ArtifactPane, ArtifactFrame(iframe host), CodeView,
│   │   │   │                         # DocView, VersionSwitcher, SandpackRunner
│   │   │   ├── graph/                # ConversationFlow (React Flow), NodeCard, BranchEdge
│   │   │   ├── office/               # NoteEditor(TipTap), Backlinks, GraphOfNotes, DailyNote
│   │   │   ├── storage/              # FileTree, PreviewPane, SourceConnectDialog, IngestStatus
│   │   │   ├── activity/             # BackgroundActivityPane (collapsed delegation feed)
│   │   │   ├── rooms/                # RoomHeader, RosterBar, CreateMeetingDialog
│   │   │   └── ui/                   # shadcn/ui generated primitives
│   │   ├── lib/
│   │   │   ├── api-client.ts         # typed fetch wrapper (Zod-parsed responses)
│   │   │   ├── socket.ts             # Socket.IO client, auth handshake, channel hooks
│   │   │   ├── stores/               # zustand: room-store, stream-store, artifact-store,
│   │   │   │                         # activity-store, presence-store
│   │   │   └── hooks/                # useConversationBranch, useAgentStream, useUpload, ...
│   │   └── e2e/                      # Playwright specs (auth, rooms, artifacts, branching)
│   │
│   ├── api/                          # ── NestJS API gateway + realtime ────────────────────
│   │   ├── src/
│   │   │   ├── main.ts               # Fastify adapter, helmet, CORS, OpenAPI setup
│   │   │   ├── app.module.ts
│   │   │   ├── common/
│   │   │   │   ├── guards/           # JwtAuthGuard, ProjectMemberGuard, AdminGuard, WsAuthGuard
│   │   │   │   ├── interceptors/     # AuditLogInterceptor, RlsSessionInterceptor(SET app.*)
│   │   │   │   ├── filters/          # problem+json exception filter (no stack leaks)
│   │   │   │   ├── pipes/            # ZodValidationPipe
│   │   │   │   └── rate-limit/       # token-bucket (Redis), per-route configs
│   │   │   └── modules/
│   │   │       ├── auth/             # register/login/refresh/logout/2FA; argon2id; sessions
│   │   │       ├── users/            # profile, settings, avatar (presigned)
│   │   │       ├── orgs/             # organizations, memberships, roles
│   │   │       ├── projects/         # CRUD, member mgmt, per-project agent roster
│   │   │       ├── rooms/            # conference/meeting/call room CRUD + rosters
│   │   │       ├── conversations/    # DAG nodes, branches, links, search
│   │   │       ├── artifacts/        # artifact + version CRUD, render tokens
│   │   │       ├── files/            # presigned upload, file metadata, quarantine states
│   │   │       ├── sources/          # knowledge source configs (github/sql/url)
│   │   │       ├── notes/            # CEO office notes CRUD + backlink index
│   │   │       ├── agents/           # persona registry, ModelPolicy CRUD (admin)
│   │   │       ├── delegations/      # read model for activity pane; approval endpoints
│   │   │       ├── approvals/        # human-in-loop approvals for write-scoped tools
│   │   │       ├── admin/            # user admin, diagnostics aggregates
│   │   │       ├── realtime/         # Socket.IO gateway, Redis adapter, channel authz
│   │   │       └── health/           # liveness/readiness, dependency pings
│   │   └── test/                     # e2e (supertest) incl. RLS cross-tenant probes
│   │
│   ├── agent-runtime/                # ── Orchestrator + agent workers ─────────────────────
│   │   ├── src/
│   │   │   ├── main.ts               # starts orchestrator consumer + worker pools
│   │   │   ├── orchestrator/
│   │   │   │   ├── turn-engine.ts    # consumes conv.node.created; roster→scores→speaker set
│   │   │   │   ├── turn-policies.ts  # per-roomType policies (conference/meeting/call)
│   │   │   │   ├── interrupts.ts     # interrupt/summon event handling, checkpoint signals
│   │   │   │   └── budget-guard.ts   # depth/token/turn budgets, circuit breakers
│   │   │   ├── agents/
│   │   │   │   ├── csuite-loop.ts    # LangGraph graph: gather→reason→act(tools)→respond
│   │   │   │   ├── specialist-loop.ts# isolated delegated-task graph
│   │   │   │   ├── tools/            # delegate_task, create_artifact, search_knowledge,
│   │   │   │   │                     # summon_agent, schedule_followup, mcp_call (proxied)
│   │   │   │   └── checkpointer.ts   # LangGraph checkpoint store → Postgres
│   │   │   ├── pa/                   # ── PA engine (NO LLM CALLS) ──
│   │   │   │   ├── relevance.ts      # hybrid scorer: BM25 + cosine + recency + mention boost
│   │   │   │   ├── context-bundle.ts # deterministic bundle assembly + token accounting
│   │   │   │   ├── working-memory.ts # per-agent rolling state (facts, open loops, promises)
│   │   │   │   └── summarizer.ts     # schedules utility-tier rolling summaries (cached)
│   │   │   ├── delegation/
│   │   │   │   ├── manager.ts        # spawn/track/timeout/cancel delegated jobs
│   │   │   │   └── group-bus.ts      # deleg.{groupId}.* cross-worker channels
│   │   │   └── sandbox-client.ts     # submits code-exec jobs to sandbox host
│   │   └── test/
│   │
│   └── ingestion-worker/             # ── Secure file/source ingestion ─────────────────────
│       ├── src/
│       │   ├── main.ts               # BullMQ consumers: ingest.file, ingest.source, embeddings
│       │   ├── security/             # magic-byte sniff, mime allowlist, clamav client,
│       │   │                         # image re-encode, pdf disarm, quarantine mover
│       │   ├── extractors/           # pdf, docx, csv, md, html, image(ocr optional), code
│       │   ├── chunking.ts           # heading-aware semantic chunker (512tok/64 overlap)
│       │   ├── embedder.ts           # batched embeddings via ModelRouter
│       │   └── sources/              # github-repo, gitlab, sql-introspect, url-crawler
│       └── test/                     # fixture corpus incl. hostile files (eicar, polyglots)
│
├── packages/
│   ├── shared/                       # ── THE contract layer ──
│   │   └── src/
│   │       ├── schemas/              # Zod: users, projects, rooms, nodes, branches, artifacts,
│   │       │                         # files, sources, delegations, approvals, personas, policies
│   │       ├── events/               # Zod bus payloads: conv.*, delegation.*, ingest.*,
│   │       │                         # artifact.*, presence.*, approval.*, audit.*
│   │       ├── ws-protocol.ts        # client⇄server socket event map (typed)
│   │       ├── errors.ts             # problem+json error catalog with stable codes
│   │       └── constants.ts          # limits: MAX_UPLOAD_MB, CONTEXT_TOKEN_CAP, TURN_DEPTH...
│   │
│   ├── db/                           # Drizzle schema + migrations + RLS
│   │   └── src/
│   │       ├── schema/               # one file per domain (see 05_data_model)
│   │       ├── migrations/           # SQL incl. RLS policies, triggers (cycle guard), indexes
│   │       ├── rls.ts                # withTenant(tx, {userId, projectId}) helper (SET LOCAL app.*)
│   │       └── seed/                 # dev seed: demo org/project, default C-Suite personas
│   │
│   ├── agents/                       # model + persona toolkit (runtime-agnostic)
│   │   └── src/
│   │       ├── model-router.ts       # ONLY vendor-SDK importer; failover, budgets, caching
│   │       ├── providers/            # anthropic.ts, openai.ts, google.ts, ollama.ts (thin)
│   │       ├── persona.ts            # persona → system prompt compiler (stable prefix order)
│   │       ├── token-count.ts        # per-provider tokenizers behind one interface
│   │       └── semantic-cache.ts     # embedding-keyed cache for utility calls
│   │
│   ├── event-bus/                    # Redis pub/sub + streams wrapper
│   │   └── src/                      # publish/subscribe typed by packages/shared/events;
│   │                                 # channel authz helpers (:{projectId} suffix enforcement)
│   │
│   ├── mcp-connectors/               # MCP servers + client policy engine
│   │   └── src/
│   │       ├── client/               # McpClientPool, capability tokens, policy-engine.ts
│   │       │                         # (per-agent×connector×scope allowlist + approval gates)
│   │       ├── servers/
│   │       │   ├── filesystem/       # project-scoped read/write within /data/{projectId}
│   │       │   ├── database/         # read-only SQL over user-connected DBs (scoped creds)
│   │       │   ├── git/              # clone/read of connected repos (no push by default)
│   │       │   └── web/              # allowlisted fetch/search
│   │       └── registry.ts           # connector manifest schema + validation
│   │
│   └── ui/                           # (optional) shared React primitives if web splits later
│
├── infra/
│   ├── docker/
│   │   ├── compose.dev.yml           # pg16+pgvector, redis, minio, clamav, otel-collector,
│   │   │                             # grafana/loki/prometheus, mcp-node containers (no-egress nets)
│   │   ├── Dockerfile.api            # multi-stage, distroless runtime, nonroot USER
│   │   ├── Dockerfile.web
│   │   ├── Dockerfile.agent-runtime
│   │   ├── Dockerfile.ingestion
│   │   ├── Dockerfile.mcp-node       # base for connector servers
│   │   └── sandbox/
│   │       ├── Dockerfile.exec       # minimal exec image (node+python), read-only rootfs
│   │       └── seccomp-exec.json     # default-deny syscall profile
│   ├── terraform/
│   │   ├── modules/
│   │   │   ├── network/              # VPC, public/private/isolated subnets, NAT, endpoints
│   │   │   ├── ecs-services/         # task defs for each app unit, autoscaling policies
│   │   │   ├── rds/                  # Postgres multi-AZ, pgvector, encrypted, backups
│   │   │   ├── elasticache/          # Redis with TLS + AUTH
│   │   │   ├── s3/                   # buckets: uploads(staging/clean/quarantine), artifacts
│   │   │   ├── waf/                  # managed rules + rate rules + bot control
│   │   │   ├── mcp-isolated/         # isolated subnet services for MCP nodes, SG deny-all-egress
│   │   │   └── observability/        # log groups, SIEM firehose, alarms
│   │   └── envs/{staging,prod}/      # per-env compositions + remote state config
│   └── sandbox/                      # sandbox host service (container pool manager)
│       └── src/                      # spawn/attach/kill, cgroup caps, result capture
│
└── scripts/
    ├── bootstrap.sh                  # one-shot dev setup: deps, compose, migrate, seed
    ├── db-migrate.ts
    └── check-env.ts                  # dotenv-safe validation against .env.example
```

## Workspace dependency rules (enforced via eslint-plugin-boundaries)

```
apps/web            → packages/shared, packages/ui
apps/api            → packages/shared, packages/db, packages/event-bus
apps/agent-runtime  → packages/shared, packages/db, packages/event-bus, packages/agents,
                      packages/mcp-connectors(client only)
apps/ingestion-worker → packages/shared, packages/db, packages/event-bus, packages/agents(embeddings)
packages/*          → packages/shared only (no app imports, no sibling imports except shared)
VENDOR SDK IMPORTS  → allowed ONLY in packages/agents/src/providers/*
```

## Naming & code conventions for the Implementation Agent

- Files: kebab-case; React components: PascalCase files in `components/`.
- All cross-boundary payloads (HTTP bodies, bus events, WS frames, job data) MUST be Zod schemas
  from `packages/shared` — define the schema first, then use `z.infer` types.
- Database access outside `packages/db` is forbidden; every query runs inside
  `withTenant()` unless explicitly a system/admin path (list maintained in `rls.ts`).
- Every module ships with colocated `*.test.ts` (vitest); e2e lives in the owning app.
- Env access only through a validated `env.ts` per app (zod-parsed `process.env`).
