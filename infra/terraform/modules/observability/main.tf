###############################################################################
# Observability Module — CloudWatch dashboards/alarms, SNS, Firehose, OpenSearch
###############################################################################

data "aws_caller_identity" "current" {}

###############################################################################
# SNS Topics — on-call routing
###############################################################################

resource "aws_sns_topic" "critical" {
  name              = "${var.name_prefix}-alerts-critical"
  kms_master_key_id = var.kms_key_id

  tags = {
    Name = "${var.name_prefix}-alerts-critical"
  }
}

resource "aws_sns_topic" "warning" {
  name              = "${var.name_prefix}-alerts-warning"
  kms_master_key_id = var.kms_key_id

  tags = {
    Name = "${var.name_prefix}-alerts-warning"
  }
}

###############################################################################
# SNS Subscriptions — email (always) + PagerDuty webhook (when configured)
###############################################################################

resource "aws_sns_topic_subscription" "critical_email" {
  topic_arn = aws_sns_topic.critical.arn
  protocol  = "email"
  endpoint  = var.oncall_email
}

resource "aws_sns_topic_subscription" "warning_email" {
  topic_arn = aws_sns_topic.warning.arn
  protocol  = "email"
  endpoint  = var.oncall_email
}

resource "aws_sns_topic_subscription" "critical_pagerduty" {
  count = var.pagerduty_webhook_url != "" ? 1 : 0

  topic_arn = aws_sns_topic.critical.arn
  protocol  = "https"
  endpoint  = var.pagerduty_webhook_url
}

###############################################################################
# CloudWatch Alarms
###############################################################################

# ---- Auth anomaly ----
resource "aws_cloudwatch_metric_alarm" "auth_anomaly" {
  alarm_name          = "${var.name_prefix}-auth-anomaly"
  alarm_description   = "More than 20 failed login attempts in 5 minutes"
  namespace           = "BramhaAuth"
  metric_name         = "FailedLogins"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 20
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.critical.arn]
  ok_actions    = [aws_sns_topic.critical.arn]

  tags = {
    Name = "${var.name_prefix}-auth-anomaly"
  }
}

# ---- Budget warn (80%) ----
resource "aws_cloudwatch_metric_alarm" "budget_warn" {
  alarm_name          = "${var.name_prefix}-budget-warn"
  alarm_description   = "Token spend has reached 80% of monthly budget"
  namespace           = "BramhaBilling"
  metric_name         = "TokenSpend"
  statistic           = "Sum"
  period              = 3600  # 1 hour rolling check
  evaluation_periods  = 1
  threshold           = floor(var.monthly_token_budget * 0.8)
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.warning.arn]
  ok_actions    = [aws_sns_topic.warning.arn]

  tags = {
    Name = "${var.name_prefix}-budget-warn"
  }
}

# ---- Budget critical (100%) ----
resource "aws_cloudwatch_metric_alarm" "budget_critical" {
  alarm_name          = "${var.name_prefix}-budget-critical"
  alarm_description   = "Token spend has reached 100% of monthly budget"
  namespace           = "BramhaBilling"
  metric_name         = "TokenSpend"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = var.monthly_token_budget
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.critical.arn]
  ok_actions    = [aws_sns_topic.critical.arn]

  tags = {
    Name = "${var.name_prefix}-budget-critical"
  }
}

# ---- DLQ growth ----
# Only created when dlq_queue_name is provided (BullMQ DLQ name comes from app provisioning).
resource "aws_cloudwatch_metric_alarm" "dlq_growth" {
  count = var.dlq_queue_name != "" ? 1 : 0

  alarm_name          = "${var.name_prefix}-dlq-growth"
  alarm_description   = "More than 10 messages visible in a Dead Letter Queue"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 10
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = var.dlq_queue_name
  }

  alarm_actions = [aws_sns_topic.warning.arn]
  ok_actions    = [aws_sns_topic.warning.arn]

  tags = {
    Name = "${var.name_prefix}-dlq-growth"
  }
}

