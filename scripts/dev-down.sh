#!/usr/bin/env bash
set -euo pipefail

if [ -z "${BASH_VERSION:-}" ]; then
  echo "ERROR: this script needs bash" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/../.dev-logs"

for name in api web agent-runtime ingestion-worker; do
  pidfile="$LOG_DIR/$name.pid"
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    if kill -9 "$pid" >/dev/null 2>&1; then
      echo "stopped $name (pid $pid)"
    fi
    rm -f "$pidfile"
  fi
done
