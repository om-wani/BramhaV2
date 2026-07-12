#!/usr/bin/env bash
# BramhaV2 game-day: runs all DR drills in sequence.
# Usage: CLUSTER=bramha-staging AZ=us-east-1a REPLICATION_GROUP_ID=bramha-staging-redis ./scripts/dr/game-day.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=============================="
echo "BramhaV2 DR Game Day"
echo "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "=============================="

PASS=0; FAIL=0

run_drill() {
  local name="$1"; shift
  echo ""
  echo "--- Drill: ${name} ---"
  if "$@"; then
    echo "PASS: ${name}"
    ((PASS++))
  else
    echo "FAIL: ${name}"
    ((FAIL++))
  fi
}

run_drill "AZ Kill Test" "${SCRIPT_DIR}/kill-az-tasks.sh"
run_drill "Redis Failover" "${SCRIPT_DIR}/redis-failover-test.sh"
# RDS restore drill is long-running — run separately in CI cron
echo ""
echo "Note: RDS restore drill runs separately via weekly CI cron (rds-restore-drill.sh)"
echo ""
echo "=============================="
echo "Game Day Results: ${PASS} PASS, ${FAIL} FAIL"
echo "Completed: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "=============================="

[[ $FAIL -eq 0 ]]
