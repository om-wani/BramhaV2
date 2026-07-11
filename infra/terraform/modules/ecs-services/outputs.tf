output "cluster_id" {
  description = "ECS cluster ID"
  value       = aws_ecs_cluster.main.id
}

output "cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.main.name
}

output "alb_dns_name" {
  description = "ALB DNS name"
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "ALB canonical hosted zone ID (for Route 53 alias records)"
  value       = aws_lb.main.zone_id
}

output "alb_arn" {
  description = "ALB ARN"
  value       = aws_lb.main.arn
}

output "api_sg_id" {
  description = "Security group ID of the API service"
  value       = aws_security_group.api.id
}

output "web_sg_id" {
  description = "Security group ID of the Web service"
  value       = aws_security_group.web.id
}

output "runtime_sg_id" {
  description = "Security group ID of the agent-runtime service"
  value       = aws_security_group.agent_runtime.id
}

output "ingestion_sg_id" {
  description = "Security group ID of the ingestion-worker service"
  value       = aws_security_group.ingestion_worker.id
}

output "sandbox_sg_id" {
  description = "Security group ID of the sandbox-host service"
  value       = aws_security_group.sandbox_host.id
}

output "task_execution_role_arn" {
  description = "ARN of the shared ECS task execution role"
  value       = aws_iam_role.task_execution.arn
}

output "api_task_def_arn" {
  description = "ARN of the API task definition"
  value       = aws_ecs_task_definition.api.arn
}

output "web_task_def_arn" {
  description = "ARN of the Web task definition"
  value       = aws_ecs_task_definition.web.arn
}
