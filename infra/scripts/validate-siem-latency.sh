#!/usr/bin/env bash
# Synthetic SIEM latency assertion — verifies audit events reach OpenSearch < 30s.
# Usage: OPENSEARCH_ENDPOINT=https://... OPENSEARCH_USER=master OPENSEARCH_PASS=... ./validate-siem-latency.sh
set -euo pipefail

ENDPOINT="${OPENSEARCH_ENDPOINT:?OPENSEARCH_ENDPOINT required}"
OPENSEARCH_USER="${OPENSEARCH_USER:-master}"
OPENSEARCH_PASS="${OPENSEARCH_PASS:?OPENSEARCH_PASS required}"
MAX_LATENCY_SECONDS=30
POLL_INTERVAL=3
SYNTHETIC_ID="siem-latency-probe-$(date +%s)"

echo "=== SIEM latency probe: ${SYNTHETIC_ID} ==="
echo "Injecting synthetic audit event into Firehose..."

# Inject synthetic event (JSON audit record)
EVENT_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
aws firehose put-record \
  --delivery-stream-name "${FIREHOSE_STREAM_NAME:?FIREHOSE_STREAM_NAME required}" \
  --record "{\"Data\":\"$(echo "{\"event_type\":\"siem_latency_probe\",\"synthetic_id\":\"${SYNTHETIC_ID}\",\"ts\":\"${EVENT_TS}\"}" | base64 -w0)\"}"

echo "Event injected at ${EVENT_TS}. Polling OpenSearch for up to ${MAX_LATENCY_SECONDS}s..."

START=$(date +%s)
FOUND=false

while true; do
  NOW=$(date +%s)
  ELAPSED=$((NOW - START))

  if [[ $ELAPSED -ge $MAX_LATENCY_SECONDS ]]; then
    echo "FAIL: synthetic event not found in OpenSearch after ${MAX_LATENCY_SECONDS}s"
    exit 1
  fi

  # Query OpenSearch for the synthetic event
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -u "${OPENSEARCH_USER}:${OPENSEARCH_PASS}" \
    "${ENDPOINT}/bramha-audit-*/_search" \
    -H "Content-Type: application/json" \
    -d "{\"query\":{\"term\":{\"synthetic_id.keyword\":\"${SYNTHETIC_ID}\"}}}" \
    --max-time 5 2>/dev/null || echo "000")

  HITS=$(curl -s \
    -u "${OPENSEARCH_USER}:${OPENSEARCH_PASS}" \
    "${ENDPOINT}/bramha-audit-*/_search" \
    -H "Content-Type: application/json" \
    -d "{\"query\":{\"term\":{\"synthetic_id.keyword\":\"${SYNTHETIC_ID}\"}}}" \
    --max-time 5 2>/dev/null | jq -r '.hits.total.value // 0' 2>/dev/null || echo "0")

  if [[ "$HITS" -gt 0 ]]; then
    LATENCY=$((NOW - START))
    echo "PASS: synthetic event found in OpenSearch after ${LATENCY}s (< ${MAX_LATENCY_SECONDS}s limit)"
    FOUND=true
    break
  fi

  echo "  ${ELAPSED}s: not yet indexed, retrying in ${POLL_INTERVAL}s..."
  sleep $POLL_INTERVAL
done

[[ "$FOUND" == "true" ]]
