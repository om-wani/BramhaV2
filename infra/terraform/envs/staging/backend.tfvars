# S3 remote state backend configuration for staging.
# Pass at init time: terraform init -backend-config=backend.tfvars
#
# The state bucket must be created before running terraform init.
# See infra/scripts/bootstrap-state-bucket.sh (not yet created).
#
# No credentials here — use AWS_PROFILE or instance role.

bucket         = "bramha-terraform-state-staging"
key            = "staging/terraform.tfstate"
region         = "us-east-1"
dynamodb_table = "bramha-terraform-lock-staging"
encrypt        = true
kms_key_id = "alias/bramha-staging-tfstate"  # Created by infra/scripts/bootstrap-state-bucket.sh
