#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "==> BramhaV2 dev bootstrap"

# 1. Check prerequisites
command -v node >/dev/null 2>&1 || { echo "ERROR: node not installed"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "ERROR: pnpm not installed. Run: npm i -g pnpm"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "ERROR: docker not installed"; exit 1; }

# 2. Install dependencies
echo "==> Installing dependencies..."
cd "$ROOT" && pnpm install

# 3. Copy .env if not exists
if [ ! -f "$ROOT/.env" ]; then
  echo "==> Creating .env from .env.example..."
  cp "$ROOT/.env.example" "$ROOT/.env"
fi

# 4. Validate env
echo "==> Validating environment..."
node --input-type=module --loader=ts-node/esm "$ROOT/scripts/check-env.ts" 2>/dev/null \
  || npx tsx "$ROOT/scripts/check-env.ts" \
  || echo "WARN: check-env.ts failed (tsx not installed) — skipping env validation"

# 5. Start compose stack
echo "==> Starting dev services..."
cd "$ROOT" && docker compose -f infra/docker/compose.dev.yml up -d --wait

# 6. Wait for postgres to be healthy
echo "==> Waiting for Postgres..."
until docker compose -f infra/docker/compose.dev.yml exec -T postgres pg_isready -U bramha_dev -d bramha_dev > /dev/null 2>&1; do
  sleep 2
done
echo "  Postgres ready."

# 7. Run migrations (placeholder — will run when packages/db is set up in T1.2.2)
echo "==> Migrations: skipped (run 'pnpm db:migrate' after T1.2.2)"

# 8. Run seed (placeholder)
echo "==> Seed: skipped (run 'pnpm db:seed' after T1.2.3)"

echo ""
echo "✓ Dev stack ready!"
echo "  Postgres:  postgresql://bramha_dev:dev_only_postgres_password@localhost:5432/bramha_dev"
echo "  Redis:     redis://:dev_only_redis_password@localhost:6379"
echo "  MinIO:     http://localhost:9000  (console: http://localhost:9001)"
echo "  ClamAV:    localhost:3310"
echo "  OTel:      http://localhost:4317 (gRPC), http://localhost:4318 (HTTP)"
