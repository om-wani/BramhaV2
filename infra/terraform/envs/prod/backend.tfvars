# S3 remote state backend configuration for prod.
# Pass at init time: terraform init -backend-config=backend.tfvars
#
# The state bucket must be created before running terraform init.
# See infra/scripts/bootstrap-state-bucket.sh (prod variant).
#
# No credentials here — use AWS_PROFILE or instance role.

bucket         = "bramha-terraform-state-prod"
key            = "bramha/prod/terraform.tfstate"
region         = "us-east-1"
dynamodb_table = "bramha-terraform-lock-prod"
encrypt        = true
kms_key_id     = "alias/bramha-prod-tfstate"
