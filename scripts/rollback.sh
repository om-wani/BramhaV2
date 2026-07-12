#!/usr/bin/env bash
# One-command rollback: restores all ECS services to the previous task definition revision.
#
# Usage:
#   ENVIRONMENT=staging ./scripts/rollback.sh
#   ENVIRONMENT=prod    ./scripts/rollback.sh
#
# Prerequisites: AWS CLI authenticated with a role that has ecs:DescribeServices,
#   ecs:DescribeTaskDefinition, ecs:RegisterTaskDefinition, ecs:UpdateService,
#   ecs:DescribeServices, and ecs:WaitServicesStable on the target cluster/services.
set -euo pipefail

ENV="${ENVIRONMENT:-staging}"
CLUSTER="bramha-${ENV}"
SERVICES=(api web agent-runtime ingestion-worker)

echo "Rolling back ${CLUSTER} ECS services to previous task definition revisions..."
echo ""

for svc in "${SERVICES[@]}"; do
  SERVICE_NAME="bramha-${ENV}-${svc}"

  # Fetch current deployments list
  DEPLOYMENTS=$(aws ecs describe-services \
    --cluster "$CLUSTER" \
    --services "$SERVICE_NAME" \
    --query 'services[0].deployments' \
    --output json)

  # Get the ARN currently running as PRIMARY
  PRIMARY_ARN=$(echo "$DEPLOYMENTS" | jq -r '.[] | select(.status == "PRIMARY") | .taskDefinition')

  if [[ -z "$PRIMARY_ARN" || "$PRIMARY_ARN" == "null" ]]; then
    echo "  [SKIP] $SERVICE_NAME: could not determine PRIMARY task definition"
    continue
  fi

  # Derive previous revision number (current - 1)
  CURRENT_REV=$(echo "$PRIMARY_ARN" | grep -oE '[0-9]+$')
  PREV_REV=$((CURRENT_REV - 1))

  if [[ "$PREV_REV" -lt 1 ]]; then
    echo "  [SKIP] $SERVICE_NAME: already at revision 1, no previous revision to roll back to"
    continue
  fi

  PREV_ARN="${PRIMARY_ARN%:*}:${PREV_REV}"

  echo "  $SERVICE_NAME: ${CURRENT_REV} → ${PREV_REV}  ($PREV_ARN)"
  aws ecs update-service \
    --cluster "$CLUSTER" \
    --service "$SERVICE_NAME" \
    --task-definition "$PREV_ARN" \
    --query 'service.serviceName' \
    --output text
done

echo ""
echo "Waiting for all services to stabilize (this may take a few minutes)..."
for svc in "${SERVICES[@]}"; do
  SERVICE_NAME="bramha-${ENV}-${svc}"
  echo "  Waiting on $SERVICE_NAME ..."
  aws ecs wait services-stable \
    --cluster "$CLUSTER" \
    --services "$SERVICE_NAME"
done

echo ""
echo "Rollback complete for ${CLUSTER}."
