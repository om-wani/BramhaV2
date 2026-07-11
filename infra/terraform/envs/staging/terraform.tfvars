# Staging environment — non-secret configuration values
# Secrets are in AWS Secrets Manager; do NOT add credentials here.

environment = "staging"
aws_region  = "us-east-1"
vpc_cidr    = "10.0.0.0/16"

# ECR image URIs — updated by CI/CD pipeline on each deploy
# Format: <account_id>.dkr.ecr.<region>.amazonaws.com/<repo>:<tag>
# Replace <account_id> and <tag> before first apply.
api_image              = "REPLACE_WITH_ECR_URI/bramha-api:latest"
web_image              = "REPLACE_WITH_ECR_URI/bramha-web:latest"
agent_runtime_image    = "REPLACE_WITH_ECR_URI/bramha-agent-runtime:latest"
ingestion_worker_image = "REPLACE_WITH_ECR_URI/bramha-ingestion-worker:latest"
sandbox_host_image     = "REPLACE_WITH_ECR_URI/bramha-sandbox-host:latest"

# ACM certificate ARN for the staging domain (must be in us-east-1 for ALB)
# Create via ACM console or CLI; add DNS validation records.
acm_certificate_arn = "REPLACE_WITH_ACM_CERT_ARN"
