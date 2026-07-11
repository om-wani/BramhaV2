###############################################################################
# Secrets Module — AWS Secrets Manager + KMS CMK
###############################################################################

locals {
  name_prefix = "bramha/${var.environment}"
}

###############################################################################
# KMS Customer Managed Key for all secrets + RDS + S3
###############################################################################

resource "aws_kms_key" "main" {
  description             = "Bramha ${var.environment} — CMK for secrets, RDS, S3, ElastiCache"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  multi_region            = false

  # Policy allows the account root and Secrets Manager service
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "Enable IAM root access"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "Allow Secrets Manager"
        Effect = "Allow"
        Principal = {
          Service = "secretsmanager.amazonaws.com"
        }
        Action = [
          "kms:GenerateDataKey",
          "kms:Decrypt",
        ]
        Resource = "*"
      },
    ]
  })

  tags = {
    Name = "bramha-${var.environment}-cmk"
  }
}

resource "aws_kms_alias" "main" {
  name          = "alias/bramha-${var.environment}"
  target_key_id = aws_kms_key.main.key_id
}

data "aws_caller_identity" "current" {}

###############################################################################
# Secrets — values are populated out-of-band (AWS Console / CI bootstrap)
# Terraform manages the secret container; the actual secret value is a placeholder.
###############################################################################

resource "aws_secretsmanager_secret" "db_password" {
  name                    = "${local.name_prefix}/db_password"
  description             = "RDS master password for Bramha ${var.environment}"
  recovery_window_in_days = 7
  kms_key_id              = aws_kms_key.main.arn

  tags = {
    Name = "bramha-${var.environment}-db-password"
  }
}

resource "aws_secretsmanager_secret_version" "db_password_placeholder" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = jsonencode({ password = "REPLACE_ME_BEFORE_APPLY" })

  # Ignore future changes so operator can rotate without Terraform reverting
  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "redis_auth_token" {
  name                    = "${local.name_prefix}/redis_auth_token"
  description             = "Redis AUTH token for Bramha ${var.environment}"
  recovery_window_in_days = 7
  kms_key_id              = aws_kms_key.main.arn

  tags = {
    Name = "bramha-${var.environment}-redis-auth-token"
  }
}

resource "aws_secretsmanager_secret_version" "redis_auth_token_placeholder" {
  secret_id     = aws_secretsmanager_secret.redis_auth_token.id
  secret_string = jsonencode({ token = "REPLACE_ME_BEFORE_APPLY" })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name                    = "${local.name_prefix}/jwt_secret"
  description             = "JWT signing secret for Bramha ${var.environment}"
  recovery_window_in_days = 7
  kms_key_id              = aws_kms_key.main.arn

  tags = {
    Name = "bramha-${var.environment}-jwt-secret"
  }
}

resource "aws_secretsmanager_secret_version" "jwt_secret_placeholder" {
  secret_id     = aws_secretsmanager_secret.jwt_secret.id
  secret_string = jsonencode({ secret = "REPLACE_ME_BEFORE_APPLY" })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "api_key_salt" {
  name                    = "${local.name_prefix}/api_key_salt"
  description             = "API key hashing salt for Bramha ${var.environment}"
  recovery_window_in_days = 7
  kms_key_id              = aws_kms_key.main.arn

  tags = {
    Name = "bramha-${var.environment}-api-key-salt"
  }
}

resource "aws_secretsmanager_secret_version" "api_key_salt_placeholder" {
  secret_id     = aws_secretsmanager_secret.api_key_salt.id
  secret_string = jsonencode({ salt = "REPLACE_ME_BEFORE_APPLY" })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "encryption_key" {
  name                    = "${local.name_prefix}/encryption_key"
  description             = "Field-level encryption key for Bramha ${var.environment}"
  recovery_window_in_days = 7
  kms_key_id              = aws_kms_key.main.arn

  tags = {
    Name = "bramha-${var.environment}-encryption-key"
  }
}

resource "aws_secretsmanager_secret_version" "encryption_key_placeholder" {
  secret_id     = aws_secretsmanager_secret.encryption_key.id
  secret_string = jsonencode({ key = "REPLACE_ME_BEFORE_APPLY" })

  lifecycle {
    ignore_changes = [secret_string]
  }
}
