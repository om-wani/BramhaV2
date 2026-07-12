###############################################################################
# Staging Environment — wires all modules together
###############################################################################

terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "bramha"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

###############################################################################
# Secrets + KMS (must come first — other modules reference KMS key + secret ARNs)
###############################################################################

module "secrets" {
  source      = "../../modules/secrets"
  environment = var.environment
}

###############################################################################
# Network
###############################################################################

module "network" {
  source      = "../../modules/network"
  environment = var.environment
  aws_region  = var.aws_region
  vpc_cidr    = var.vpc_cidr

  # Staging: 2 AZs, /24 per tier
  public_subnet_cidrs      = ["10.0.0.0/24", "10.0.1.0/24"]
  private_app_subnet_cidrs = ["10.0.10.0/24", "10.0.11.0/24"]
  isolated_subnet_cidrs    = ["10.0.20.0/24", "10.0.21.0/24"]

  enable_flow_logs        = true
  flow_log_retention_days = 30
}

###############################################################################
# ECS Services (needed before RDS/ElastiCache — provides api_sg_id, etc.)
###############################################################################

module "ecs_services" {
  source      = "../../modules/ecs-services"
  environment = var.environment
  aws_region  = var.aws_region

  vpc_id                 = module.network.vpc_id
  public_subnet_ids      = module.network.public_subnet_ids
  private_app_subnet_ids = module.network.private_app_subnet_ids
  isolated_subnet_ids    = module.network.isolated_subnet_ids
  kms_key_id             = module.secrets.kms_key_arn

  # ECR images — set in terraform.tfvars or CI pipeline
  api_image              = var.api_image
  web_image              = var.web_image
  agent_runtime_image    = var.agent_runtime_image
  ingestion_worker_image = var.ingestion_worker_image
  sandbox_host_image     = var.sandbox_host_image
  mcp_node_image_uri     = var.mcp_node_image_uri

  acm_certificate_arn = var.acm_certificate_arn

  # Secrets
  db_password_arn      = module.secrets.db_password_arn
  redis_auth_token_arn = module.secrets.redis_auth_token_arn
  jwt_secret_arn       = module.secrets.jwt_secret_arn
  api_key_salt_arn     = module.secrets.api_key_salt_arn
  encryption_key_arn   = module.secrets.encryption_key_arn
  all_secret_arns      = module.secrets.all_secret_arns

  # S3 bucket ARNs + bucket name for ALB access logs
  staging_bucket_arn      = module.s3.staging_bucket_arn
  clean_bucket_arn        = module.s3.clean_bucket_arn
  quarantine_bucket_arn   = module.s3.quarantine_bucket_arn
  artifacts_bucket_arn    = module.s3.artifacts_bucket_arn
  audit_export_bucket_arn = module.s3.audit_export_bucket_arn
  audit_export_bucket_id  = module.s3.audit_export_bucket_id

  # Staging: 1 replica each (cost-optimised)
  api_desired_count             = 1
  web_desired_count             = 1
  agent_runtime_desired_count   = 1
  ingestion_worker_desired_count = 1
  sandbox_host_desired_count    = 1
}

###############################################################################
# RDS
###############################################################################

module "rds" {
  source      = "../../modules/rds"
  environment = var.environment

  vpc_id     = module.network.vpc_id
  subnet_ids = module.network.isolated_subnet_ids
  api_sg_id  = module.ecs_services.api_sg_id

  kms_key_id      = module.secrets.kms_key_arn
  db_password_arn = module.secrets.db_password_arn

  # Staging sizing
  instance_class           = "db.t4g.medium"
  allocated_storage_gb     = 20
  max_allocated_storage_gb = 50

  # Staging: disable deletion protection and allow skipping final snapshot
  # for easier tear-down. Override in production.
  deletion_protection = false
  skip_final_snapshot = true
}

###############################################################################
# ElastiCache
###############################################################################

module "elasticache" {
  source      = "../../modules/elasticache"
  environment = var.environment

  vpc_id     = module.network.vpc_id
  subnet_ids = module.network.isolated_subnet_ids

  api_sg_id       = module.ecs_services.api_sg_id
  runtime_sg_id   = module.ecs_services.runtime_sg_id
  ingestion_sg_id = module.ecs_services.ingestion_sg_id

  kms_key_id           = module.secrets.kms_key_arn
  redis_auth_token_arn = module.secrets.redis_auth_token_arn

  # Staging: single replica (cost-optimised)
  node_type          = "cache.t4g.small"
  num_cache_clusters = 2
}

###############################################################################
# S3
###############################################################################

module "s3" {
  source      = "../../modules/s3"
  environment = var.environment
  kms_key_id  = module.secrets.kms_key_arn

  staging_lifecycle_days      = 7
  audit_export_retention_days = 365
}

###############################################################################
# Outputs (useful for CI/CD)
###############################################################################

output "alb_dns_name" {
  description = "ALB DNS name — point your staging DNS here"
  value       = module.ecs_services.alb_dns_name
}

output "rds_host" {
  description = "RDS hostname"
  value       = module.rds.db_host
  sensitive   = true
}

output "redis_primary_endpoint" {
  description = "Redis primary endpoint"
  value       = module.elasticache.redis_primary_endpoint
  sensitive   = true
}

output "kms_key_arn" {
  description = "KMS CMK ARN"
  value       = module.secrets.kms_key_arn
}

output "staging_bucket" {
  description = "S3 staging bucket name"
  value       = module.s3.staging_bucket_id
}

output "artifacts_bucket" {
  description = "S3 artifacts bucket name"
  value       = module.s3.artifacts_bucket_id
}
