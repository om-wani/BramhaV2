###############################################################################
# S3 Module — 5 buckets: staging, clean, quarantine, artifacts, audit-export
###############################################################################

locals {
  name_prefix = "bramha"
  env         = var.environment

  buckets = {
    staging      = "${local.name_prefix}-staging-${local.env}"
    clean        = "${local.name_prefix}-clean-${local.env}"
    quarantine   = "${local.name_prefix}-quarantine-${local.env}"
    artifacts    = "${local.name_prefix}-artifacts-${local.env}"
    audit_export = "${local.name_prefix}-audit-export-${local.env}"
  }
}

###############################################################################
# Logging bucket — receives server access logs from all other buckets
# (self-referential for simplicity; override with var.access_log_bucket_name)
###############################################################################

locals {
  log_bucket = var.access_log_bucket_name != "" ? var.access_log_bucket_name : aws_s3_bucket.audit_export.id
}

###############################################################################
# --- STAGING bucket ---
# Temporary upload landing zone; auto-deleted after 7 days
###############################################################################

resource "aws_s3_bucket" "staging" {
  bucket        = local.buckets.staging
  force_destroy = false

  tags = {
    Name    = local.buckets.staging
    Purpose = "file-upload-staging"
  }
}

resource "aws_s3_bucket_versioning" "staging" {
  bucket = aws_s3_bucket.staging.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "staging" {
  bucket = aws_s3_bucket.staging.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_id
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "staging" {
  bucket                  = aws_s3_bucket.staging.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "staging" {
  bucket = aws_s3_bucket.staging.id

  rule {
    id     = "auto-delete-after-${var.staging_lifecycle_days}-days"
    status = "Enabled"
    filter {}
    expiration {
      days = var.staging_lifecycle_days
    }
    noncurrent_version_expiration {
      noncurrent_days = var.staging_lifecycle_days
    }
  }
}

resource "aws_s3_bucket_policy" "staging" {
  bucket = aws_s3_bucket.staging.id
  policy = data.aws_iam_policy_document.deny_non_https["staging"].json
}

resource "aws_s3_bucket_logging" "staging" {
  bucket        = aws_s3_bucket.staging.id
  target_bucket = local.log_bucket
  target_prefix = "s3-access-logs/${local.buckets.staging}/"
}

###############################################################################
# --- CLEAN bucket ---
# ClamAV-cleared files safe for processing
###############################################################################

resource "aws_s3_bucket" "clean" {
  bucket        = local.buckets.clean
  force_destroy = false

  tags = {
    Name    = local.buckets.clean
    Purpose = "clamav-cleared-files"
  }
}

resource "aws_s3_bucket_versioning" "clean" {
  bucket = aws_s3_bucket.clean.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "clean" {
  bucket = aws_s3_bucket.clean.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_id
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "clean" {
  bucket                  = aws_s3_bucket.clean.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "clean" {
  bucket = aws_s3_bucket.clean.id
  policy = data.aws_iam_policy_document.deny_non_https["clean"].json
}

resource "aws_s3_bucket_logging" "clean" {
  bucket        = aws_s3_bucket.clean.id
  target_bucket = local.log_bucket
  target_prefix = "s3-access-logs/${local.buckets.clean}/"
}

###############################################################################
# --- QUARANTINE bucket ---
# Infected/suspect files — high restriction
###############################################################################

resource "aws_s3_bucket" "quarantine" {
  bucket        = local.buckets.quarantine
  force_destroy = false

  tags = {
    Name    = local.buckets.quarantine
    Purpose = "infected-file-quarantine"
  }
}

resource "aws_s3_bucket_versioning" "quarantine" {
  bucket = aws_s3_bucket.quarantine.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "quarantine" {
  bucket = aws_s3_bucket.quarantine.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_id
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "quarantine" {
  bucket                  = aws_s3_bucket.quarantine.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "quarantine" {
  bucket = aws_s3_bucket.quarantine.id
  policy = data.aws_iam_policy_document.deny_non_https["quarantine"].json
}

resource "aws_s3_bucket_logging" "quarantine" {
  bucket        = aws_s3_bucket.quarantine.id
  target_bucket = local.log_bucket
  target_prefix = "s3-access-logs/${local.buckets.quarantine}/"
}

###############################################################################
# --- ARTIFACTS bucket ---
# Agent-generated artifacts (reports, exports)
###############################################################################

resource "aws_s3_bucket" "artifacts" {
  bucket        = local.buckets.artifacts
  force_destroy = false

  tags = {
    Name    = local.buckets.artifacts
    Purpose = "agent-generated-artifacts"
  }
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_id
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  policy = data.aws_iam_policy_document.deny_non_https["artifacts"].json
}

resource "aws_s3_bucket_logging" "artifacts" {
  bucket        = aws_s3_bucket.artifacts.id
  target_bucket = local.log_bucket
  target_prefix = "s3-access-logs/${local.buckets.artifacts}/"
}

###############################################################################
# --- AUDIT EXPORT bucket ---
# Immutable audit logs: Object Lock compliance + 365-day retention
###############################################################################

resource "aws_s3_bucket" "audit_export" {
  bucket        = local.buckets.audit_export
  force_destroy = false

  object_lock_enabled = true

  tags = {
    Name    = local.buckets.audit_export
    Purpose = "audit-log-exports"
  }
}

resource "aws_s3_bucket_versioning" "audit_export" {
  # Object Lock requires versioning; it is auto-enabled and cannot be disabled.
  bucket = aws_s3_bucket.audit_export.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_object_lock_configuration" "audit_export" {
  bucket = aws_s3_bucket.audit_export.id

  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = var.audit_export_retention_days
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit_export" {
  bucket = aws_s3_bucket.audit_export.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_id
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "audit_export" {
  bucket                  = aws_s3_bucket.audit_export.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ELB service account for this region — needs s3:PutObject to write ALB access logs.
# See: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/enable-access-logging.html
# NOTE: Object Lock COMPLIANCE mode on this bucket means ELB log writes must also include
# retention headers; standard ELB logging does not supply them. Consider a separate
# non-Object-Lock bucket for ALB access logs in production if this causes write failures.
data "aws_elb_service_account" "main" {}

data "aws_iam_policy_document" "audit_export_combined" {
  source_policy_documents = [data.aws_iam_policy_document.deny_non_https["audit_export"].json]

  statement {
    sid    = "AllowELBAccessLogs"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = [data.aws_elb_service_account.main.arn]
    }
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.audit_export.arn}/alb-access-logs/*"]
  }
}

resource "aws_s3_bucket_policy" "audit_export" {
  bucket = aws_s3_bucket.audit_export.id
  policy = data.aws_iam_policy_document.audit_export_combined.json
}

# S3 server access logging for the audit-export bucket (self-referential, prefix "s3-access-logs/")
resource "aws_s3_bucket_logging" "audit_export" {
  bucket        = aws_s3_bucket.audit_export.id
  target_bucket = aws_s3_bucket.audit_export.id
  target_prefix = "s3-access-logs/"
}

###############################################################################
# Bucket policy — deny non-HTTPS access (shared template via for_each map)
###############################################################################

data "aws_iam_policy_document" "deny_non_https" {
  for_each = {
    staging      = aws_s3_bucket.staging.arn
    clean        = aws_s3_bucket.clean.arn
    quarantine   = aws_s3_bucket.quarantine.arn
    artifacts    = aws_s3_bucket.artifacts.arn
    audit_export = aws_s3_bucket.audit_export.arn
  }

  statement {
    sid    = "DenyNonHTTPS"
    effect = "Deny"
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    actions   = ["s3:*"]
    resources = ["${each.value}/*", each.value]
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}
