#!/usr/bin/env bash
# Run before terraform apply. Fails fast if placeholder values remain.
set -euo pipefail

TFVARS="${1:-infra/terraform/envs/staging/terraform.tfvars}"

if grep -q 'REPLACE_WITH' "${TFVARS}"; then
  echo "ERROR: Placeholder values remain in ${TFVARS}:"
  grep 'REPLACE_WITH' "${TFVARS}"
  exit 1
fi
echo "OK: no placeholder values in ${TFVARS}"
