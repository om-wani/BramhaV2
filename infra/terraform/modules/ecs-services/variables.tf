variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnet IDs for the ALB"
  type        = list(string)
}

variable "private_app_subnet_ids" {
  description = "Private-app subnet IDs for ECS tasks"
  type        = list(string)
}

variable "isolated_subnet_ids" {
  description = "Isolated subnet IDs for sandbox-host and MCP node (no internet egress)"
  type        = list(string)
}

variable "kms_key_id" {
  description = "KMS key ARN for CloudWatch log encryption"
  type        = string
}

# ---- ECR image URIs ----

variable "api_image" {
  description = "ECR image URI for the API service"
  type        = string
}

variable "web_image" {
  description = "ECR image URI for the Web (Next.js) service"
  type        = string
}

variable "agent_runtime_image" {
  description = "ECR image URI for the agent-runtime service"
  type        = string
}

variable "ingestion_worker_image" {
  description = "ECR image URI for the ingestion-worker service"
  type        = string
}

variable "sandbox_host_image" {
  description = "ECR image URI for the sandbox-host service"
  type        = string
}

variable "mcp_node_image_uri" {
  description = "ECR image URI for the mcp-node service"
  type        = string
}

# ---- ALB / HTTPS ----

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for the ALB HTTPS listener"
  type        = string
}

# ---- Secrets ----

variable "db_password_arn" {
  description = "ARN of the DB password secret"
  type        = string
  sensitive   = true
}

variable "redis_auth_token_arn" {
  description = "ARN of the Redis AUTH token secret"
  type        = string
  sensitive   = true
}

variable "jwt_secret_arn" {
  description = "ARN of the JWT secret"
  type        = string
  sensitive   = true
}

variable "api_key_salt_arn" {
  description = "ARN of the API key salt secret"
  type        = string
  sensitive   = true
}

variable "encryption_key_arn" {
  description = "ARN of the field encryption key secret"
  type        = string
  sensitive   = true
}

variable "all_secret_arns" {
  description = "List of all secret ARNs for IAM task execution role"
  type        = list(string)
  sensitive   = true
}

# ---- S3 ----

variable "staging_bucket_arn" {
  description = "ARN of the staging S3 bucket"
  type        = string
}

variable "clean_bucket_arn" {
  description = "ARN of the clean S3 bucket"
  type        = string
}

variable "quarantine_bucket_arn" {
  description = "ARN of the quarantine S3 bucket"
  type        = string
}

variable "artifacts_bucket_arn" {
  description = "ARN of the artifacts S3 bucket"
  type        = string
}

variable "audit_export_bucket_arn" {
  description = "ARN of the audit-export S3 bucket"
  type        = string
}

variable "logs_bucket_id" {
  description = "Name (ID) of the dedicated logs S3 bucket — target for ALB access logs and S3 server access logs"
  type        = string
}

# ---- Capacity ----

variable "api_desired_count" {
  description = "Desired task count for API service"
  type        = number
  default     = 2
}

variable "web_desired_count" {
  description = "Desired task count for Web service"
  type        = number
  default     = 2
}

variable "agent_runtime_desired_count" {
  description = "Desired task count for agent-runtime service"
  type        = number
  default     = 2
}

variable "ingestion_worker_desired_count" {
  description = "Desired task count for ingestion-worker service"
  type        = number
  default     = 1
}

variable "sandbox_host_desired_count" {
  description = "Desired task count for sandbox-host service"
  type        = number
  default     = 1
}

variable "enable_autoscaling" {
  description = "Enable Application AutoScaling for ECS services (CPU-based scale-out)"
  type        = bool
  default     = true
}
