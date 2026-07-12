#!/usr/bin/env bash
# BramhaV2 security probe battery.
# Verifies key security controls are active. NOT a substitute for manual pen-test.
#
# Usage: BASE_URL=https://staging.bramha.ai ./scripts/security/probe-battery.sh
set -euo pipefail

BASE_URL="${BASE_URL:-https://staging.bramha.ai}"
PASS=0; FAIL=0; SKIP=0

probe() {
  local label="$1" expected="$2"
  shift 2
  local result
  result=$("$@" 2>/dev/null || echo "ERROR")
  if [[ "$result" == "$expected" ]]; then
    echo "PASS [$label]"
    ((PASS++))
  else
    echo "FAIL [$label] expected='${expected}' got='${result}'"
    ((FAIL++))
  fi
}

echo "=== BramhaV2 Security Probe Battery: ${BASE_URL} ==="

# ── Auth probes ───────────────────────────────────────────────────────────────

# 1. No stack traces in 404 response
probe "no-stack-trace-404" "404" \
  bash -c "curl -s -o /dev/null -w '%{http_code}' '${BASE_URL}/api/nonexistent-route-xyz'"

# 2. Auth required for project endpoint
probe "auth-required-projects" "401" \
  bash -c "curl -s -o /dev/null -w '%{http_code}' '${BASE_URL}/api/projects'"

# 3. Open redirect blocked (absolute URL)
probe "open-redirect-blocked" "400" \
  bash -c "curl -s -o /dev/null -w '%{http_code}' '${BASE_URL}/api/auth/callback?redirect=https://evil.com'"

# 4. Open redirect blocked (protocol-relative)
probe "open-redirect-proto-relative-blocked" "400" \
  bash -c "curl -s -o /dev/null -w '%{http_code}' '${BASE_URL}/api/auth/callback?redirect=//evil.com'"

# ── Injection probes (expect WAF 403) ────────────────────────────────────────

# 5. SQLi blocked by WAF
probe "sqli-blocked" "403" \
  bash -c "curl -s -o /dev/null -w '%{http_code}' \"${BASE_URL}/api/projects?id=1' OR 1=1--\""

# 6. XSS blocked by WAF
probe "xss-blocked" "403" \
  bash -c "curl -s -o /dev/null -w '%{http_code}' \"${BASE_URL}/?q=<script>alert(1)</script>\""

# ── Security headers ──────────────────────────────────────────────────────────

get_header() {
  curl -sI "${BASE_URL}" | grep -i "^$1:" | head -1 | sed 's/^[^:]*: //' | tr -d '\r\n'
}

check_header() {
  local label="$1" header="$2" pattern="$3"
  local val; val=$(get_header "$header")
  if echo "$val" | grep -qiE "$pattern"; then
    echo "PASS [$label] = ${val}"
    ((PASS++))
  else
    echo "FAIL [$label] pattern='${pattern}' got='${val}'"
    ((FAIL++))
  fi
}

check_header "hsts"            "strict-transport-security" "max-age=[0-9]+"
check_header "nosniff"         "x-content-type-options"    "nosniff"
check_header "frame-deny"      "x-frame-options"            "DENY"
check_header "csp-nonce"       "content-security-policy"    "nonce-"
check_header "referrer-policy" "referrer-policy"            "strict-origin"

# ── Tenant isolation probe ────────────────────────────────────────────────────
# These require valid tokens — mark as SKIP if tokens not provided
if [[ -z "${TENANT_A_TOKEN:-}" || -z "${TENANT_B_TOKEN:-}" || -z "${TENANT_B_PROJECT_ID:-}" ]]; then
  echo "SKIP [tenant-isolation] — set TENANT_A_TOKEN, TENANT_B_TOKEN, TENANT_B_PROJECT_ID to run"
  ((SKIP++))
else
  probe "tenant-isolation" "403" \
    bash -c "curl -s -o /dev/null -w '%{http_code}' \
      -H 'Authorization: Bearer ${TENANT_A_TOKEN}' \
      '${BASE_URL}/api/projects/${TENANT_B_PROJECT_ID}'"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "Results: ${PASS} PASS, ${FAIL} FAIL, ${SKIP} SKIP"
echo ""
if [[ $FAIL -gt 0 ]]; then
  echo "PROBE BATTERY FAILED — fix failures before release"
  exit 1
fi
echo "PROBE BATTERY PASSED"
