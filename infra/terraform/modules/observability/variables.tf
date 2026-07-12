###############################################################################
# Observability Module — Variables
###############################################################################

variable "name_prefix" {
  description = "Prefix applied to all resource names"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "kms_key_id" {
  description = "KMS CMK ARN for encrypting logs, Firehose, OpenSearch"
  type        = string
}

variable "audit_export_bucket_id" {
  description = "S3 audit-export bucket name (for Firehose delivery destination)"
  type        = string
}

variable "audit_export_bucket_arn" {
  description = "S3 audit-export bucket ARN (for Firehose IAM policy)"
  type        = string
}

variable "oncall_email" {
  description = "Email address for on-call alert subscriptions"
  type        = string
}

variable "pagerduty_webhook_url" {
  description = "PagerDuty HTTPS webhook URL for critical alerts (empty = disabled)"
  type        = string
  default     = ""
}

variable "monthly_token_budget" {
  description = "Monthly token budget threshold (used for budget-warn 80% and budget-critical 100% alarms)"
  type        = number
  default     = 1000000
}

variable "rds_max_connections" {
  description = "Maximum RDS connections (alarm fires when current > 80% of this)"
  type        = number
  default     = 100
}

variable "isolated_subnet_ids" {
  description = "List of isolated subnet IDs for OpenSearch VPC deployment"
  type        = list(string)
}

variable "vpc_id" {
  description = "VPC ID for OpenSearch security group"
  type        = string
}

variable "opensearch_master_password_secret_arn" {
  description = "ARN of ASM secret holding the OpenSearch fine-grained access control master password"
  type        = string
}

variable "audit_log_group_name" {
  description = "CloudWatch log group name for audit events (subscription filter source)"
  type        = string
  default     = "bramha-audit"
}
