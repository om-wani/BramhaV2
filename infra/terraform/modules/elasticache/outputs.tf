output "redis_replication_group_id" {
  description = "ElastiCache replication group ID"
  value       = aws_elasticache_replication_group.main.id
}

output "redis_primary_endpoint" {
  description = "Redis primary endpoint address"
  value       = aws_elasticache_replication_group.main.primary_endpoint_address
  sensitive   = true
}

output "redis_reader_endpoint" {
  description = "Redis reader endpoint address"
  value       = aws_elasticache_replication_group.main.reader_endpoint_address
  sensitive   = true
}

output "redis_port" {
  description = "Redis port"
  value       = 6379
}

output "redis_sg_id" {
  description = "Security group ID for the Redis cluster"
  value       = aws_security_group.redis.id
}

output "redis_subnet_group_name" {
  description = "ElastiCache subnet group name"
  value       = aws_elasticache_subnet_group.main.name
}
