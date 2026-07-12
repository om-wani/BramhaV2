###############################################################################
# WAF Module — Web ACL for CloudFront distributions
#
# IMPORTANT: CloudFront WAF ACLs MUST be created in us-east-1.
# The caller MUST pass the us_east_1 provider alias:
#
#   module "waf" {
#     source = "../../modules/waf"
#     ...
#     providers = { aws = aws.us_east_1 }
#   }
###############################################################################

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

resource "aws_wafv2_web_acl" "main" {
  name        = "${var.name_prefix}-waf-acl"
  description = "WAF ACL for ${var.name_prefix} CloudFront distributions"
  scope       = var.scope

  default_action {
    allow {}
  }

  ###########################################################################
  # Priority 5 — IP Reputation List
  # Blocks known malicious IPs, botnets, anonymous proxies, and Tor nodes.
  ###########################################################################
  rule {
    name     = "AWSManagedRulesAmazonIpReputationList"
    priority = 5

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAmazonIpReputationList"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  ###########################################################################
  # Priority 10 — Common Rule Set (core protection)
  # Blocks OWASP Top 10 patterns including LFI, RFI, SSRF.
  ###########################################################################
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 10

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-common-rules"
      sampled_requests_enabled   = true
    }
  }

  ###########################################################################
  # Priority 20 — Known Bad Inputs (SQLi / XSS patterns)
  ###########################################################################
  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 20

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  ###########################################################################
  # Priority 30 — Dedicated SQL Injection Rule Set
  ###########################################################################
  rule {
    name     = "AWSManagedRulesSQLiRuleSet"
    priority = 30

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-sqli"
      sampled_requests_enabled   = true
    }
  }

  ###########################################################################
  # Priority 40 — Bot Control
  # Staging default: count mode (bot_control_block = false).
  # Production: set bot_control_block = true to flip to block.
  ###########################################################################
  rule {
    name     = "AWSBotControlRuleGroup"
    priority = 40

    dynamic "override_action" {
      # count mode when bot_control_block = false
      for_each = var.bot_control_block ? [] : [1]
      content {
        count {}
      }
    }

    dynamic "override_action" {
      # none = defer to rule actions (block) when bot_control_block = true
      for_each = var.bot_control_block ? [1] : []
      content {
        none {}
      }
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesBotControlRuleSet"
        vendor_name = "AWS"

        managed_rule_group_configs {
          aws_managed_rules_bot_control_rule_set {
            inspection_level = "COMMON"
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-bot-control"
      sampled_requests_enabled   = true
    }
  }

  ###########################################################################
  # Priority 50 — Rate-based rule (per-IP, 5-minute rolling window)
  # Default: 2000 req / 5 min → block until window resets.
  ###########################################################################
  rule {
    name     = "RateLimitPerIP"
    priority = 50

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.rate_limit
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name_prefix}-waf-acl"
    sampled_requests_enabled   = true
  }

  tags = {
    Name = "${var.name_prefix}-waf-acl"
  }
}
