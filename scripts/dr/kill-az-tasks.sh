#!/usr/bin/env bash
# Kill all ECS tasks in one AZ to test self-healing.
# Tests that surviving AZ tasks handle load within 5 minutes.
# STAGING ONLY — refuses to run against prod cluster.
#
# Usage: CLUSTER=bramha-staging AZ=us-east-1a ./scripts/dr/kill-az-tasks.sh
set -euo pipefail

CLUSTER="${CLUSTER:?CLUSTER required}"
AZ="${AZ:?AZ required}"
SERVICES=(api web agent-runtime ingestion-worker)
HEALTH_URL="${HEALTH_URL:-https://staging.bramha.ai/api/health}"

# Safety guard
if [[ "$CLUSTER" == *"prod"* ]]; then
  echo "SAFETY: refusing to run AZ kill test against prod cluster"
  exit 1
fi

echo "=== AZ kill test: cluster=${CLUSTER} az=${AZ} ==="
echo "Finding tasks in ${AZ}..."

KILLED=0
for svc in "${SERVICES[@]}"; do
  # List tasks in service
  TASK_ARNS=$(aws ecs list-tasks \
    --cluster "$CLUSTER" \
    --service-name "${CLUSTER}-${svc}" \
    --query 'taskArns' --output json 2>/dev/null || echo '[]')

  for task_arn in $(echo "$TASK_ARNS" | jq -r '.[]'); do
    # Get task AZ
    TASK_AZ=$(aws ecs describe-tasks \
      --cluster "$CLUSTER" --tasks "$task_arn" \
      --query 'tasks[0].attributes[?name==`ecs.availability-zone`].value' \
      --output text 2>/dev/null || echo "")

    if [[ "$TASK_AZ" == "$AZ" ]]; then
      echo "  Stopping task ${task_arn} (service: ${svc}, AZ: ${TASK_AZ})"
      aws ecs stop-task --cluster "$CLUSTER" --task "$task_arn" \
        --reason "DR drill: AZ kill test $(date -u +%Y-%m-%dT%H:%M:%SZ)" > /dev/null
      ((KILLED++))
    fi
  done
done

echo "Killed ${KILLED} task(s) in ${AZ}."
echo "Waiting for self-heal (max 300s)..."

START=$(date +%s)
while true; do
  ELAPSED=$(( $(date +%s) - START ))
  if [[ $ELAPSED -ge 300 ]]; then
    echo "FAIL: service did not self-heal within 5 minutes"
    exit 1
  fi

  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" --max-time 5 || echo "000")
  if [[ "$STATUS" == "200" ]]; then
    echo "PASS: health check returned 200 after ${ELAPSED}s — self-heal verified"
    exit 0
  fi
  echo "  ${ELAPSED}s: status=${STATUS}, waiting..."
  sleep 10
done
