variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "staging"
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

# ---- ECS image URIs ----

variable "api_image" {
  description = "ECR image URI for the API service"
  type        = string
}

variable "web_image" {
  description = "ECR image URI for the Web service"
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

# ---- ALB ----

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for HTTPS (ALB + web CloudFront; must be in us-east-1)"
  type        = string
}

variable "artifact_acm_certificate_arn" {
  description = "ACM certificate ARN for the artifact CloudFront distribution (must be in us-east-1)"
  type        = string
  default     = "REPLACE_WITH_ACM_CERT_ARN"
}

variable "web_domain_aliases" {
  description = "Custom domain aliases for the web CloudFront distribution"
  type        = list(string)
  default     = []
}

variable "artifact_domain_aliases" {
  description = "Custom domain aliases for the artifact CloudFront distribution (isolated origin)"
  type        = list(string)
  default     = []
}

variable "oncall_email" {
  description = "On-call email address for CloudWatch alarm SNS subscriptions"
  type        = string
  default     = "oncall@bramha.ai"
}

variable "pagerduty_webhook_url" {
  description = "PagerDuty HTTPS webhook URL for critical SNS alerts (empty = disabled)"
  type        = string
  default     = ""
}
