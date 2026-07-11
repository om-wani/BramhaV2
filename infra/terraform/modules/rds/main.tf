###############################################################################
# RDS Module — Postgres 16, Multi-AZ, KMS, PITR
###############################################################################

locals {
  name_prefix = "bramha-${var.environment}"

  # Read secret version to get password value
  db_password = jsondecode(data.aws_secretsmanager_secret_version.db_password.secret_string)["password"]
}

data "aws_secretsmanager_secret_version" "db_password" {
  secret_id = var.db_password_arn
}

###############################################################################
# Security group — ingress from API only on 5432
###############################################################################

resource "aws_security_group" "rds" {
  name        = "${local.name_prefix}-sg-rds"
  description = "RDS Postgres — allow 5432 from API service only"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Postgres from API service"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.api_sg_id]
  }

  # No egress — RDS does not initiate outbound connections
  egress {
    description = "No outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["127.0.0.1/32"]
  }

  tags = {
    Name = "${local.name_prefix}-sg-rds"
  }
}

###############################################################################
# DB Subnet Group (isolated subnets)
###############################################################################

resource "aws_db_subnet_group" "main" {
  name        = "${local.name_prefix}-db-subnet-group"
  description = "Isolated subnets for RDS"
  subnet_ids  = var.subnet_ids

  tags = {
    Name = "${local.name_prefix}-db-subnet-group"
  }
}

###############################################################################
# Parameter Group — enforce SSL, sane defaults
###############################################################################

resource "aws_db_parameter_group" "postgres16" {
  name        = "${local.name_prefix}-pg16"
  family      = "postgres16"
  description = "Bramha ${var.environment} — Postgres 16 hardened parameters"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  parameter {
    name  = "log_checkpoints"
    value = "1"
  }

  parameter {
    name  = "log_lock_waits"
    value = "1"
  }

  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements"
    apply_method = "pending-reboot"
  }

  tags = {
    Name = "${local.name_prefix}-pg16-params"
  }
}

###############################################################################
# RDS Instance
###############################################################################

resource "aws_db_instance" "main" {
  identifier = "${local.name_prefix}-postgres"

  # Engine
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.instance_class

  # Storage
  allocated_storage     = var.allocated_storage_gb
  max_allocated_storage = var.max_allocated_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = var.kms_key_id

  # Auth
  db_name  = var.db_name
  username = var.db_username
  password = local.db_password

  # HA
  multi_az = true

  # Network
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false

  # Parameters
  parameter_group_name = aws_db_parameter_group.postgres16.name

  # Backup / PITR
  backup_retention_period = var.backup_retention_days
  backup_window           = var.backup_window
  copy_tags_to_snapshot   = true

  # Maintenance
  maintenance_window         = var.maintenance_window
  auto_minor_version_upgrade = true

  # Protection
  deletion_protection = var.deletion_protection
  skip_final_snapshot = var.skip_final_snapshot

  final_snapshot_identifier = var.skip_final_snapshot ? null : "${local.name_prefix}-final-snapshot"

  # Performance Insights
  performance_insights_enabled          = true
  performance_insights_kms_key_id       = var.kms_key_id
  performance_insights_retention_period = 7

  # Enhanced monitoring (role created inline)
  monitoring_interval = 60
  monitoring_role_arn = aws_iam_role.rds_monitoring.arn

  tags = {
    Name = "${local.name_prefix}-postgres"
  }
}

###############################################################################
# Enhanced Monitoring IAM role
###############################################################################

data "aws_iam_policy_document" "rds_monitoring_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["monitoring.rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "rds_monitoring" {
  name               = "${local.name_prefix}-rds-monitoring-role"
  assume_role_policy = data.aws_iam_policy_document.rds_monitoring_assume.json
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}
