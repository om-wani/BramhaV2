output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "vpc_cidr" {
  description = "VPC CIDR block"
  value       = aws_vpc.main.cidr_block
}

output "public_subnet_ids" {
  description = "IDs of the public subnets (ALB tier)"
  value       = aws_subnet.public[*].id
}

output "private_app_subnet_ids" {
  description = "IDs of the private-app subnets (ECS tier)"
  value       = aws_subnet.private_app[*].id
}

output "isolated_subnet_ids" {
  description = "IDs of the isolated subnets (RDS/Redis/MCP tier)"
  value       = aws_subnet.isolated[*].id
}

output "nat_gateway_ids" {
  description = "NAT gateway IDs (one per AZ)"
  value       = aws_nat_gateway.main[*].id
}

output "nat_public_ips" {
  description = "Elastic IP addresses of the NAT gateways"
  value       = aws_eip.nat[*].public_ip
}

output "s3_vpc_endpoint_id" {
  description = "S3 Gateway VPC endpoint ID"
  value       = aws_vpc_endpoint.s3.id
}

output "interface_endpoint_ids" {
  description = "Map of interface VPC endpoint IDs by service name"
  value       = { for k, v in aws_vpc_endpoint.interface : k => v.id }
}

output "vpc_endpoint_sg_id" {
  description = "Security group ID for Interface VPC endpoints"
  value       = aws_security_group.vpc_endpoints.id
}
