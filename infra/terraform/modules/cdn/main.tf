###############################################################################
# CDN Module — Two separate CloudFront distributions
#
# 1. Web distribution  — ALB origin, full header/cookie/QS forwarding (dynamic)
# 2. Artifact distribution — S3 origin via OAC, NO cookies, isolated domain
#
# ISOLATION CONTRACT: The artifact distribution must never share a domain or
# cookies with the web distribution. Browser same-origin policy enforces this
# boundary. Artifact frames are sandboxed iframes loaded from artifact_domain_aliases.
#
# NOTE: This module owns the S3 artifacts bucket policy (replaces the
# deny_non_https policy from the s3 module). The CDN policy is comprehensive:
# it grants OAC read access AND enforces deny-non-HTTPS.
###############################################################################

###############################################################################
# Response headers policy — Web distribution
###############################################################################

resource "aws_cloudfront_response_headers_policy" "web" {
  name    = "${var.name_prefix}-web-security-headers"
  comment = "Security headers for ${var.name_prefix} web distribution (Mozilla Observatory Grade A)"

  security_headers_config {
    # HSTS preload: browsers will refuse HTTP entirely after first visit
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    xss_protection {
      mode_block = true
      protection = true
      override   = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
  }
}

###############################################################################
# Response headers policy — Artifact distribution
# Artifacts are served from an isolated origin. No cookies, no HSTS (served
# only to iframes), strict CSP with sandbox, no-store cache.
###############################################################################

resource "aws_cloudfront_response_headers_policy" "artifacts" {
  name    = "${var.name_prefix}-artifacts-security-headers"
  comment = "Security headers for ${var.name_prefix} artifact distribution (sandbox isolation)"

  security_headers_config {
    content_security_policy {
      content_security_policy = "default-src 'none'; sandbox"
      override                = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }
  }

  custom_headers_config {
    items {
      header   = "Cache-Control"
      value    = "no-store"
      override = true
    }
  }
}

###############################################################################
# Origin Access Control (OAC) for S3 artifacts bucket
# Replaces legacy OAI. CloudFront signs requests with SigV4.
###############################################################################

resource "aws_cloudfront_origin_access_control" "artifacts" {
  name                              = "${var.name_prefix}-artifacts-oac"
  description                       = "OAC for ${var.name_prefix} S3 artifacts bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

###############################################################################
# Web CloudFront distribution
# Dynamic origin — all headers/cookies/QS forwarded to ALB; effectively no
# CloudFront caching (TTL=0 through forwarded_values).
###############################################################################

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.name_prefix} web (ALB origin)"
  price_class         = "PriceClass_100" # US + EU only
  aliases             = var.web_domain_aliases
  web_acl_id          = var.waf_acl_arn

  origin {
    domain_name = var.alb_dns_name
    origin_id   = "alb-${var.name_prefix}"

    custom_origin_config {
      http_port  = 80
      https_port = 443

      # CloudFront → ALB is always HTTPS; no plaintext backend traffic
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    allowed_methods = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods  = ["GET", "HEAD"]
    target_origin_id       = "alb-${var.name_prefix}"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    # Forward everything — API responses must not be cached at edge
    forwarded_values {
      query_string = true
      headers      = ["*"]

      cookies {
        forward = "all"
      }
    }

    response_headers_policy_id = aws_cloudfront_response_headers_policy.web.id
  }

  viewer_certificate {
    acm_certificate_arn      = var.acm_certificate_arn
    minimum_protocol_version = "TLSv1.2_2021"
    ssl_support_method       = "sni-only"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = {
    Name = "${var.name_prefix}-web-distribution"
  }
}

###############################################################################
# Artifact CloudFront distribution
# ISOLATED origin — completely separate distribution on its own domain.
# NO cookies forwarded (browser cannot access web-domain cookies here).
# Serves only GET/HEAD to S3 via OAC.
###############################################################################

resource "aws_cloudfront_distribution" "artifacts" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${var.name_prefix} artifacts (S3 OAC — cookie-isolated)"
  price_class     = "PriceClass_100"
  aliases         = var.artifact_domain_aliases
  web_acl_id      = var.waf_acl_arn

  origin {
    domain_name              = var.artifacts_bucket_regional_domain_name
    origin_id                = "s3-${var.name_prefix}-artifacts"
    origin_access_control_id = aws_cloudfront_origin_access_control.artifacts.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-${var.name_prefix}-artifacts"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    # NO cookies forwarded — critical isolation requirement
    # Artifacts must not be accessible with web-domain session credentials
    forwarded_values {
      query_string = false

      cookies {
        forward = "none"
      }
    }

    response_headers_policy_id = aws_cloudfront_response_headers_policy.artifacts.id
  }

  viewer_certificate {
    acm_certificate_arn      = var.artifact_acm_certificate_arn
    minimum_protocol_version = "TLSv1.2_2021"
    ssl_support_method       = "sni-only"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = {
    Name = "${var.name_prefix}-artifacts-distribution"
  }
}

###############################################################################
# S3 artifacts bucket policy — OAC + deny non-HTTPS
#
# This resource OWNS the artifacts bucket policy. It supersedes the
# deny_non_https policy from the s3 module (which is excluded from that
# module's for_each for the artifacts bucket to avoid conflicts).
#
# Policy grants:
#   1. CloudFront OAC (this distribution only) → s3:GetObject
#   2. DenyNonHTTPS → blocks all non-TLS S3 API access
###############################################################################

data "aws_iam_policy_document" "artifacts_oac" {
  # Grant CloudFront OAC read-only access (scoped to this distribution ARN)
  statement {
    sid    = "AllowCloudFrontOAC"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::${var.artifacts_bucket_id}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.artifacts.arn]
    }
  }

  # Defense-in-depth: deny all non-HTTPS S3 API access
  statement {
    sid    = "DenyNonHTTPS"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]

    resources = [
      "arn:aws:s3:::${var.artifacts_bucket_id}",
      "arn:aws:s3:::${var.artifacts_bucket_id}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "artifacts_oac" {
  bucket = var.artifacts_bucket_id
  policy = data.aws_iam_policy_document.artifacts_oac.json

  depends_on = [aws_cloudfront_distribution.artifacts]
}
