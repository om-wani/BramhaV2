# BramhaV2 — Claude Code Context

## Project

Multi-tenant SaaS AI orchestration platform. C-Suite AI council (CEO/CTO/CMO/CFO/COO/CHRO/CSO/CDAO personas) collaborate in spatial chat rooms. Non-linear conversation DAG. Secure file ingestion. Vector knowledge layer. MCP tool integration.

## Monorepo structure

```
apps/web          Next.js 14 App Router frontend
apps/api          NestJS + Fastify backend            ┐ merging into single
apps/agent-runtime  LangGraph agent execution engine  ├ `apps/server` process
apps/ingestion-worker  BullMQ file/source ingestion   ┘ in MVP task M1.2
packages/shared   Zod schemas, events, WS protocol, error catalog
packages/db       Drizzle ORM schema, migrations, RLS, withTenant()
packages/agents   ModelRouter, persona compiler, providers
packages/event-bus  Typed pub/sub wrapper (in-process transport for MVP)
packages/mcp-connectors  MCP registry, client pool, policy engine — PRUNED in M1.1
infra/            Docker Compose (Terraform pruned in M1.1)
docs/             00 = governing MVP plan; 01–08 full-vision specs
```

## Active branch

`claude/mvp-plan-simplify-1zfx9b`

## MVP plan (governing doc: `docs/00_staged_roadmap.md`, v2)

The old phase model is retired. Old Phases 1–4 are substantially built (migrations through
0026, ~890 tests green — see `docs/AUDIT_REPORT.md`), **but the platform topology is too
complex for the current goal** (investor/target-user demo on one box). The MVP plan therefore
**prunes and consolidates the codebase itself** — hiding features is not enough:

- **Complexity budget:** 2 Node processes (`web` + `server`), 3 infra containers
  (pg+pgvector, redis, minio), 4 workspace packages (`shared`, `db`, `agents`, `event-bus`).
- **Pruned from the tree** (preserved at git tag `v0-full-platform`): mcp-connectors,
  approvals, sources/connectors, proactive PA, daily standup, backpressure/queue-fairness,
  admin diagnostics, Terraform, ClamAV/OTel/Grafana/mailpit services, SSE fallback.
- **Kept as-is** (working + tested; do not rebuild): auth, DAG + branching, RLS + withTenant,
  hybrid search, ingestion pipeline, artifact sandbox, notes, persona/relevance/turn engine,
  ModelRouter.
- Prune rule: only cleanly separable units; never destabilize a keeper to complete a prune.

## MVP task queue (detail: roadmap §6)

- **M1 — Collapse the runtime:** M1.1 tag `v0-full-platform` + prune · M1.2 merge
  api/agent-runtime/ingestion-worker into one `apps/server` process (in-process event bus) ·
  M1.3 three-container dev stack, auto-verify auth, ClamAV out of the gate
- **M2 — Golden path:** M2.1 wire RAG into agent turns (stubs return `[]` — critical gap) ·
  M2.2 delegation simple mode · M2.3 artifact auto-open + citation cards
- **M3 — Demo surface:** M3.1 route/nav trim (delete, not hide) · M3.2 `pnpm seed:demo` ·
  M3.3 polish pass
- **M4 — Ship:** M4.1 single-box deploy (Caddy + `check-env --strict`) · M4.2 golden-path
  Playwright spec · M4.3 demo script runbook

Exit gate: the roadmap §7 demo narrative runs end-to-end on the deployed URL, driven by a
non-developer, ≤ 15 min. Nothing outside M1–M4 is MVP work.

After 2.3.3:
- T2.4.1 — Notes backend + backlinks
- T2.4.2 — Office UI (TipTap three-pane)

## Key architectural decisions (locked)

### Database
- `packages/db` — Drizzle ORM + raw SQL migrations
- `withTenant(fn, ctx)` is the ONLY query entry point (exported from index.ts)
- `sql` postgres.js client is package-private (never exported)
- All tenant tables: `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`
- RLS policies use `NULLIF(current_setting('app.user_id', TRUE), '')::uuid`
- Roles: `bramha_app` (DML, RLS-filtered), `bramha_migrator` (DDL+DML, BYPASSRLS)
- Migration files: `packages/db/src/migrations/00xx_name.sql` (0001–0026 applied)
- Next migration: `0027_*.sql`

