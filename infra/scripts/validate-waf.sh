#!/usr/bin/env bash
# Quick WAF probe verification. Run after staging apply.
# Usage: WEB_URL=https://staging.bramha.ai ./validate-waf.sh
#
# Checks that WAF blocks SQLi and XSS payloads (expects HTTP 403)
# and passes a normal request (expects HTTP 200 or 301/302 redirect).
#
# NOTE: This only works once the staging environment is deployed and DNS
# has propagated. Blocked requests return 403 from CloudFront WAF before
# they ever reach the origin.
set -euo pipefail

WEB_URL="${WEB_URL:-https://staging.bramha.ai}"
PASS=0
FAIL=0

probe() {
  local label="$1"
  local url="$2"
  local payload="$3"
  local expected_status="$4"

  status=$(curl -s -o /dev/null -w "%{http_code}" \
    -X GET "${url}${payload}" \
    -H "User-Agent: Mozilla/5.0 (compatible; WAF-probe/1.0)" \
    --max-time 10 2>/dev/null || echo "000")

  if [[ "$status" == "$expected_status" ]]; then
    echo "PASS [$label] status=$status"
    ((PASS++))
  # Treat any 403 as a WAF block even if we expected a different 4xx
  elif [[ "$expected_status" == "403" && "$status" == "403" ]]; then
    echo "PASS [$label] status=$status (WAF blocked)"
    ((PASS++))
  else
    echo "FAIL [$label] expected=$expected_status got=$status url=${url}${payload}"
    ((FAIL++))
  fi
}

echo "=== WAF probe: $WEB_URL ==="

# SQLi probe — classic OR 1=1 pattern (URL-encoded: ' OR 1=1--)
probe "sqli-or-1eq1" "$WEB_URL" "/?id=1%27%20OR%201%3D1--" "403"

# SQLi probe — UNION SELECT pattern
probe "sqli-union"   "$WEB_URL" "/?q=1%27%20UNION%20SELECT%201%2C2%2C3--" "403"

# XSS probe — <script>alert(1)</script>
probe "xss-script"   "$WEB_URL" "/?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E" "403"

# XSS probe — onerror attribute
probe "xss-onerror"  "$WEB_URL" "/?q=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E" "403"

# Normal request — expect 200 (or a 301/302 redirect for auth gate)
status_normal=$(curl -s -o /dev/null -w "%{http_code}" \
  -X GET "${WEB_URL}/" \
  -H "User-Agent: Mozilla/5.0" \
  --max-time 10 2>/dev/null || echo "000")

if [[ "$status_normal" =~ ^(200|301|302|307|308)$ ]]; then
  echo "PASS [normal] status=$status_normal"
  ((PASS++))
else
  echo "FAIL [normal] expected=2xx/3xx got=$status_normal"
  ((FAIL++))
fi

echo ""
echo "Results: ${PASS} pass, ${FAIL} fail"
[[ $FAIL -eq 0 ]]
