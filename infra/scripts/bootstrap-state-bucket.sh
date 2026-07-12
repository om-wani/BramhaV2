#!/usr/bin/env bash
# Bootstrap Terraform remote state bucket and DynamoDB lock table.
# Run ONCE before first `terraform init`.
# Usage: ENVIRONMENT=staging AWS_REGION=us-east-1 ./bootstrap-state-bucket.sh
set -euo pipefail

ENVIRONMENT="${ENVIRONMENT:-staging}"
AWS_REGION="${AWS_REGION:-us-east-1}"
BUCKET="bramha-terraform-state-${ENVIRONMENT}"
TABLE="bramha-terraform-lock-${ENVIRONMENT}"
KMS_ALIAS="alias/bramha-${ENVIRONMENT}-tfstate"

echo "Bootstrapping Terraform state for environment: ${ENVIRONMENT}"

# KMS key for state encryption
KEY_ID=$(aws kms create-key \
  --description "Terraform state encryption key - ${ENVIRONMENT}" \
  --key-usage ENCRYPT_DECRYPT \
  --query 'KeyMetadata.KeyId' --output text 2>/dev/null || \
  aws kms describe-key --key-id "${KMS_ALIAS}" --query 'KeyMetadata.KeyId' --output text)

aws kms create-alias --alias-name "${KMS_ALIAS}" --target-key-id "${KEY_ID}" 2>/dev/null || true

# S3 state bucket
aws s3api create-bucket --bucket "${BUCKET}" --region "${AWS_REGION}" \
  $( [[ "${AWS_REGION}" != "us-east-1" ]] && echo "--create-bucket-configuration LocationConstraint=${AWS_REGION}" ) || true

aws s3api put-bucket-versioning --bucket "${BUCKET}" \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption --bucket "${BUCKET}" \
  --server-side-encryption-configuration "{
    \"Rules\": [{\"ApplyServerSideEncryptionByDefault\": {
      \"SSEAlgorithm\": \"aws:kms\",
      \"KMSMasterKeyID\": \"${KEY_ID}\"
    }, \"BucketKeyEnabled\": true}]
  }"

aws s3api put-public-access-block --bucket "${BUCKET}" \
  --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Enable server access logging (log to same bucket under logs/ prefix)
aws s3api put-bucket-logging --bucket "${BUCKET}" \
  --bucket-logging-status "{
    \"LoggingEnabled\": {\"TargetBucket\": \"${BUCKET}\", \"TargetPrefix\": \"logs/\"}
  }"

# DynamoDB lock table
aws dynamodb create-table \
  --table-name "${TABLE}" \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region "${AWS_REGION}" 2>/dev/null || true

echo "Done. KMS key ID: ${KEY_ID}"
echo "Update backend.tfvars: kms_key_id = \"${KEY_ID}\""
