variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "subnet_ids" {
  description = "Isolated subnet IDs for the DB subnet group"
  type        = list(string)
}

variable "api_sg_id" {
  description = "Security group ID of the API service (allowed to connect on 5432)"
  type        = string
}

variable "kms_key_id" {
  description = "KMS key ARN for RDS storage encryption"
  type        = string
}

variable "db_password_arn" {
  description = "ARN of the Secrets Manager secret holding the DB password"
  type        = string
  sensitive   = true
}

variable "db_name" {
  description = "Name of the initial database"
  type        = string
  default     = "bramha"
}

variable "db_username" {
  description = "Master DB username"
  type        = string
  default     = "bramha_admin"
}

variable "instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.medium"
}

variable "allocated_storage_gb" {
  description = "Initial allocated storage (GB)"
  type        = number
  default     = 20
}

variable "max_allocated_storage_gb" {
  description = "Maximum storage autoscaling limit (GB)"
  type        = number
  default     = 100
}

variable "backup_retention_days" {
  description = "Days to retain automated backups (enables PITR)"
  type        = number
  default     = 7
}

variable "backup_window" {
  description = "Daily backup window (UTC)"
  type        = string
  default     = "03:00-04:00"
}

variable "maintenance_window" {
  description = "Weekly maintenance window"
  type        = string
  default     = "Mon:04:00-Mon:05:00"
}

variable "deletion_protection" {
  description = "Enable deletion protection"
  type        = bool
  default     = true
}

variable "skip_final_snapshot" {
  description = "Skip final snapshot on deletion"
  type        = bool
  default     = false
}
