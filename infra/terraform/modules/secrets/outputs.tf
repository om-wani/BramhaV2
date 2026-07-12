output "kms_key_arn" {
  description = "ARN of the Bramha CMK"
  value       = aws_kms_key.main.arn
}

output "kms_key_id" {
  description = "Key ID of the Bramha CMK"
  value       = aws_kms_key.main.key_id
}

output "kms_alias_arn" {
  description = "ARN of the KMS key alias"
  value       = aws_kms_alias.main.arn
}

output "db_password_arn" {
  description = "ARN of the RDS password secret"
  value       = aws_secretsmanager_secret.db_password.arn
  sensitive   = true
}

output "redis_auth_token_arn" {
  description = "ARN of the Redis AUTH token secret"
  value       = aws_secretsmanager_secret.redis_auth_token.arn
  sensitive   = true
}

output "jwt_secret_arn" {
  description = "ARN of the JWT secret"
  value       = aws_secretsmanager_secret.jwt_secret.arn
  sensitive   = true
}

output "api_key_salt_arn" {
  description = "ARN of the API key salt secret"
  value       = aws_secretsmanager_secret.api_key_salt.arn
  sensitive   = true
}

output "encryption_key_arn" {
  description = "ARN of the field encryption key secret"
  value       = aws_secretsmanager_secret.encryption_key.arn
  sensitive   = true
}

output "opensearch_master_password_secret_arn" {
  description = "ARN of the OpenSearch SIEM master password secret"
  value       = aws_secretsmanager_secret.opensearch_master_password.arn
  sensitive   = true
}

output "all_secret_arns" {
  description = "All secret ARNs — used for IAM task role policies"
  sensitive   = true
  value = [
    aws_secretsmanager_secret.db_password.arn,
    aws_secretsmanager_secret.redis_auth_token.arn,
    aws_secretsmanager_secret.jwt_secret.arn,
    aws_secretsmanager_secret.api_key_salt.arn,
    aws_secretsmanager_secret.encryption_key.arn,
    aws_secretsmanager_secret.opensearch_master_password.arn,
  ]
}
