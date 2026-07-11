variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "kms_key_id" {
  description = "KMS key ARN for S3 server-side encryption"
  type        = string
}

variable "staging_lifecycle_days" {
  description = "Days before objects in staging bucket are deleted"
  type        = number
  default     = 7
}

variable "audit_export_retention_days" {
  description = "Object Lock compliance retention period for audit export bucket (days)"
  type        = number
  default     = 365
}

variable "access_log_bucket_name" {
  description = "Name of the bucket to receive S3 server access logs (must exist separately)"
  type        = string
  default     = ""
  # When empty, access logging is configured but points to the audit-export bucket itself.
  # For production, provide a dedicated logging bucket.
}
