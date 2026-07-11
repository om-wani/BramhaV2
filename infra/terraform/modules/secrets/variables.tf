variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "kms_key_id" {
  description = "KMS key ID for encrypting secrets (ARN or alias)"
  type        = string
  default     = null # When null, uses the default AWS managed key for Secrets Manager
}
