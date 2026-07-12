output "web_distribution_id" {
  description = "CloudFront web distribution ID"
  value       = aws_cloudfront_distribution.web.id
}

output "web_domain_name" {
  description = "CloudFront web distribution domain name (*.cloudfront.net)"
  value       = aws_cloudfront_distribution.web.domain_name
}

output "artifact_distribution_id" {
  description = "CloudFront artifacts distribution ID"
  value       = aws_cloudfront_distribution.artifacts.id
}

output "artifact_domain_name" {
  description = "CloudFront artifacts distribution domain name (*.cloudfront.net)"
  value       = aws_cloudfront_distribution.artifacts.domain_name
}