### API (NestJS + Fastify)
- `apps/api/src/modules/` — feature modules
- Guards: `JwtAuthGuard`, `ApiKeyGuard`, `AnyAuthGuard`, `ProjectMemberGuard(role)`, `AdminGuard`
- Global: `ZodValidationPipe`, problem+json exception filter (no stack traces)
- Security headers via Fastify (HSTS, nosniff, frameguard deny, referrer-policy)
- CORS: exact-origin allowlist from env
- API keys: `bmv2_<8hex>_<base64url>`, SHA-256 stored, scopes (read/write)

### Web (Next.js 14)
- Route groups: `(marketing)`, `(auth)`, `(app)`
- Middleware: nonce-based CSP, auth gate (protected: `/dashboard`, `/settings`, `/p/`, `/admin`)
- TanStack Query v5 for data fetching
- Dark-first Tailwind design system with CSS variables
- Persona accent palette: 8 colors (ceo/cto/cmo/cfo/coo/chro/cso/cdao)
- shadcn-style components (written manually, no CLI)

### Security (non-negotiable)
- zxcvbn ≥ 3 enforced server-side; dynamic import client-side (avoids 800KB bundle)
- Open redirect prevention: `startsWith('/') && !startsWith('//')`
- Email enumeration prevention: generic errors everywhere (register, forgot-pw, not-found)
- API key raw value shown ONCE; SHA-256 stored
- CSP nonce-based; `frame-ancestors 'none'`
- argon2id passwords (m=19456, t=2, p=1)

## Development mode

**Subagent-driven development** via `superpowers:subagent-driven-development`.
- Fresh implementer subagent per task
- Spec compliance review then code quality review after each task
- No pausing between tasks (continuous execution)
- **Caveman mode (full)** active — terse responses, fragments OK, no filler

## Docs index

| File | Content |
|------|---------|
| `docs/00_staged_roadmap.md` | **Governing doc** — MVP-first stages, current punch list, parking rules |
| `docs/01_architecture_and_stack.md` | System architecture, tech stack, security model |
| `docs/02_project_structure.md` | Monorepo layout, file structure, dependency rules |
| `docs/03_implementation_phases.md` | Master task list with security checklists and acceptance criteria |
| `docs/04_agent_orchestration_spec.md` | PA engine, turn policies, delegation, MCP zero-trust |
| `docs/05_data_model_and_schemas.md` | Full Postgres schema, RLS, DAG operations, WS contracts |
| `docs/06_ui_ux_spec.md` | Screen-by-screen UI spec |
| `docs/07_security_compliance.md` | STRIDE threat model, security stages A–E |
| `docs/08_agent_personas.md` | C-Suite persona roster, system prompt templates |

## Important fixes from Phase 1 (avoid repeating these bugs)

1. **Keyboard chord order**: `if (gPressed)` check MUST come before `if (e.key === 'g')` check — otherwise g+g chord is unreachable
2. **useMemo with custom hooks**: Cannot call custom hooks inside useMemo — inline the array directly
3. **cleanup**: Always `clearTimeout(timer)` before `removeEventListener` in keyboard nav useEffect
4. **Active state for nested routes**: `pathname === href || pathname.startsWith(href + '/')` (not just `===`)
5. **AnyAuthGuard**: Must throw `UnauthorizedException` (not return false) when both JWT and API key fail
6. **Open redirect**: Block both `https://evil.com` AND `//evil.com` (protocol-relative)
7. **Enumeration prevention**: Collapse specific error branches (e.g., 409 on register) to single generic catch
8. **2FA guard**: Early return rendering error + Link, not a disabled button with no feedback
9. **zxcvbn**: Dynamic import in useEffect only — never static import at module level
10. **h1→h3 heading skip**: Always include sr-only h2 for landmark sections
11. **aria-label on bare div**: Add `role="region"` to make it effective
