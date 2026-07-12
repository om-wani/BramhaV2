###############################################################################
# Production Environment — wires all modules together
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

# WAF for CloudFront MUST reside in us-east-1 regardless of the main region.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

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

  # Prod: 3 AZs for maximum HA
  public_subnet_cidrs      = var.public_subnet_cidrs
  private_app_subnet_cidrs = var.private_app_subnet_cidrs
  isolated_subnet_cidrs    = var.isolated_subnet_cidrs

  enable_flow_logs        = true
  flow_log_retention_days = 90
  kms_key_id              = module.secrets.kms_key_arn
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

  # S3 bucket ARNs + dedicated logs bucket for ALB access logs
  staging_bucket_arn      = module.s3.staging_bucket_arn
  clean_bucket_arn        = module.s3.clean_bucket_arn
  quarantine_bucket_arn   = module.s3.quarantine_bucket_arn
  artifacts_bucket_arn    = module.s3.artifacts_bucket_arn
  audit_export_bucket_arn = module.s3.audit_export_bucket_arn
  logs_bucket_id          = module.s3.logs_bucket_id

  # Prod: 2 replicas minimum per service for HA across AZs
  api_desired_count              = 2
  web_desired_count              = 2
  agent_runtime_desired_count    = 2
  ingestion_worker_desired_count = 2
  sandbox_host_desired_count     = 2

  enable_autoscaling = true
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

  # Prod sizing
  instance_class           = "db.t4g.large"
  allocated_storage_gb     = 100
  max_allocated_storage_gb = 500

  # Prod: deletion protection on; final snapshot required; Multi-AZ enabled
  deletion_protection = true
  skip_final_snapshot = false
  multi_az            = true
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

  # Prod: 2 clusters across AZs for automatic failover
  node_type          = "cache.t4g.medium"
  num_cache_clusters = 2
}

###############################################################################
# S3
###############################################################################

module "s3" {
  source      = "../../modules/s3"
  environment = var.environment
  kms_key_id  = module.secrets.kms_key_arn

  staging_lifecycle_days      = 30
  audit_export_retention_days = 2555  # 7 years for compliance
}

###############################################################################
# Cross-module SG rules — ECS services → Redis (avoids circular module deps)
###############################################################################

resource "aws_security_group_rule" "runtime_to_redis" {
  type                     = "egress"
  description              = "Redis from agent-runtime"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  security_group_id        = module.ecs_services.runtime_sg_id
  source_security_group_id = module.elasticache.redis_sg_id
}

resource "aws_security_group_rule" "ingestion_to_redis" {
  type                     = "egress"
  description              = "Redis from ingestion-worker"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  security_group_id        = module.ecs_services.ingestion_sg_id
  source_security_group_id = module.elasticache.redis_sg_id
}

###############################################################################
# WAF — must be in us-east-1 for CloudFront
###############################################################################

module "waf" {
  source = "../../modules/waf"

  name_prefix       = "bramha-${var.environment}"
  scope             = "CLOUDFRONT"
  bot_control_block = true  # prod: block mode
  rate_limit        = 1000

  providers = {
    aws = aws.us_east_1
  }
}

###############################################################################
# CDN — web + artifact distributions with WAF, TLS 1.2+, HSTS
###############################################################################

module "cdn" {
  source = "../../modules/cdn"

  name_prefix                           = "bramha-${var.environment}"
  waf_acl_arn                           = module.waf.waf_acl_arn
  alb_dns_name                          = module.ecs_services.alb_dns_name
  artifacts_bucket_regional_domain_name = module.s3.artifacts_bucket_regional_domain_name
  artifacts_bucket_id                   = module.s3.artifacts_bucket_id
  acm_certificate_arn                   = var.acm_certificate_arn
  artifact_acm_certificate_arn          = var.artifact_acm_certificate_arn
  web_domain_aliases                    = var.web_domain_aliases
  artifact_domain_aliases               = var.artifact_domain_aliases
  web_origin                            = length(var.web_domain_aliases) > 0 ? "https://${var.web_domain_aliases[0]}" : "https://bramha.ai"
  logs_bucket_domain_name               = module.s3.logs_bucket_domain_name
}

###############################################################################
# Observability — CloudWatch dashboards/alarms, Firehose→S3 audit, OpenSearch SIEM
###############################################################################

module "observability" {
  source = "../../modules/observability"

  name_prefix                           = "bramha-${var.environment}"
  aws_region                            = var.aws_region
  kms_key_id                            = module.secrets.kms_key_arn
  audit_export_bucket_id                = module.s3.audit_export_bucket_id
  audit_export_bucket_arn               = module.s3.audit_export_bucket_arn
  oncall_email                          = var.oncall_email
  pagerduty_webhook_url                 = var.pagerduty_webhook_url
  monthly_token_budget                  = var.monthly_token_budget
  rds_max_connections                   = 200
  isolated_subnet_ids                   = module.network.isolated_subnet_ids
  vpc_id                                = module.network.vpc_id
  opensearch_master_password_secret_arn = module.secrets.opensearch_master_password_secret_arn
}

###############################################################################
# WAF spike alarm — must be in us-east-1 (CloudFront WAF metrics are published there)
###############################################################################

resource "aws_cloudwatch_metric_alarm" "waf_spike" {
  provider = aws.us_east_1

  alarm_name          = "bramha-${var.environment}-waf-spike"
  alarm_description   = "WAF blocked requests spike — potential attack"
  namespace           = "AWS/WAFV2"
  metric_name         = "BlockedRequests"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 500
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    WebACL = "bramha-${var.environment}"
    Region = "CloudFront"
    Rule   = "ALL"
  }

  alarm_actions = [module.observability.critical_sns_arn]
  ok_actions    = [module.observability.warning_sns_arn]
}

###############################################################################
# Outputs (useful for CI/CD)
###############################################################################

output "alb_dns_name" {
  description = "ALB DNS name — point your prod DNS here"
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

output "web_cloudfront_domain" {
  description = "CloudFront web distribution domain name"
  value       = module.cdn.web_domain_name
}

output "artifact_cloudfront_domain" {
  description = "CloudFront artifact distribution domain name"
  value       = module.cdn.artifact_domain_name
}

output "waf_acl_arn" {
  description = "WAF Web ACL ARN"
  value       = module.waf.waf_acl_arn
}
