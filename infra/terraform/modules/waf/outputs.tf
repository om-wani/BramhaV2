output "waf_acl_arn" {
  description = "WAF Web ACL ARN — pass as web_acl_id to CloudFront distributions"
  value       = aws_wafv2_web_acl.main.arn
}
