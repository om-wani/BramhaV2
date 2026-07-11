output "db_instance_id" {
  description = "RDS instance identifier"
  value       = aws_db_instance.main.identifier
}

output "db_endpoint" {
  description = "RDS endpoint (host:port)"
  value       = aws_db_instance.main.endpoint
  sensitive   = true
}

output "db_host" {
  description = "RDS hostname"
  value       = aws_db_instance.main.address
  sensitive   = true
}

output "db_port" {
  description = "RDS port"
  value       = aws_db_instance.main.port
}

output "db_name" {
  description = "Database name"
  value       = aws_db_instance.main.db_name
}

output "db_username" {
  description = "Master DB username"
  value       = aws_db_instance.main.username
  sensitive   = true
}

output "rds_sg_id" {
  description = "Security group ID attached to the RDS instance"
  value       = aws_security_group.rds.id
}

output "db_subnet_group_name" {
  description = "DB subnet group name"
  value       = aws_db_subnet_group.main.name
}
