###############################################################################
# Network Module — Three-tier VPC
# Tiers: public (ALB), private-app (ECS+NAT egress), isolated (RDS/Redis/MCP)
###############################################################################

locals {
  azs = length(var.availability_zones) > 0 ? var.availability_zones : data.aws_availability_zones.available.names
  # Clamp to 2 AZs minimum; list slicing handled by the count on each subnet
  az_count = min(length(local.azs), max(length(var.public_subnet_cidrs), 2))
  name_prefix = "bramha-${var.environment}"
}

data "aws_availability_zones" "available" {
  state = "available"
}

###############################################################################
# VPC
###############################################################################

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${local.name_prefix}-vpc"
  }
}

###############################################################################
# Internet Gateway (public tier only)
###############################################################################

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-igw"
  }
}

###############################################################################
# Public subnets
###############################################################################

resource "aws_subnet" "public" {
  count = local.az_count

  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_cidrs[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = false # ALB uses EIPs; instances stay private

  tags = {
    Name = "${local.name_prefix}-public-${count.index + 1}"
    Tier = "public"
  }
}

###############################################################################
# Private-app subnets
###############################################################################

resource "aws_subnet" "private_app" {
  count = local.az_count

  vpc_id            = aws_vpc.main.id
  cidr_block        = var.private_app_subnet_cidrs[count.index]
  availability_zone = local.azs[count.index]

  tags = {
    Name = "${local.name_prefix}-private-app-${count.index + 1}"
    Tier = "private-app"
  }
}

###############################################################################
# Isolated subnets (RDS / Redis / MCP) — NO internet route
###############################################################################

resource "aws_subnet" "isolated" {
  count = local.az_count

  vpc_id            = aws_vpc.main.id
  cidr_block        = var.isolated_subnet_cidrs[count.index]
  availability_zone = local.azs[count.index]

  tags = {
    Name = "${local.name_prefix}-isolated-${count.index + 1}"
    Tier = "isolated"
  }
}

###############################################################################
# Elastic IPs + NAT Gateways (one per AZ for HA)
###############################################################################

resource "aws_eip" "nat" {
  count  = local.az_count
  domain = "vpc"

  tags = {
    Name = "${local.name_prefix}-nat-eip-${count.index + 1}"
  }

  depends_on = [aws_internet_gateway.main]
}

resource "aws_nat_gateway" "main" {
  count = local.az_count

  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  tags = {
    Name = "${local.name_prefix}-nat-${count.index + 1}"
  }

  depends_on = [aws_internet_gateway.main]
}

###############################################################################
# Route tables
###############################################################################

# Public — default route to IGW
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "${local.name_prefix}-rt-public"
  }
}

resource "aws_route_table_association" "public" {
  count          = local.az_count
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Private-app — per-AZ route to NAT gateway
resource "aws_route_table" "private_app" {
  count  = local.az_count
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main[count.index].id
  }

  tags = {
    Name = "${local.name_prefix}-rt-private-app-${count.index + 1}"
  }
}

resource "aws_route_table_association" "private_app" {
  count          = local.az_count
  subnet_id      = aws_subnet.private_app[count.index].id
  route_table_id = aws_route_table.private_app[count.index].id
}

# Isolated — NO default route; only VPC local + VPC endpoint routes added by AWS
resource "aws_route_table" "isolated" {
  count  = local.az_count
  vpc_id = aws_vpc.main.id

  # Intentionally no default route — isolated subnet has NO internet access
  tags = {
    Name = "${local.name_prefix}-rt-isolated-${count.index + 1}"
  }
}

resource "aws_route_table_association" "isolated" {
  count          = local.az_count
  subnet_id      = aws_subnet.isolated[count.index].id
  route_table_id = aws_route_table.isolated[count.index].id
}

###############################################################################
# VPC Endpoints
###############################################################################

# --- Gateway endpoint: S3 (free, adds route to route tables) ---
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"

  route_table_ids = concat(
    [aws_route_table.public.id],
    aws_route_table.private_app[*].id,
    aws_route_table.isolated[*].id,
  )

  tags = {
    Name = "${local.name_prefix}-vpce-s3"
  }
}

# Security group shared by all Interface endpoints
resource "aws_security_group" "vpc_endpoints" {
  name        = "${local.name_prefix}-sg-vpce"
  description = "Allow HTTPS from VPC to Interface VPC endpoints"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTPS from VPC"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    description = "No outbound (endpoints are passive)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["127.0.0.1/32"] # effectively deny all
  }

  tags = {
    Name = "${local.name_prefix}-sg-vpce"
  }
}

# --- Interface endpoints deployed in isolated subnets ---
locals {
  interface_endpoint_services = [
    "secretsmanager",
    "ecr.api",
    "ecr.dkr",
    "logs",
  ]
}

resource "aws_vpc_endpoint" "interface" {
  for_each = toset(local.interface_endpoint_services)

  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.aws_region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = aws_subnet.isolated[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints.id]

  tags = {
    Name = "${local.name_prefix}-vpce-${replace(each.key, ".", "-")}"
  }
}

###############################################################################
# VPC Flow Logs
###############################################################################

resource "aws_cloudwatch_log_group" "flow_logs" {
  count             = var.enable_flow_logs ? 1 : 0
  name              = "/aws/vpc/flow-logs/${local.name_prefix}"
  retention_in_days = var.flow_log_retention_days
  kms_key_id        = var.kms_key_id

  tags = {
    Name = "${local.name_prefix}-flow-logs"
  }
}

resource "aws_iam_role" "flow_logs" {
  count = var.enable_flow_logs ? 1 : 0
  name  = "${local.name_prefix}-flow-logs-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "vpc-flow-logs.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "flow_logs" {
  count = var.enable_flow_logs ? 1 : 0
  name  = "${local.name_prefix}-flow-logs-policy"
  role  = aws_iam_role.flow_logs[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
      ]
      Resource = "${aws_cloudwatch_log_group.flow_logs[0].arn}:*"
    }]
  })
}

resource "aws_flow_log" "main" {
  count = var.enable_flow_logs ? 1 : 0

  iam_role_arn    = aws_iam_role.flow_logs[0].arn
  log_destination = aws_cloudwatch_log_group.flow_logs[0].arn
  traffic_type    = "ALL"
  vpc_id          = aws_vpc.main.id

  tags = {
    Name = "${local.name_prefix}-flow-log"
  }
}
