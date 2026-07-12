###############################################################################
# ECS Services Module — Cluster, ALB, Task defs, IAM, Security groups
# Services: api, web, agent-runtime, ingestion-worker, sandbox-host
###############################################################################

locals {
  name_prefix = "bramha-${var.environment}"
  account_id  = data.aws_caller_identity.current.account_id
}

data "aws_caller_identity" "current" {}

###############################################################################
# CloudWatch log group (all services write here, namespace by service)
###############################################################################

resource "aws_cloudwatch_log_group" "ecs" {
  name              = "/ecs/${local.name_prefix}"
  retention_in_days = 30
  kms_key_id        = var.kms_key_id

  tags = {
    Name = "${local.name_prefix}-ecs-logs"
  }
}

###############################################################################
# ECS Cluster
###############################################################################

resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name = "${local.name_prefix}-cluster"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    base              = 1
    weight            = 100
    capacity_provider = "FARGATE"
  }
}

###############################################################################
# IAM — Task Execution Role (shared; pulls images + reads secrets + logs)
###############################################################################

resource "aws_iam_role" "task_execution" {
  name = "${local.name_prefix}-ecs-task-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = {
    Name = "${local.name_prefix}-ecs-task-execution-role"
  }
}

resource "aws_iam_role_policy_attachment" "task_execution_ecr" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "task_execution_secrets" {
  name = "${local.name_prefix}-task-execution-secrets"
  role = aws_iam_role.task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = var.all_secret_arns
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = [var.kms_key_id]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = ["${aws_cloudwatch_log_group.ecs.arn}:*"]
      },
    ]
  })
}

###############################################################################
# IAM — Per-service task roles (least-privilege S3 + scoped secrets)
###############################################################################

# Helper: create a task role
resource "aws_iam_role" "task_roles" {
  for_each = toset(["api", "web", "agent-runtime", "ingestion-worker", "sandbox-host", "mcp-node"])

  name = "${local.name_prefix}-ecs-task-${each.key}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = {
    Name    = "${local.name_prefix}-ecs-task-${each.key}-role"
    Service = each.key
  }
}

# API task role — RW on clean + artifacts + audit, read secrets
resource "aws_iam_role_policy" "api_task" {
  name = "${local.name_prefix}-api-task-policy"
  role = aws_iam_role.task_roles["api"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3CleanRead"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:HeadObject"]
        Resource = [
          "${var.clean_bucket_arn}/*",
        ]
      },
      {
        Sid    = "S3ArtifactsRW"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:HeadObject"]
        Resource = ["${var.artifacts_bucket_arn}/*"]
      },
      {
        Sid    = "S3StagingPresigned"
        Effect = "Allow"
        Action = ["s3:PutObject", "s3:GetObject"]
        Resource = ["${var.staging_bucket_arn}/*"]
      },
      {
        Sid    = "S3AuditWrite"
        Effect = "Allow"
        Action = ["s3:PutObject"]
        Resource = ["${var.audit_export_bucket_arn}/*"]
      },
      {
        Sid    = "SecretsRead"
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = [
          var.db_password_arn,
          var.redis_auth_token_arn,
          var.jwt_secret_arn,
          var.api_key_salt_arn,
          var.encryption_key_arn,
        ]
      },
      {
        Sid      = "KMSDecrypt"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = [var.kms_key_id]
      },
    ]
  })
}

# Web task role — read artifacts only
resource "aws_iam_role_policy" "web_task" {
  name = "${local.name_prefix}-web-task-policy"
  role = aws_iam_role.task_roles["web"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3ArtifactsRead"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:HeadObject"]
        Resource = ["${var.artifacts_bucket_arn}/*"]
      },
      {
        Sid      = "KMSDecrypt"
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = [var.kms_key_id]
      },
    ]
  })
}

# Agent-runtime task role — read clean files + write artifacts
resource "aws_iam_role_policy" "agent_runtime_task" {
  name = "${local.name_prefix}-agent-runtime-task-policy"
  role = aws_iam_role.task_roles["agent-runtime"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3CleanRead"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:HeadObject"]
        Resource = ["${var.clean_bucket_arn}/*"]
      },
      {
        Sid    = "S3ArtifactsWrite"
        Effect = "Allow"
        Action = ["s3:PutObject", "s3:GetObject"]
        Resource = ["${var.artifacts_bucket_arn}/*"]
      },
      {
        Sid    = "SecretsRead"
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = [var.redis_auth_token_arn, var.encryption_key_arn]
      },
      {
        Sid      = "KMSDecrypt"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = [var.kms_key_id]
      },
    ]
  })
}

