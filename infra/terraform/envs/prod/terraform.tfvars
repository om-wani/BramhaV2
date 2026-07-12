# Production environment — non-secret configuration values
# Secrets are in AWS Secrets Manager; do NOT add credentials here.
#
# PLACEHOLDER VALUES — must be replaced before `terraform apply`.
# Run infra/scripts/validate-tfvars.sh to check for remaining REPLACE_WITH placeholders.
# Workflow:
#   1. Run infra/scripts/bootstrap-state-bucket.sh (prod variant) to create S3 state bucket + DynamoDB lock table.
#   2. Build and push Docker images to ECR; replace REPLACE_WITH_ECR_URI values below.
#   3. Issue/import ACM certificate; replace REPLACE_WITH_ACM_CERT_ARN.
#   4. Run: infra/scripts/validate-tfvars.sh infra/terraform/envs/prod/terraform.tfvars
#   5. terraform init -backend-config=backend.tfvars && terraform apply

environment = "prod"
aws_region  = "us-east-1"
vpc_cidr    = "10.1.0.0/16"

# 3 AZs for prod
public_subnet_cidrs      = ["10.1.0.0/24", "10.1.1.0/24", "10.1.2.0/24"]
private_app_subnet_cidrs = ["10.1.10.0/24", "10.1.11.0/24", "10.1.12.0/24"]
isolated_subnet_cidrs    = ["10.1.20.0/24", "10.1.21.0/24", "10.1.22.0/24"]

# Prod sizing — ECR image URIs updated by CI/CD pipeline on each deploy
# Format: <account_id>.dkr.ecr.<region>.amazonaws.com/<repo>:<tag>
api_image              = "REPLACE_WITH_ECR_URI/bramha-api:latest"
web_image              = "REPLACE_WITH_ECR_URI/bramha-web:latest"
agent_runtime_image    = "REPLACE_WITH_ECR_URI/bramha-agent-runtime:latest"
ingestion_worker_image = "REPLACE_WITH_ECR_URI/bramha-ingestion-worker:latest"
sandbox_host_image     = "REPLACE_WITH_ECR_URI/bramha-sandbox-host:latest"
mcp_node_image_uri     = "REPLACE_WITH_ECR_URI/bramha-mcp-node:latest"

# ACM certificate ARN for the prod domain (must be in us-east-1 for CloudFront)
acm_certificate_arn          = "REPLACE_WITH_ACM_CERT_ARN"
artifact_acm_certificate_arn = "REPLACE_WITH_ACM_CERT_ARN"

# CloudFront distribution domain aliases
web_domain_aliases      = ["bramha.ai", "www.bramha.ai"]
artifact_domain_aliases = ["artifacts.bramha.ai"]

oncall_email         = "oncall@bramha.ai"
monthly_token_budget = 5000000
