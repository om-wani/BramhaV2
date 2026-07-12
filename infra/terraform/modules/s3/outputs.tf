output "staging_bucket_id" {
  description = "S3 staging bucket name"
  value       = aws_s3_bucket.staging.id
}

output "staging_bucket_arn" {
  description = "S3 staging bucket ARN"
  value       = aws_s3_bucket.staging.arn
}

output "clean_bucket_id" {
  description = "S3 clean bucket name"
  value       = aws_s3_bucket.clean.id
}

output "clean_bucket_arn" {
  description = "S3 clean bucket ARN"
  value       = aws_s3_bucket.clean.arn
}

output "quarantine_bucket_id" {
  description = "S3 quarantine bucket name"
  value       = aws_s3_bucket.quarantine.id
}

output "quarantine_bucket_arn" {
  description = "S3 quarantine bucket ARN"
  value       = aws_s3_bucket.quarantine.arn
}

output "artifacts_bucket_id" {
  description = "S3 artifacts bucket name"
  value       = aws_s3_bucket.artifacts.id
}

output "artifacts_bucket_arn" {
  description = "S3 artifacts bucket ARN"
  value       = aws_s3_bucket.artifacts.arn
}

output "artifacts_bucket_regional_domain_name" {
  description = "S3 artifacts bucket regional domain name (used as CloudFront S3 origin)"
  value       = aws_s3_bucket.artifacts.bucket_regional_domain_name
}

output "audit_export_bucket_id" {
  description = "S3 audit-export bucket name"
  value       = aws_s3_bucket.audit_export.id
}

output "audit_export_bucket_arn" {
  description = "S3 audit-export bucket ARN"
  value       = aws_s3_bucket.audit_export.arn
}

output "logs_bucket_id" {
  description = "S3 dedicated logs bucket name (S3 server access logs + ALB access logs)"
  value       = aws_s3_bucket.logs.id
}

output "logs_bucket_domain_name" {
  description = "S3 logs bucket domain name for CloudFront access logging (bucket.s3.amazonaws.com)"
  value       = aws_s3_bucket.logs.bucket_domain_name
}

output "all_bucket_arns" {
  description = "List of all S3 bucket ARNs"
  value = [
    aws_s3_bucket.staging.arn,
    aws_s3_bucket.clean.arn,
    aws_s3_bucket.quarantine.arn,
    aws_s3_bucket.artifacts.arn,
    aws_s3_bucket.audit_export.arn,
  ]
}
