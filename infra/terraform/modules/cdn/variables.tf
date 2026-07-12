variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "waf_acl_arn" {
  description = "WAF Web ACL ARN (from waf module — must have been created in us-east-1)"
  type        = string
}

variable "alb_dns_name" {
  description = "ALB DNS name — origin for the web CloudFront distribution"
  type        = string
}

variable "artifacts_bucket_regional_domain_name" {
  description = "S3 artifacts bucket regional domain name (e.g. bucket.s3.us-east-1.amazonaws.com)"
  type        = string
}

variable "artifacts_bucket_id" {
  description = "S3 artifacts bucket name (ID) — used for OAC bucket policy"
  type        = string
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for the web distribution (must be in us-east-1 for CloudFront)"
  type        = string
}

variable "artifact_acm_certificate_arn" {
  description = "ACM certificate ARN for the artifact distribution (must be in us-east-1 for CloudFront)"
  type        = string
}

variable "web_domain_aliases" {
  description = "Custom domain aliases for the web CloudFront distribution"
  type        = list(string)
  default     = []
}

variable "artifact_domain_aliases" {
  description = "Custom domain aliases for the artifact CloudFront distribution (separate isolated origin)"
  type        = list(string)
  default     = []
}
