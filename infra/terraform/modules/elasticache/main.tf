###############################################################################
# ElastiCache Module — Redis 7, TLS, AUTH, isolated subnet
###############################################################################

locals {
  name_prefix = "bramha-${var.environment}"
  auth_token  = jsondecode(data.aws_secretsmanager_secret_version.redis_auth.secret_string)["token"]
}

data "aws_secretsmanager_secret_version" "redis_auth" {
  secret_id = var.redis_auth_token_arn
}

###############################################################################
# Security group — ingress from API + runtime + ingestion on 6379
###############################################################################

resource "aws_security_group" "redis" {
  name        = "${local.name_prefix}-sg-redis"
  description = "ElastiCache Redis — allow 6379 from API, runtime, ingestion"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Redis from API service"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [var.api_sg_id]
  }

  ingress {
    description     = "Redis from agent-runtime"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [var.runtime_sg_id]
  }

  ingress {
    description     = "Redis from ingestion-worker"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [var.ingestion_sg_id]
  }

  # No egress — Redis does not initiate connections
  egress {
    description = "No outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["127.0.0.1/32"]
  }

  tags = {
    Name = "${local.name_prefix}-sg-redis"
  }
}

###############################################################################
# ElastiCache subnet group
###############################################################################

resource "aws_elasticache_subnet_group" "main" {
  name        = "${local.name_prefix}-redis-subnet-group"
  description = "Isolated subnets for Redis"
  subnet_ids  = var.subnet_ids

  tags = {
    Name = "${local.name_prefix}-redis-subnet-group"
  }
}

###############################################################################
# ElastiCache parameter group
###############################################################################

resource "aws_elasticache_parameter_group" "redis7" {
  name        = "${local.name_prefix}-redis7"
  family      = "redis7"
  description = "Bramha ${var.environment} — Redis 7 hardened parameters"

  parameter {
    name  = "maxmemory-policy"
    value = "allkeys-lru"
  }

  parameter {
    name  = "timeout"
    value = "300"
  }

  tags = {
    Name = "${local.name_prefix}-redis7-params"
  }
}

###############################################################################
# Replication group (Redis 7, TLS, AUTH, multi-AZ)
###############################################################################

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "${local.name_prefix}-redis"
  description          = "Bramha ${var.environment} Redis cluster"

  # Engine
  engine         = "redis"
  engine_version = var.engine_version
  node_type      = var.node_type

  # Cluster mode disabled — single shard with replica(s)
  num_cache_clusters = var.num_cache_clusters

  # Security
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = local.auth_token
  kms_key_id                 = var.kms_key_id

  # Network
  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  # HA
  automatic_failover_enabled = var.num_cache_clusters > 1 ? true : false
  multi_az_enabled           = var.num_cache_clusters > 1 ? true : false

  # Parameters
  parameter_group_name = aws_elasticache_parameter_group.redis7.name

  # Maintenance / backups
  snapshot_retention_limit = var.snapshot_retention_limit
  snapshot_window          = var.snapshot_window
  maintenance_window       = var.maintenance_window

  # Protection
  apply_immediately          = false
  auto_minor_version_upgrade = true

  tags = {
    Name = "${local.name_prefix}-redis"
  }
}
