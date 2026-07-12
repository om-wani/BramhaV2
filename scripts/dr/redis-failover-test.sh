#!/usr/bin/env bash
# Test Redis ElastiCache failover — triggers primary failover and measures recovery time.
# STAGING ONLY.
#
# Usage: REPLICATION_GROUP_ID=bramha-staging-redis ./scripts/dr/redis-failover-test.sh
set -euo pipefail

REPLICATION_GROUP_ID="${REPLICATION_GROUP_ID:?REPLICATION_GROUP_ID required}"
MAX_RECOVERY_SECONDS=60

# Safety
if [[ "$REPLICATION_GROUP_ID" == *"prod"* ]]; then
  echo "SAFETY: refusing Redis failover test on prod"
  exit 1
fi

echo "=== Redis failover test: ${REPLICATION_GROUP_ID} ==="
START=$(date +%s)

# Record current primary before failover
PRIMARY_NODE=$(aws elasticache describe-replication-groups \
  --replication-group-id "$REPLICATION_GROUP_ID" \
  --query 'ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Address' \
  --output text)

echo "Current primary: ${PRIMARY_NODE}"
echo "Triggering primary failover..."
aws elasticache test-failover \
  --replication-group-id "$REPLICATION_GROUP_ID" \
  --node-group-id "0001"

echo "Waiting for failover to complete (max ${MAX_RECOVERY_SECONDS}s)..."
while true; do
  ELAPSED=$(( $(date +%s) - START ))
  if [[ $ELAPSED -ge $MAX_RECOVERY_SECONDS ]]; then
    echo "FAIL: Redis did not recover within ${MAX_RECOVERY_SECONDS}s"
    exit 1
  fi

  STATUS=$(aws elasticache describe-replication-groups \
    --replication-group-id "$REPLICATION_GROUP_ID" \
    --query 'ReplicationGroups[0].Status' --output text 2>/dev/null || echo "unknown")

  if [[ "$STATUS" == "available" ]]; then
    echo "PASS: Redis available after ${ELAPSED}s"
    NEW_PRIMARY=$(aws elasticache describe-replication-groups \
      --replication-group-id "$REPLICATION_GROUP_ID" \
      --query 'ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Address' \
      --output text)
    echo "New primary: ${NEW_PRIMARY}"
    exit 0
  fi

  echo "  ${ELAPSED}s: status=${STATUS}, waiting..."
  sleep 5
done