# Ingestion-worker task role — RW on staging + write clean/quarantine
resource "aws_iam_role_policy" "ingestion_worker_task" {
  name = "${local.name_prefix}-ingestion-worker-task-policy"
  role = aws_iam_role.task_roles["ingestion-worker"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3StagingRW"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:HeadObject"]
        Resource = ["${var.staging_bucket_arn}/*"]
      },
      {
        Sid    = "S3CleanWrite"
        Effect = "Allow"
        Action = ["s3:PutObject"]
        Resource = ["${var.clean_bucket_arn}/*"]
      },
      {
        Sid    = "S3QuarantineWrite"
        Effect = "Allow"
        Action = ["s3:PutObject"]
        Resource = ["${var.quarantine_bucket_arn}/*"]
      },
      {
        Sid    = "SecretsRead"
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = [var.redis_auth_token_arn]
      },
      {
        Sid      = "KMSDecrypt"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = [var.kms_key_id]
      },
    ]
  })
}

# MCP-node task role — CloudWatch logs only; no S3 or secret access
resource "aws_iam_role_policy" "mcp_node_task" {
  name = "${local.name_prefix}-mcp-node-task-policy"
  role = aws_iam_role.task_roles["mcp-node"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "CloudWatchLogsWrite"
        Effect = "Allow"
        Action = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = ["${aws_cloudwatch_log_group.ecs.arn}:*"]
      },
    ]
  })
}

# Sandbox-host task role — minimal; no S3 or secret access
resource "aws_iam_role_policy" "sandbox_host_task" {
  name = "${local.name_prefix}-sandbox-host-task-policy"
  role = aws_iam_role.task_roles["sandbox-host"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "CloudWatchLogsWrite"
        Effect = "Allow"
        Action = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = ["${aws_cloudwatch_log_group.ecs.arn}:*"]
      },
    ]
  })
}

###############################################################################
# Security Groups
###############################################################################

# ALB — accept 80 + 443 from internet
resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-sg-alb"
  description = "ALB — internet-facing HTTP/HTTPS"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTPS from internet"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTP from internet (redirected to HTTPS)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Forward to ECS tasks"
    from_port   = 0
    to_port     = 65535
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }

  tags = {
    Name = "${local.name_prefix}-sg-alb"
  }
}

# API service — accept from ALB on 3000
resource "aws_security_group" "api" {
  name        = "${local.name_prefix}-sg-api"
  description = "API service — accept 3000 from ALB"
  vpc_id      = var.vpc_id

  ingress {
    description     = "API port from ALB"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "All outbound (NAT to internet + VPC endpoints)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-sg-api"
  }
}

# Web service — accept from ALB on 3001
resource "aws_security_group" "web" {
  name        = "${local.name_prefix}-sg-web"
  description = "Web service — accept 3001 from ALB"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Web port from ALB"
    from_port       = 3001
    to_port         = 3001
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "All outbound (NAT to internet + VPC endpoints)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-sg-web"
  }
}

# Agent-runtime — no ALB ingress; communicates via Redis
resource "aws_security_group" "agent_runtime" {
  name        = "${local.name_prefix}-sg-agent-runtime"
  description = "Agent-runtime — no inbound; HTTPS egress to LLM APIs + explicit Redis/MCP rules"
  vpc_id      = var.vpc_id

  # TODO T5.3: replace 443/0.0.0.0/0 with FQDN allowlist via Network Firewall
  egress {
    description = "HTTPS to LLM APIs and AWS services via NAT"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-sg-agent-runtime"
  }
}

