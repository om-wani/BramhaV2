# versions.tf — canonical provider/version constraints for the BramhaV2 stack.
#
# This file lives at infra/terraform/ for reference. The actual runnable root
# modules live under envs/* — each envs/<name>/main.tf includes its own
# terraform{} + provider{} blocks that mirror these constraints.
#
# Required providers (reference):
#   aws    ~> 5.0   (hashicorp/aws)
#   random ~> 3.6   (hashicorp/random)
#
# Minimum Terraform version: >= 1.7
#
# Provider defaults applied in every env root:
#   region       = var.aws_region
#   default_tags = { Project, Environment, ManagedBy }

