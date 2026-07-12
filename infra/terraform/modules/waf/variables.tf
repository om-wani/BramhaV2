variable "name_prefix" {
  description = "Prefix for WAF resource names"
  type        = string
}

variable "scope" {
  description = "WAF scope: CLOUDFRONT or REGIONAL. CloudFront WAFs must be in us-east-1."
  type        = string
  default     = "CLOUDFRONT"

  validation {
    condition     = contains(["CLOUDFRONT", "REGIONAL"], var.scope)
    error_message = "scope must be CLOUDFRONT or REGIONAL."
  }
}

variable "bot_control_block" {
  description = "Set true to put Bot Control in BLOCK mode; false (default) = COUNT mode for staging."
  type        = bool
  default     = false
}

variable "rate_limit" {
  description = "Maximum requests per 5-minute window per IP before blocking (rate-based rule)."
  type        = number
  default     = 2000
}