# ---- Egress denials ----
resource "aws_cloudwatch_metric_alarm" "egress_denials" {
  alarm_name          = "${var.name_prefix}-egress-denials"
  alarm_description   = "More than 5 egress-denied requests in 5 minutes"
  namespace           = "BramhaSecurity"
  metric_name         = "EgressDenied"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.critical.arn]
  ok_actions    = [aws_sns_topic.critical.arn]

  tags = {
    Name = "${var.name_prefix}-egress-denials"
  }
}

# WAF spike alarm intentionally excluded — CloudFront WAF metrics are in us-east-1;
# create separately in staging/main.tf using aws.us_east_1 provider.

# ---- RDS connections ----
resource "aws_cloudwatch_metric_alarm" "rds_connections" {
  alarm_name          = "${var.name_prefix}-rds-connections"
  alarm_description   = "RDS database connections exceed 80% of max"
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = floor(var.rds_max_connections * 0.8)
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.warning.arn]
  ok_actions    = [aws_sns_topic.warning.arn]

  tags = {
    Name = "${var.name_prefix}-rds-connections"
  }
}

# ---- ClamAV down ----
resource "aws_cloudwatch_metric_alarm" "clamav_down" {
  alarm_name          = "${var.name_prefix}-clamav-down"
  alarm_description   = "ClamAV service reported as down (ingestion worker metric)"
  namespace           = "BramhaSecurity"
  metric_name         = "ClamAVDown"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.critical.arn]
  ok_actions    = [aws_sns_topic.critical.arn]

  tags = {
    Name = "${var.name_prefix}-clamav-down"
  }
}

###############################################################################
# CloudWatch Dashboards
###############################################################################

resource "aws_cloudwatch_dashboard" "overview" {
  dashboard_name = "${var.name_prefix}-overview"

  dashboard_body = jsonencode({
    widgets = [
      # ---- SQS queue depth ----
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "SQS Queue Depth"
          view   = "timeSeries"
          period = 60
          stat   = "Maximum"
          metrics = [
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", { label = "Queue Depth" }]
          ]
          yAxis = { left = { min = 0 } }
        }
      },
      # ---- ECS CPU ----
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "ECS CPU Utilization"
          view   = "timeSeries"
          period = 60
          stat   = "Average"
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ClusterName", "bramha-${var.name_prefix}", { label = "CPU %" }]
          ]
          yAxis = { left = { min = 0, max = 100 } }
        }
      },
      # ---- ECS Memory ----
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "ECS Memory Utilization"
          view   = "timeSeries"
          period = 60
          stat   = "Average"
          metrics = [
            ["AWS/ECS", "MemoryUtilization", "ClusterName", "bramha-${var.name_prefix}", { label = "Memory %" }]
          ]
          yAxis = { left = { min = 0, max = 100 } }
        }
      },
      # ---- RDS connections ----
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "RDS Database Connections"
          view   = "timeSeries"
          period = 60
          stat   = "Maximum"
          metrics = [
            ["AWS/RDS", "DatabaseConnections", { label = "Connections" }]
          ]
          yAxis = { left = { min = 0 } }
        }
      },
      # ---- ALB request count ----
      {
        type   = "metric"
        x      = 0
        y      = 12
        width  = 12
        height = 6
        properties = {
          title  = "ALB Request Count"
          view   = "timeSeries"
          period = 60
          stat   = "Sum"
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", { label = "Requests" }]
          ]
          yAxis = { left = { min = 0 } }
        }
      },
      # ---- ALB 5xx errors ----
      {
        type   = "metric"
        x      = 12
        y      = 12
        width  = 12
        height = 6
        properties = {
          title  = "ALB 5xx Error Count"
          view   = "timeSeries"
          period = 60
          stat   = "Sum"
          metrics = [
            ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", { label = "5xx Errors" }]
          ]
          yAxis = { left = { min = 0 } }
        }
      },
      # ---- ElastiCache cache hits ----
      {
        type   = "metric"
        x      = 0
        y      = 18
        width  = 12
        height = 6
        properties = {
          title  = "ElastiCache Cache Hit Rate"
          view   = "timeSeries"
          period = 60
          stat   = "Average"
          metrics = [
            ["AWS/ElastiCache", "CacheHits", { label = "Cache Hits" }],
            ["AWS/ElastiCache", "CacheMisses", { label = "Cache Misses" }]
          ]
          yAxis = { left = { min = 0 } }
        }
      },
    ]
  })
}

