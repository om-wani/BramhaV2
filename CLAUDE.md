# BramhaV2 — Claude Code Context

## Project

Multi-tenant SaaS AI orchestration platform. C-Suite AI council (CEO/CTO/CMO/CFO/COO/CHRO/CSO/CDAO personas) collaborate in spatial chat rooms. Non-linear conversation DAG. Secure file ingestion. Vector knowledge layer. MCP tool integration.

## Monorepo structure

```
apps/web          Next.js 14 App Router frontend
apps/api          NestJS + Fastify backend
apps/agent-runtime  LangGraph agent execution engine
apps/ingestion-worker  BullMQ file/source ingestion
packages/shared   Zod schemas, events, WS protocol, error catalog
packages/db       Drizzle ORM schema, migrations, RLS, withTenant()
packages/agents   ModelRouter, persona compiler, providers
packages/event-bus  Typed pub/sub wrapper
packages/mcp-connectors  MCP registry, client pool, policy engine
infra/            Docker Compose, Terraform
docs/             Architecture specs (01–08)
```

## Active branch

`claude/mvp-plan-simplify-1zfx9b`

## Stage status (governing plan: `docs/00_staged_roadmap.md`)

The old phase model is retired. Old Phases 1–4 are substantially **built** (migrations through
0026, ~890 tests green — see `docs/AUDIT_REPORT.md`). Work is now staged MVP-first:

- **Stage 0 — MVP/Prototype ← CURRENT.** Investor/user demo on one box. Deep-platform tracks
  (MCP, IaC, chaos, admin analytics) are **parked, not deleted** — hidden from UI, zero new
  investment, code stays green in CI.
- Stage 1 — Pilot (design partners) · Stage 2 — Productionize (paid beta) · Stage 3 — Scale.

## Current Stage-0 punch list (full detail: roadmap §5.3)

1. **M0.1** — Wire RAG into agent turns (both `searchKnowledge` stubs return `[]` — critical gap)
2. M0.2 — Demo seed (`pnpm seed:demo`: council of 5, branched conversation, ingested docs, notes)
3. M0.3 — Golden-path Playwright smoke of the demo narrative (roadmap §5.1)
4. M0.4 — Artifact pane auto-open on first stream chunk
5. M0.5 — Demo polish: hide parked nav, empty states, landing copy
6. M0.6 — Single-box deploy (compose.prod-sim + Caddy + `check-env --strict`)
7. M0.7 — Hygiene: "(temporary)" commit residue, dead deps

Nothing outside this list is Stage-0 work unless it blocks the demo narrative.

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
