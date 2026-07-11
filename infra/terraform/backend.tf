# Remote state configuration.
# Values are supplied at init time via backend.tfvars:
#   terraform init -backend-config=backend.tfvars
#
# backend.tfvars supplies: bucket, key, region, dynamodb_table, kms_key_id
#
# The state bucket must be created out-of-band (bootstrap script) before
# terraform init is run. It must have:
#   - SSE-KMS encryption
#   - Versioning enabled
#   - Server-access logging enabled
#   - Block all public access
#   - DynamoDB table for state locking

# NOTE: The backend block itself cannot use variables in Terraform; all values
# come from the -backend-config file at init time. This file intentionally
# contains no literals — see envs/staging/backend.tfvars for staging values.