resource "aws_cloudwatch_dashboard" "agent_turns" {
  dashboard_name = "${var.name_prefix}-agent-turns"

  dashboard_body = jsonencode({
    widgets = [
      # ---- First-token latency ----
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "First-Token Latency (ms)"
          view   = "timeSeries"
          period = 60
          stat   = "p99"
          metrics = [
            ["BramhaTurns", "FirstTokenLatency", { label = "p99 Latency (ms)" }],
            ["BramhaTurns", "FirstTokenLatency", { label = "p50 Latency (ms)", stat = "p50" }]
          ]
          yAxis = { left = { min = 0 } }
        }
      },
      # ---- Token spend rate ----
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title  = "Token Spend Rate (tokens/min)"
          view   = "timeSeries"
          period = 60
          stat   = "Sum"
          metrics = [
            ["BramhaTurns", "TokensPerMinute", { label = "Tokens/min" }]
          ]
          yAxis = { left = { min = 0 } }
        }
      },
      # ---- Active sandbox containers ----
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "Active Sandbox Containers"
          view   = "timeSeries"
          period = 60
          stat   = "Maximum"
          metrics = [
            ["BramhaSandbox", "ActiveContainers", { label = "Active Containers" }]
          ]
          yAxis = { left = { min = 0 } }
        }
      },
      # ---- Budget spend ----
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "Cumulative Token Spend vs Budget"
          view   = "timeSeries"
          period = 3600
          stat   = "Sum"
          metrics = [
            ["BramhaBilling", "TokenSpend", { label = "Token Spend" }]
          ]
          annotations = {
            horizontal = [
              {
                label = "80% budget"
                value = floor(var.monthly_token_budget * 0.8)
                color = "#ff7f0e"
              },
              {
                label = "100% budget"
                value = var.monthly_token_budget
                color = "#d62728"
              }
            ]
          }
          yAxis = { left = { min = 0 } }
        }
      },
    ]
  })
}

###############################################################################
# Kinesis Firehose — audit stream → S3
###############################################################################

resource "aws_iam_role" "firehose" {
  name = "${var.name_prefix}-firehose-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "firehose.amazonaws.com"
      }
      Action = "sts:AssumeRole"
      Condition = {
        StringEquals = {
          "sts:ExternalId" = data.aws_caller_identity.current.account_id
        }
      }
    }]
  })

  tags = {
    Name = "${var.name_prefix}-firehose-role"
  }
}

resource "aws_iam_role_policy" "firehose_s3" {
  name = "${var.name_prefix}-firehose-s3-policy"
  role = aws_iam_role.firehose.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3PutAuditPrefix"
        Effect = "Allow"
        Action = ["s3:PutObject"]
        Resource = "${var.audit_export_bucket_arn}/firehose/*"
      },
      {
        Sid    = "S3GetBucketLocation"
        Effect = "Allow"
        Action = ["s3:GetBucketLocation", "s3:ListBucket"]
        Resource = var.audit_export_bucket_arn
      },
      {
        Sid    = "KMSEncrypt"
        Effect = "Allow"
        Action = [
          "kms:GenerateDataKey",
          "kms:Decrypt",
        ]
        Resource = var.kms_key_id
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:PutLogEvents",
          "logs:CreateLogStream",
        ]
        Resource = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/kinesisfirehose/${var.name_prefix}-audit:*"
      },
    ]
  })
}

