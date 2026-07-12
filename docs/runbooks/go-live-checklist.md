# BramhaV2 Go-Live Checklist

Execute in order before flipping DNS to production.

## Pre-launch (T-7 days)

- [ ] All T5.x tasks committed and reviewed (T5.1–T5.7)
- [ ] ASVS L2 checklist ≥ 95% pass (`docs/runbooks/asvs-l2-checklist.md`)
- [ ] Pen-test probe battery passes: `BASE_URL=https://staging.bramha.ai ./scripts/security/probe-battery.sh`
- [ ] Trivy scan clean (zero CRITICAL/HIGH unfixed): check CI for latest build
- [ ] gitleaks scan clean on release commit: `gitleaks detect --source .`
- [ ] Semgrep scan clean: `semgrep --config .semgrep.yml --error .`
- [ ] Staging `terraform apply` converges from clean state (idempotent)
- [ ] DR game-day passed: `./scripts/dr/game-day.sh`
- [ ] RDS restore drill passed: `./scripts/dr/rds-restore-drill.sh`

## Pre-launch (T-1 day)

- [ ] Prod `terraform apply` validated in dry-run: `terraform plan -out=plan.tfplan`
- [ ] DNS TTL reduced to 60s (facilitates quick rollback if needed)
- [ ] On-call rotation confirmed; PagerDuty/SNS routing verified
- [ ] CloudWatch dashboards visible: `bramha-overview` + `bramha-agent-turns`
- [ ] All ASM secrets populated (no `REPLACE_ME` values remain)
- [ ] ACM certificates issued and validated for all domains
- [ ] Prod ECR images built, signed with cosign, pushed

## Launch (Day 0)

- [ ] `terraform apply infra/terraform/envs/prod/` — convergence confirmed
- [ ] All ECS services healthy (green in ALB target groups)
- [ ] RDS and ElastiCache reachable from ECS (internal probe)
- [ ] `BASE_URL=https://bramha.ai ./scripts/security/probe-battery.sh` passes
- [ ] `URL=https://bramha.ai ./infra/scripts/check-security-headers.sh` passes
- [ ] WAF in prod block mode (`bot_control_block = true`)
- [ ] Manual smoke test: register → login → create project → invite user → send message
- [ ] Tag release: `git tag -s v1.0.0 -m "BramhaV2 v1.0.0 launch"` and push

## Post-launch (Week 1)

- [ ] Daily: review CloudWatch dashboards for anomalies
- [ ] Daily: check DLQ depth (zero expected)
- [ ] Day 3: review WAF blocked-request logs — tune rate limits if needed
- [ ] Day 5: review first-token latency P95 — tune agent concurrency if needed
- [ ] Day 7: week-1 review meeting scheduled
  - Agenda: alert threshold tuning, cost review, performance review, security incidents (if any)
- [ ] Schedule recurring: monthly AZ kill drill, weekly RDS restore drill, quarterly game-day

## Rollback (if needed)

```bash
# One-command rollback to previous ECS task defs
ENVIRONMENT=prod ./scripts/rollback.sh

# If Terraform state is corrupted
terraform apply -target=module.ecs_services infra/terraform/envs/prod/
```
