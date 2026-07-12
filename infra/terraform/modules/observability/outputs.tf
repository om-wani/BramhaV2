###############################################################################
# Observability Module — Outputs
###############################################################################

output "critical_sns_arn" {
  description = "ARN of the bramha-alerts-critical SNS topic"
  value       = aws_sns_topic.critical.arn
}

output "warning_sns_arn" {
  description = "ARN of the bramha-alerts-warning SNS topic"
  value       = aws_sns_topic.warning.arn
}

output "firehose_delivery_stream_arn" {
  description = "ARN of the Kinesis Firehose delivery stream for audit events"
  value       = aws_kinesis_firehose_delivery_stream.audit.arn
}

output "opensearch_endpoint" {
  description = "OpenSearch domain endpoint (VPC-internal)"
  value       = aws_opensearch_domain.siem.endpoint
}