resource "aws_cloudwatch_log_group" "firehose" {
  name              = "/aws/kinesisfirehose/${var.name_prefix}-audit"
  retention_in_days = 30
  kms_key_id        = var.kms_key_id

  tags = {
    Name = "${var.name_prefix}-firehose-audit"
  }
}

resource "aws_cloudwatch_log_stream" "firehose_s3" {
  name           = "S3Delivery"
  log_group_name = aws_cloudwatch_log_group.firehose.name
}

resource "aws_kinesis_firehose_delivery_stream" "audit" {
  name        = "${var.name_prefix}-audit"
  destination = "extended_s3"

  extended_s3_configuration {
    role_arn            = aws_iam_role.firehose.arn
    bucket_arn          = var.audit_export_bucket_arn
    prefix              = "firehose/audit/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/"
    error_output_prefix = "firehose/errors/!{firehose:error-output-type}/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/"
    buffering_size      = 5    # MB
    buffering_interval  = 60   # seconds
    compression_format  = "GZIP"

    s3_backup_mode = "Disabled"

    cloudwatch_logging_options {
      enabled         = true
      log_group_name  = aws_cloudwatch_log_group.firehose.name
      log_stream_name = aws_cloudwatch_log_stream.firehose_s3.name
    }
  }

  server_side_encryption {
    enabled  = true
    key_type = "CUSTOMER_MANAGED_CMK"
    key_arn  = var.kms_key_id
  }

  tags = {
    Name = "${var.name_prefix}-audit"
  }
}

###############################################################################
# IAM role — CloudWatch Logs can write to Firehose (subscription filter)
###############################################################################

resource "aws_iam_role" "cloudwatch_to_firehose" {
  name = "${var.name_prefix}-cw-to-firehose-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "logs.${var.aws_region}.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })

  tags = {
    Name = "${var.name_prefix}-cw-to-firehose-role"
  }
}

resource "aws_iam_role_policy" "cloudwatch_to_firehose" {
  name = "${var.name_prefix}-cw-to-firehose-policy"
  role = aws_iam_role.cloudwatch_to_firehose.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["firehose:PutRecord", "firehose:PutRecordBatch"]
      Resource = aws_kinesis_firehose_delivery_stream.audit.arn
    }]
  })
}

###############################################################################
# CloudWatch Log Subscription Filter — audit log group → Firehose
###############################################################################

resource "aws_cloudwatch_log_subscription_filter" "audit_to_firehose" {
  name            = "${var.name_prefix}-audit-to-firehose"
  log_group_name  = var.audit_log_group_name
  filter_pattern  = ""  # all events
  destination_arn = aws_kinesis_firehose_delivery_stream.audit.arn
  role_arn        = aws_iam_role.cloudwatch_to_firehose.arn

  depends_on = [aws_kinesis_firehose_delivery_stream.audit]
}

###############################################################################
# OpenSearch — SIEM domain (VPC, encryption, fine-grained access control)
###############################################################################

resource "aws_security_group" "opensearch" {
  name        = "${var.name_prefix}-opensearch-sg"
  description = "OpenSearch SIEM — allow HTTPS from VPC only"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTPS from VPC"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.name_prefix}-opensearch-sg"
  }
}

data "aws_secretsmanager_secret_version" "opensearch_master_password" {
  secret_id = var.opensearch_master_password_secret_arn
}

