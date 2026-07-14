#!/usr/bin/env bash
set -euo pipefail

if [ -z "${BASH_VERSION:-}" ]; then
  echo "ERROR: this script needs bash (run './scripts/dev-up.sh', not 'sh scripts/dev-up.sh')" >&2
  exit 1
fi

if [ "$(id -u)" -eq 0 ]; then
  echo "ERROR: do not run this with sudo/as root." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$ROOT/.dev-logs"
mkdir -p "$LOG_DIR"

# Stale-group-session self-heal (see bootstrap.sh for details)
if ! docker info >/dev/null 2>&1; then
  if getent group docker | cut -d: -f4 | tr ',' '\n' | grep -qx "$(id -un)" && [ -z "${BRAMHA_SG_REEXEC:-}" ]; then
    echo "==> Docker socket not accessible in this shell (stale group session) — re-running under 'sg docker'..."
    export BRAMHA_SG_REEXEC=1
    exec sg docker -c "bash '${BASH_SOURCE[0]}'"
  fi
  echo "ERROR: cannot access the Docker daemon. If not in docker group: sudo usermod -aG docker \$USER, then log out/in." >&2
  exit 1
fi

echo "==> BramhaV2 dev-up (api + web + agent-runtime + ingestion-worker)"

if [ ! -f "$ROOT/apps/api/.env" ]; then
  echo "ERROR: apps/api/.env missing. Run ./scripts/bootstrap.sh first." >&2
  exit 1
fi

# 1. Confirm infra is up (bootstrap.sh's job — this script assumes it already ran)
if ! docker compose -f "$ROOT/infra/docker/compose.dev.yml" exec -T postgres pg_isready -U bramha_dev -d bramha_dev >/dev/null 2>&1; then
  echo "ERROR: Postgres isn't reachable. Run ./scripts/bootstrap.sh first (or 'docker compose -f infra/docker/compose.dev.yml up -d')." >&2
  exit 1
fi

# 2. Build everything (workspace packages + all four apps)
# Load shared backend env (api/.env covers DATABASE_URL, REDIS_URL, S3_*, JWT_*)
# BEFORE building: NEXT_PUBLIC_* vars are inlined into the web bundle at build
# time, so NEXT_PUBLIC_API_URL must be exported before `next build` runs — else
# api-client bakes in its production '/backend' proxy fallback and local dev
# would 404 (no BACKEND_ORIGIN rewrite exists locally).
set -a
# shellcheck disable=SC1091
source "$ROOT/apps/api/.env"
set +a

SYSTEM_USER_ID="00000000-0000-0000-0000-000000000099"
export SYSTEM_USER_ID
# Absolute localhost origin: web and api are same-site (both localhost), so
# cookies work directly with no proxy. Drives both REST (api-client) and WS
# (socket) since it's an absolute URL.
export NEXT_PUBLIC_API_URL="http://localhost:${PORT:-4000}"

echo "==> Building..."
cd "$ROOT"
pnpm --filter @bramha/shared --filter @bramha/db --filter @bramha/event-bus \
     --filter @bramha/agents --filter @bramha/mcp-connectors build
pnpm --filter @bramha/api --filter @bramha/agent-runtime --filter @bramha/ingestion-worker build
pnpm --filter @bramha/web build

kill_stale() {
  local pidfile="$1"
  if [ -f "$pidfile" ]; then
    local pid
    pid=$(cat "$pidfile")
    # PID is a setsid session leader — kill the whole process group so
    # children (next-server, etc.) die too, not just the wrapper.
    kill -9 -- "-$pid" >/dev/null 2>&1 || kill -9 "$pid" >/dev/null 2>&1 || true
    rm -f "$pidfile"
  fi
}

start_service() {
  local name="$1" cmd="$2" cwd="$3"
  kill_stale "$LOG_DIR/$name.pid"
  echo "==> Starting $name..."
  # setsid: service becomes its own session/process-group leader, so the PID
  # we record can kill the entire tree (pnpm -> next -> next-server).
  (cd "$cwd" && exec setsid bash -c "$cmd") > "$LOG_DIR/$name.log" 2>&1 &
  disown
  echo $! > "$LOG_DIR/$name.pid"
}

start_service "api"        "node dist/main.js"        "$ROOT/apps/api"
# web must NOT inherit api's PORT (Next respects $PORT and would collide with the api on :4000)
start_service "web"        "env PORT=3000 pnpm start"  "$ROOT/apps/web"
start_service "agent-runtime" "node dist/main.js"      "$ROOT/apps/agent-runtime"
start_service "ingestion-worker" "node dist/main.js"   "$ROOT/apps/ingestion-worker"

echo "==> Waiting for api and web to answer..."
for i in $(seq 1 30); do
  API_OK=0; WEB_OK=0
  curl -sf "http://127.0.0.1:${PORT:-4000}/health/live" >/dev/null 2>&1 && API_OK=1
  curl -sf "http://127.0.0.1:3000/api/health" >/dev/null 2>&1 && WEB_OK=1
  [ "$API_OK" = 1 ] && [ "$WEB_OK" = 1 ] && break
  sleep 1
done

if [ "${API_OK:-0}" != 1 ]; then
  echo "WARN: api not answering on :${PORT:-4000} yet — check $LOG_DIR/api.log"
fi
if [ "${WEB_OK:-0}" != 1 ]; then
  echo "WARN: web not answering on :3000 yet — check $LOG_DIR/web.log"
fi

echo ""
echo "✓ Dev stack running (PIDs in $LOG_DIR/*.pid, logs in $LOG_DIR/*.log)"
echo "  Web:            http://localhost:3000"
echo "  API:            http://localhost:${PORT:-4000}  (docs at /docs)"
echo "  Agent runtime:  background worker, no HTTP port — see $LOG_DIR/agent-runtime.log"
echo "  Ingestion:      background worker, no HTTP port — see $LOG_DIR/ingestion-worker.log"
echo ""
echo "  Stop everything: ./scripts/dev-down.sh"
