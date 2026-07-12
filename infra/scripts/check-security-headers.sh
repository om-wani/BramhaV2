#!/usr/bin/env bash
# Security headers verification — Mozilla Observatory Grade A equivalent.
# Run after staging deploy to verify CloudFront response headers policy is live.
#
# Usage:
#   URL=https://staging.bramha.ai ./check-security-headers.sh
#   URL=https://artifacts-staging.bramha.ai ARTIFACT=true ./check-security-headers.sh
#
# Exit code: 0 = all headers pass, 1 = at least one failure.
set -euo pipefail

URL="${URL:-https://staging.bramha.ai}"
ARTIFACT="${ARTIFACT:-false}"
PASS=0
FAIL=0

# Fetch headers once (follow redirects, inspect final response)
HEADERS=$(curl -sIL --max-time 15 "${URL}" 2>/dev/null)

check_header() {
  local header="$1"
  local expected_pattern="$2"
  local value

  value=$(printf '%s' "$HEADERS" | grep -i "^${header}:" | head -1 \
    | sed 's/^[^:]*: //' | tr -d '\r\n')

  if echo "$value" | grep -qiE "${expected_pattern}"; then
    echo "PASS [${header}] = ${value}"
    ((PASS++))
  else
    echo "FAIL [${header}] expected=/${expected_pattern}/ got='${value}'"
    ((FAIL++))
  fi
}

echo "=== Security headers: $URL ==="

if [[ "$ARTIFACT" == "true" ]]; then
  # ---- Artifact distribution headers ----
  echo "[mode: artifact distribution]"
  check_header "x-content-type-options"  "nosniff"
  check_header "x-frame-options"         "DENY"
  check_header "content-security-policy" "default-src 'none'"
  check_header "cache-control"           "no-store"
else
  # ---- Web distribution headers (Mozilla Observatory Grade A) ----
  echo "[mode: web distribution]"
  check_header "strict-transport-security" "max-age=3[0-9]{7}"
  check_header "strict-transport-security" "includeSubDomains"
  check_header "strict-transport-security" "preload"
  check_header "x-content-type-options"    "nosniff"
  check_header "x-frame-options"           "DENY"
  check_header "x-xss-protection"          "1"
  check_header "referrer-policy"           "strict-origin"
fi

echo ""
echo "Results: ${PASS} pass, ${FAIL} fail"
[[ $FAIL -eq 0 ]]