resource "aws_opensearch_domain" "siem" {
  domain_name    = "${var.name_prefix}-siem"
  engine_version = "OpenSearch_2.13"

  cluster_config {
    instance_type  = "t3.small.search"
    instance_count = 1
  }

  ebs_options {
    ebs_enabled = true
    volume_type = "gp3"
    volume_size = 20
  }

  encrypt_at_rest {
    enabled    = true
    kms_key_id = var.kms_key_id
  }

  node_to_node_encryption {
    enabled = true
  }

  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-2019-07"
  }

  advanced_security_options {
    enabled                        = true
    anonymous_auth_enabled         = false
    internal_user_database_enabled = true

    master_user_options {
      master_user_name     = "bramha-admin"
      master_user_password = jsondecode(data.aws_secretsmanager_secret_version.opensearch_master_password.secret_string)["password"]
    }
  }

  vpc_options {
    subnet_ids         = [var.isolated_subnet_ids[0]]
    security_group_ids = [aws_security_group.opensearch.id]
  }

  access_policies = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
      Action    = "es:*"
      Resource  = "arn:aws:es:${var.aws_region}:${data.aws_caller_identity.current.account_id}:domain/${var.name_prefix}-siem/*"
    }]
  })

  snapshot_options {
    automated_snapshot_start_hour = 3  # 03:00 UTC daily
  }

  log_publishing_options {
    cloudwatch_log_group_arn = aws_cloudwatch_log_group.opensearch_index_slow.arn
    log_type                 = "INDEX_SLOW_LOGS"
  }

  log_publishing_options {
    cloudwatch_log_group_arn = aws_cloudwatch_log_group.opensearch_search_slow.arn
    log_type                 = "SEARCH_SLOW_LOGS"
  }

  log_publishing_options {
    cloudwatch_log_group_arn = aws_cloudwatch_log_group.opensearch_es_application.arn
    log_type                 = "ES_APPLICATION_LOGS"
  }

  tags = {
    Name = "${var.name_prefix}-siem"
  }
}

resource "aws_cloudwatch_log_group" "opensearch_index_slow" {
  name              = "/aws/opensearch/${var.name_prefix}-siem/index-slow"
  retention_in_days = 7
  kms_key_id        = var.kms_key_id

  tags = {
    Name = "${var.name_prefix}-opensearch-index-slow"
  }
}

resource "aws_cloudwatch_log_group" "opensearch_search_slow" {
  name              = "/aws/opensearch/${var.name_prefix}-siem/search-slow"
  retention_in_days = 7
  kms_key_id        = var.kms_key_id

  tags = {
    Name = "${var.name_prefix}-opensearch-search-slow"
  }
}

resource "aws_cloudwatch_log_group" "opensearch_es_application" {
  name              = "/aws/opensearch/${var.name_prefix}-siem/es-application"
  retention_in_days = 7
  kms_key_id        = var.kms_key_id

  tags = {
    Name = "${var.name_prefix}-opensearch-es-application"
  }
}

# ── AZ failure detection — ECS zero-task alarm ────────────────────────────────
resource "aws_cloudwatch_metric_alarm" "ecs_unhealthy_tasks" {
  alarm_name          = "${var.name_prefix}-ecs-unhealthy-tasks"
  alarm_description   = "ECS service has zero running tasks in at least one service — possible AZ failure"
  namespace           = "AWS/ECS"
  metric_name         = "RunningTaskCount"
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"

  alarm_actions = [aws_sns_topic.critical.arn]
  ok_actions    = [aws_sns_topic.warning.arn]

  tags = {
    Name = "${var.name_prefix}-ecs-unhealthy-tasks"
  }
}

# Resource-based policy so OpenSearch service can write to these log groups
resource "aws_cloudwatch_log_resource_policy" "opensearch" {
  policy_name = "${var.name_prefix}-opensearch-log-policy"

  policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "es.amazonaws.com"
      }
      Action = [
        "logs:PutLogEvents",
        "logs:CreateLogStream",
      ]
      Resource = [
        "${aws_cloudwatch_log_group.opensearch_index_slow.arn}:*",
        "${aws_cloudwatch_log_group.opensearch_search_slow.arn}:*",
        "${aws_cloudwatch_log_group.opensearch_es_application.arn}:*",
      ]
    }]
  })
}
