variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "subnet_ids" {
  description = "Isolated subnet IDs for the ElastiCache subnet group"
  type        = list(string)
}

variable "api_sg_id" {
  description = "Security group ID of the API service"
  type        = string
}

variable "runtime_sg_id" {
  description = "Security group ID of the agent-runtime service"
  type        = string
}

variable "ingestion_sg_id" {
  description = "Security group ID of the ingestion-worker service"
  type        = string
}

variable "kms_key_id" {
  description = "KMS key ARN for ElastiCache at-rest encryption"
  type        = string
}

variable "redis_auth_token_arn" {
  description = "ARN of the Secrets Manager secret holding the Redis AUTH token"
  type        = string
  sensitive   = true
}

variable "node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t4g.small"
}

variable "num_cache_clusters" {
  description = "Number of cache clusters (1 primary + N replicas)"
  type        = number
  default     = 2
}

variable "engine_version" {
  description = "Redis engine version"
  type        = string
  default     = "7.2"
}

variable "snapshot_retention_limit" {
  description = "Number of daily snapshots to retain"
  type        = number
  default     = 3
}

variable "snapshot_window" {
  description = "Daily snapshot window"
  type        = string
  default     = "02:00-03:00"
}

variable "maintenance_window" {
  description = "Weekly maintenance window"
  type        = string
  default     = "mon:04:00-mon:05:00"
}
