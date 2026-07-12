variable "environment" {
  description = "Deployment environment (staging, production)"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "List of availability zones to use (minimum 2)"
  type        = list(string)
  default     = []
  # When empty, the module uses data sources to pick the first 2 AZs in the region
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets (one per AZ)"
  type        = list(string)
  default     = ["10.0.0.0/24", "10.0.1.0/24"]
}

variable "private_app_subnet_cidrs" {
  description = "CIDR blocks for private-app subnets (one per AZ)"
  type        = list(string)
  default     = ["10.0.10.0/24", "10.0.11.0/24"]
}

variable "isolated_subnet_cidrs" {
  description = "CIDR blocks for isolated subnets — RDS/Redis/MCP (one per AZ)"
  type        = list(string)
  default     = ["10.0.20.0/24", "10.0.21.0/24"]
}

variable "enable_flow_logs" {
  description = "Enable VPC flow logs to CloudWatch"
  type        = bool
  default     = true
}

variable "flow_log_retention_days" {
  description = "CloudWatch log retention for VPC flow logs (days)"
  type        = number
  default     = 30
}

variable "kms_key_id" {
  description = "KMS key ARN for CloudWatch log group encryption (flow logs). Requires the KMS key policy to allow logs.amazonaws.com."
  type        = string
  default     = null
}
