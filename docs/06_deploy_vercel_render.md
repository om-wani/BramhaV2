# Deploy — Vercel (web) + Render (server + Postgres), no Docker

Architecture: **first-party proxy**. The browser only ever talks to the Vercel
domain; Vercel rewrites `/backend/*` (incl. Socket.IO) to the Render server.
Auth cookies stay first-party on the Vercel domain → no third-party-cookie
blocking. Socket.IO runs over **polling** through the proxy (Vercel can't proxy
WebSocket upgrades).

```
browser ──HTTPS──> bramha.vercel.app ──/backend/* rewrite──> bramha-server.onrender.com ──> Render Postgres (pgvector)
```

Free-tier caveats: Render web spins down after ~15 min idle (~50s cold start);
Render free Postgres expires in 30 days; uploads on Render free are ephemeral
(lost on redeploy). Fine for a demo — warm the server before driving it.

---

## Order of operations

Render first (server needs a URL for Vercel's rewrite; Vercel needs a URL for
the server's APP_ORIGIN — so you set one env cross-reference after both exist).

### 1 · Render — Postgres

1. New → PostgreSQL. Name `bramha-db`, version 16, region close to you, Free.
2. Wait until it's available. Copy the **Internal Database URL** (used by the
   server in the same region).

pgvector: the first server boot runs `CREATE EXTENSION IF NOT EXISTS vector`
(migration 0001). Render Postgres 16 allows pgvector. If it errors, see
Troubleshooting.

### 2 · Render — server web service

- New → Web Service → connect this repo, branch `claude/mvp-plan-simplify-1zfx9b`.
- Root Directory: **repo root** (leave blank / `.`).
- Runtime: Node. Region: same as the DB.
- Build Command: `corepack enable && pnpm install --frozen-lockfile`
- Start Command: `pnpm --filter @bramha/server start`
- Health Check Path: `/health`
- Instance: Free (or Starter to avoid spindown).
- Environment variables:

  | Key | Value |
  |-----|-------|
  | `NODE_VERSION` | `22.13.0` |
  | `NODE_ENV` | `production` |
  | `DATABASE_URL` | *(Internal Database URL from step 1)* |
  | `APP_ORIGIN` | *(set after step 3 — the Vercel URL)* |
  | `OPENAI_API_KEY` | *(your OpenRouter `sk-or-…` key)* |
  | `OPENAI_BASE_URL` | `https://openrouter.ai/api/v1` |
  | `OPENAI_CHAT_MODEL` | `moonshotai/kimi-k2.6` |
  | `OPENAI_CHAT_MODEL_LIGHT` | `meta-llama/llama-3.3-70b-instruct` |
  | `MODEL_MAX_TOKENS` | `2000` |
  | `UPLOADS_DIR` | `/tmp/uploads` |

  (Or use the repo `render.yaml` Blueprint instead of the manual form.)

- Deploy. It boots even before `APP_ORIGIN` is set (dev fallback), but set it in
  step 4. Copy the service URL, e.g. `https://bramha-server.onrender.com`.

### 3 · Vercel — web

- New Project → import this repo.
- **Root Directory: `apps/web`** (Framework auto-detects Next.js).
- Node.js Version: 22.x (Project Settings → General).
- Environment variables:

  | Key | Value |
  |-----|-------|
  | `BACKEND_ORIGIN` | `https://bramha-server.onrender.com` *(from step 2)* |
  | `NEXT_PUBLIC_SOCKET_PATH` | `/backend/socket.io` |
  | `NEXT_PUBLIC_SOCKET_TRANSPORTS` | `polling` |

  Do **not** set `NEXT_PUBLIC_SOCKET_URL` (it must stay same-origin `/`).

- Deploy. Copy the URL, e.g. `https://bramha.vercel.app`.

### 4 · Cross-wire + seed

1. Render → server env → set `APP_ORIGIN` = the Vercel URL → save (redeploys).
2. Seed the demo account against the production DB. Easiest: Render dashboard →
   server → Shell:
   ```
   DATABASE_URL=$DATABASE_URL pnpm --filter @bramha/server seed:demo
   ```
   (DATABASE_URL is already in the service env.) Or run locally pointed at the
   **External** Database URL:
   ```
   DATABASE_URL='postgres://…external…' pnpm --filter @bramha/server seed:demo
   ```

### 5 · Verify

- Open the Vercel URL. Register a new account (or log in
  `demo@northwind.com` / `Northwind2025!` if seeded).
- Send a council message → streams (polling). Status bar shows spend.
- Run `docs/QA_PLAYBOOK.md` §1–§6.

---

## Env var reference (who needs what)

**Render (server)** — `NODE_ENV`, `DATABASE_URL`, `APP_ORIGIN`, `OPENAI_API_KEY`,
`OPENAI_BASE_URL`, `OPENAI_CHAT_MODEL`, `OPENAI_CHAT_MODEL_LIGHT`,
`MODEL_MAX_TOKENS`, `UPLOADS_DIR`. Optional: `EMBEDDING_API_KEY`,
`EMBEDDING_BASE_URL`, `EMBEDDING_MODEL`, `OPENAI_REASONING`. `PORT` is injected
by Render automatically.

**Vercel (web)** — `BACKEND_ORIGIN`, `NEXT_PUBLIC_SOCKET_PATH`,
`NEXT_PUBLIC_SOCKET_TRANSPORTS`.

Secrets (`OPENAI_API_KEY`, `DATABASE_URL`) live only in the dashboards, never in
git. `.env` is gitignored.

---

## Troubleshooting (CLI)

Render CLI is installed (`render`). Vercel CLI: `pnpm add -g vercel` (or
`npm i -g vercel`).

- **`pnpm install` fails on engines (@swc-node)**: builder Node must be
  22.13+ (or 24+). Ensure `NODE_VERSION=22.13.0` on Render / Node 22.x on
  Vercel. Emergency override: append `--config.engine-strict=false` to the
  install command.
- **Server: "APP_ORIGIN must be set in production"**: set it (step 4).
- **`CREATE EXTENSION vector` denied**: Render → Postgres → confirm pgvector is
  enabled for the instance; retrigger a deploy so migrations rerun.
- **Socket stuck / no live updates**: confirm `NEXT_PUBLIC_SOCKET_TRANSPORTS=polling`
  and `NEXT_PUBLIC_SOCKET_PATH=/backend/socket.io` on Vercel, and that
  `NEXT_PUBLIC_SOCKET_URL` is unset. Check the Network tab for
  `/backend/socket.io/?EIO=4&transport=polling` → 200.
- **401 after login / cookie missing**: requests must go through the Vercel
  `/backend` proxy (first-party). Confirm `BACKEND_ORIGIN` points at the Render
  URL and there is no direct cross-origin call.
- **Logs**: `render logs -r <service-id> --tail` · `vercel logs <deployment-url>`.
- **Cold start**: free Render web sleeps; first request after idle takes ~50s.
  Hit the URL once to warm it before demoing, or upgrade to Starter.