# Ingestion-worker — no ALB ingress; S3 via endpoint + Redis
resource "aws_security_group" "ingestion_worker" {
  name        = "${local.name_prefix}-sg-ingestion-worker"
  description = "Ingestion-worker — no inbound; HTTPS egress for AV scanning APIs + explicit Redis rule"
  vpc_id      = var.vpc_id

  # TODO T5.3: replace 443/0.0.0.0/0 with FQDN allowlist via Network Firewall
  egress {
    description = "HTTPS to AV scanning APIs and AWS services via NAT"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-sg-ingestion-worker"
  }
}

# MCP node — accept from agent-runtime on 8801 only; egress open (reaches external MCP endpoints)
# TODO T5.3: FQDN allowlist for LLM API egress via AWS Network Firewall
resource "aws_security_group" "mcp" {
  name        = "${local.name_prefix}-sg-mcp-node"
  description = "MCP node — accept 8801 from agent-runtime; egress open for external MCP endpoints"
  vpc_id      = var.vpc_id

  ingress {
    description     = "MCP port from agent-runtime"
    from_port       = 8801
    to_port         = 8801
    protocol        = "tcp"
    security_groups = [aws_security_group.agent_runtime.id]
  }

  egress {
    description = "All outbound (reaches external MCP endpoints)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-sg-mcp-node"
  }
}

# Explicit egress rule: agent-runtime → mcp-node on 8801
resource "aws_security_group_rule" "runtime_to_mcp" {
  type                     = "egress"
  description              = "MCP node port from agent-runtime"
  from_port                = 8801
  to_port                  = 8801
  protocol                 = "tcp"
  security_group_id        = aws_security_group.agent_runtime.id
  source_security_group_id = aws_security_group.mcp.id
}

# Sandbox-host — accept from API on 4200
resource "aws_security_group" "sandbox_host" {
  name        = "${local.name_prefix}-sg-sandbox-host"
  description = "Sandbox-host — accept 4200 from API only"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Sandbox port from API"
    from_port       = 4200
    to_port         = 4200
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
  }

  egress {
    description = "Loopback only (sandbox must not call out)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["127.0.0.1/32"]
  }

  tags = {
    Name = "${local.name_prefix}-sg-sandbox-host"
  }
}

###############################################################################
# Application Load Balancer
###############################################################################

resource "aws_lb" "main" {
  name               = "${local.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection = true

  # ALB access logs — ELB service account needs s3:PutObject on the dedicated logs bucket.
  # See modules/s3/main.tf (aws_s3_bucket_policy.logs + data.logs_combined) for bucket policy.
  # AWS docs: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/enable-access-logging.html
  access_logs {
    bucket  = var.logs_bucket_id
    prefix  = "alb-access-logs"
    enabled = true
  }

  tags = {
    Name = "${local.name_prefix}-alb"
  }
}

# HTTP → HTTPS redirect listener
resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# HTTPS listener
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

# Route /app/* → web service
resource "aws_lb_listener_rule" "web" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  condition {
    path_pattern {
      values = ["/app/*", "/app"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

###############################################################################
# Target Groups
###############################################################################

resource "aws_lb_target_group" "api" {
  name        = "${local.name_prefix}-tg-api"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    matcher             = "200"
  }

  deregistration_delay = 30

  tags = {
    Name = "${local.name_prefix}-tg-api"
  }
}

resource "aws_lb_target_group" "web" {
  name        = "${local.name_prefix}-tg-web"
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/api/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    matcher             = "200"
  }

  deregistration_delay = 30

  tags = {
    Name = "${local.name_prefix}-tg-web"
  }
}

###############################################################################
# Task Definitions
###############################################################################

locals {
  log_config = {
    logDriver = "awslogs"
    options = {
      awslogs-group         = aws_cloudwatch_log_group.ecs.name
      awslogs-region        = var.aws_region
      awslogs-stream-prefix = "ecs"
    }
  }
}

# ---- API ----
resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name_prefix}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task_roles["api"].arn

  container_definitions = jsonencode([{
    name      = "api"
    image     = var.api_image
    essential = true

    portMappings = [{
      containerPort = 3000
      protocol      = "tcp"
    }]

    environment = [
      { name = "NODE_ENV", value = var.environment },
      { name = "PORT", value = "3000" },
    ]

    secrets = [
      { name = "DB_PASSWORD", valueFrom = var.db_password_arn },
      { name = "REDIS_AUTH_TOKEN", valueFrom = var.redis_auth_token_arn },
      { name = "JWT_SECRET", valueFrom = var.jwt_secret_arn },
      { name = "API_KEY_SALT", valueFrom = var.api_key_salt_arn },
      { name = "ENCRYPTION_KEY", valueFrom = var.encryption_key_arn },
    ]

    logConfiguration = local.log_config

    readonlyRootFilesystem = true

    healthCheck = {
      command     = ["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 60
    }
  }])

  tags = {
    Name = "${local.name_prefix}-api-task-def"
  }
}

# ---- Web (Next.js) ----
resource "aws_ecs_task_definition" "web" {
  family                   = "${local.name_prefix}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task_roles["web"].arn

  container_definitions = jsonencode([{
    name      = "web"
    image     = var.web_image
    essential = true

    portMappings = [{
      containerPort = 3001
      protocol      = "tcp"
    }]

    environment = [
      { name = "NODE_ENV", value = var.environment },
      { name = "PORT", value = "3001" },
    ]

    secrets = [
      { name = "JWT_SECRET", valueFrom = var.jwt_secret_arn },
    ]

    logConfiguration = local.log_config

    readonlyRootFilesystem = false # Next.js writes .next cache at runtime
  }])

  tags = {
    Name = "${local.name_prefix}-web-task-def"
  }
}

# ---- Agent-runtime ----
resource "aws_ecs_task_definition" "agent_runtime" {
  family                   = "${local.name_prefix}-agent-runtime"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task_roles["agent-runtime"].arn

  container_definitions = jsonencode([{
    name      = "agent-runtime"
    image     = var.agent_runtime_image
    essential = true

    environment = [
      { name = "NODE_ENV", value = var.environment },
    ]

    secrets = [
      { name = "REDIS_AUTH_TOKEN", valueFrom = var.redis_auth_token_arn },
      { name = "ENCRYPTION_KEY", valueFrom = var.encryption_key_arn },
    ]

    logConfiguration = local.log_config
    readonlyRootFilesystem = true
  }])

  tags = {
    Name = "${local.name_prefix}-agent-runtime-task-def"
  }
}

# ---- Ingestion-worker ----
resource "aws_ecs_task_definition" "ingestion_worker" {
  family                   = "${local.name_prefix}-ingestion-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task_roles["ingestion-worker"].arn

  container_definitions = jsonencode([{
    name      = "ingestion-worker"
    image     = var.ingestion_worker_image
    essential = true

    environment = [
      { name = "NODE_ENV", value = var.environment },
    ]

    secrets = [
      { name = "REDIS_AUTH_TOKEN", valueFrom = var.redis_auth_token_arn },
    ]

    logConfiguration = local.log_config
    readonlyRootFilesystem = true
  }])

  tags = {
    Name = "${local.name_prefix}-ingestion-worker-task-def"
  }
}

# ---- MCP node ----
resource "aws_ecs_task_definition" "mcp_node" {
  family                   = "${local.name_prefix}-mcp-node"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task_roles["mcp-node"].arn

  container_definitions = jsonencode([{
    name      = "mcp-node"
    image     = var.mcp_node_image_uri
    essential = true

    portMappings = [{
      containerPort = 8801
      protocol      = "tcp"
    }]

    environment = [
      { name = "NODE_ENV", value = var.environment },
      { name = "MCP_PORT", value = "8801" },
    ]

    logConfiguration = local.log_config
    readonlyRootFilesystem = true
  }])

  tags = {
    Name = "${local.name_prefix}-mcp-node-task-def"
  }
}

# ---- Sandbox-host ----
resource "aws_ecs_task_definition" "sandbox_host" {
  family                   = "${local.name_prefix}-sandbox-host"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task_roles["sandbox-host"].arn

  container_definitions = jsonencode([{
    name      = "sandbox-host"
    image     = var.sandbox_host_image
    essential = true

    portMappings = [{
      containerPort = 4200
      protocol      = "tcp"
    }]

    environment = [
      { name = "NODE_ENV", value = var.environment },
    ]

    logConfiguration = local.log_config
    readonlyRootFilesystem = true
  }])

  tags = {
    Name = "${local.name_prefix}-sandbox-host-task-def"
  }
}

###############################################################################
# ECS Services
###############################################################################

resource "aws_ecs_service" "api" {
  name                               = "${local.name_prefix}-api"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.api.arn
  desired_count                      = var.api_desired_count
  launch_type                        = "FARGATE"
  platform_version                   = "LATEST"
  health_check_grace_period_seconds  = 60
  enable_execute_command             = false

  network_configuration {
    subnets          = var.private_app_subnet_ids
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_controller {
    type = "ECS"
  }

  tags = {
    Name = "${local.name_prefix}-api-service"
  }

  depends_on = [aws_lb_listener.https]
}

resource "aws_ecs_service" "web" {
  name                               = "${local.name_prefix}-web"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.web.arn
  desired_count                      = var.web_desired_count
  launch_type                        = "FARGATE"
  platform_version                   = "LATEST"
  health_check_grace_period_seconds  = 60
  enable_execute_command             = false

  network_configuration {
    subnets          = var.private_app_subnet_ids
    security_groups  = [aws_security_group.web.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3001
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_controller {
    type = "ECS"
  }

  tags = {
    Name = "${local.name_prefix}-web-service"
  }

  depends_on = [aws_lb_listener.https]
}

resource "aws_ecs_service" "agent_runtime" {
  name             = "${local.name_prefix}-agent-runtime"
  cluster          = aws_ecs_cluster.main.id
  task_definition  = aws_ecs_task_definition.agent_runtime.arn
  desired_count    = var.agent_runtime_desired_count
  launch_type      = "FARGATE"
  platform_version = "LATEST"

  network_configuration {
    subnets          = var.private_app_subnet_ids
    security_groups  = [aws_security_group.agent_runtime.id]
    assign_public_ip = false
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  tags = {
    Name = "${local.name_prefix}-agent-runtime-service"
  }
}

resource "aws_ecs_service" "ingestion_worker" {
  name             = "${local.name_prefix}-ingestion-worker"
  cluster          = aws_ecs_cluster.main.id
  task_definition  = aws_ecs_task_definition.ingestion_worker.arn
  desired_count    = var.ingestion_worker_desired_count
  launch_type      = "FARGATE"
  platform_version = "LATEST"

  network_configuration {
    subnets          = var.private_app_subnet_ids
    security_groups  = [aws_security_group.ingestion_worker.id]
    assign_public_ip = false
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  tags = {
    Name = "${local.name_prefix}-ingestion-worker-service"
  }
}

resource "aws_ecs_service" "mcp_node" {
  name             = "${local.name_prefix}-mcp-node"
  cluster          = aws_ecs_cluster.main.id
  task_definition  = aws_ecs_task_definition.mcp_node.arn
  desired_count    = 1
  launch_type      = "FARGATE"
  platform_version = "LATEST"

  # MCP node in private-app subnets (needs external MCP endpoint access via NAT; FQDN allowlist deferred to T5.3)
  network_configuration {
    subnets          = var.private_app_subnet_ids
    security_groups  = [aws_security_group.mcp.id]
    assign_public_ip = false
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  tags = {
    Name = "${local.name_prefix}-mcp-node-service"
  }
}

resource "aws_ecs_service" "sandbox_host" {
  name             = "${local.name_prefix}-sandbox-host"
  cluster          = aws_ecs_cluster.main.id
  task_definition  = aws_ecs_task_definition.sandbox_host.arn
  desired_count    = var.sandbox_host_desired_count
  launch_type      = "FARGATE"
  platform_version = "LATEST"

  # Sandbox host runs in isolated subnets per doc §6 (not private-app)
  network_configuration {
    subnets          = var.isolated_subnet_ids
    security_groups  = [aws_security_group.sandbox_host.id]
    assign_public_ip = false
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  tags = {
    Name = "${local.name_prefix}-sandbox-host-service"
  }
}

###############################################################################
# ECS Application AutoScaling — CPU-based scale-out for core services
# sandbox-host and mcp-node are excluded (they scale differently).
###############################################################################

# ── API ──────────────────────────────────────────────────────────────────────

resource "aws_appautoscaling_target" "ecs_api" {
  count = var.enable_autoscaling ? 1 : 0

  max_capacity       = 6
  min_capacity       = var.api_desired_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "ecs_cpu_api" {
  count = var.enable_autoscaling ? 1 : 0

  name               = "${local.name_prefix}-api-cpu-scale"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs_api[0].resource_id
  scalable_dimension = aws_appautoscaling_target.ecs_api[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs_api[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

# ── Web ───────────────────────────────────────────────────────────────────────

resource "aws_appautoscaling_target" "ecs_web" {
  count = var.enable_autoscaling ? 1 : 0

  max_capacity       = 4
  min_capacity       = var.web_desired_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.web.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "ecs_cpu_web" {
  count = var.enable_autoscaling ? 1 : 0

  name               = "${local.name_prefix}-web-cpu-scale"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs_web[0].resource_id
  scalable_dimension = aws_appautoscaling_target.ecs_web[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs_web[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

# ── Agent-runtime ─────────────────────────────────────────────────────────────

resource "aws_appautoscaling_target" "ecs_agent_runtime" {
  count = var.enable_autoscaling ? 1 : 0

  max_capacity       = 8
  min_capacity       = var.agent_runtime_desired_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.agent_runtime.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "ecs_cpu_agent_runtime" {
  count = var.enable_autoscaling ? 1 : 0

  name               = "${local.name_prefix}-agent-runtime-cpu-scale"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs_agent_runtime[0].resource_id
  scalable_dimension = aws_appautoscaling_target.ecs_agent_runtime[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs_agent_runtime[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 60.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

# ── Ingestion-worker ──────────────────────────────────────────────────────────

resource "aws_appautoscaling_target" "ecs_ingestion_worker" {
  count = var.enable_autoscaling ? 1 : 0

  max_capacity       = 6
  min_capacity       = var.ingestion_worker_desired_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.ingestion_worker.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "ecs_cpu_ingestion_worker" {
  count = var.enable_autoscaling ? 1 : 0

  name               = "${local.name_prefix}-ingestion-worker-cpu-scale"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs_ingestion_worker[0].resource_id
  scalable_dimension = aws_appautoscaling_target.ecs_ingestion_worker[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs_ingestion_worker[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 60.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

# Queue-depth scaling for ingestion-worker (spec: "queue-depth for workers")
resource "aws_appautoscaling_policy" "ecs_queue_ingestion_worker" {
  count = var.enable_autoscaling && var.ingestion_queue_arn != "" ? 1 : 0

  name               = "${local.name_prefix}-ingestion-worker-queue-scale"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs_ingestion_worker[0].resource_id
  scalable_dimension = aws_appautoscaling_target.ecs_ingestion_worker[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs_ingestion_worker[0].service_namespace

  target_tracking_scaling_policy_configuration {
    customized_metric_specification {
      metric_name = "ApproximateNumberOfMessagesVisible"
      namespace   = "AWS/SQS"
      statistic   = "Average"
      dimensions {
        name  = "QueueUrl"
        value = var.ingestion_queue_arn
      }
    }
    target_value       = 10.0  # scale out when > 10 messages per running task
    scale_in_cooldown  = 300
    scale_out_cooldown = 30
    disable_scale_in   = false
  }
}

# ALB request-count-per-target scaling for api (spec: "CPU/RPS for api/web")
resource "aws_appautoscaling_policy" "ecs_rps_api" {
  count = var.enable_autoscaling ? 1 : 0

  name               = "${local.name_prefix}-api-rps-scale"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs_api[0].resource_id
  scalable_dimension = aws_appautoscaling_target.ecs_api[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs_api[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.main.arn_suffix}/${aws_lb_target_group.api.arn_suffix}"
    }
    target_value       = 1000.0  # requests per minute per task
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

# ALB request-count-per-target scaling for web (spec: "CPU/RPS for api/web")
resource "aws_appautoscaling_policy" "ecs_rps_web" {
  count = var.enable_autoscaling ? 1 : 0

  name               = "${local.name_prefix}-web-rps-scale"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs_web[0].resource_id
  scalable_dimension = aws_appautoscaling_target.ecs_web[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs_web[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.main.arn_suffix}/${aws_lb_target_group.web.arn_suffix}"
    }
    target_value       = 2000.0  # requests per minute per task
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
