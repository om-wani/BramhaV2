# BramhaV2 DR Runbook

**RTO target: 4 hours | RPO target: 15 minutes**

## 1. AZ failure

**Detection:** CloudWatch alarm `bramha-prod-ecs-unhealthy-tasks` fires (RunningTaskCount < 1 for 2 consecutive minutes), or ALB 5xx spike.

**Recovery:**
1. ECS Fargate auto-replaces tasks in healthy AZs (multi-AZ subnets configured across 3 AZs).
2. Verify within 5 min: monitor `https://bramha.ai/api/health` returning 200.
3. If ALB target health shows persistent failures, force new deployment:
   ```bash
   aws ecs update-service --cluster bramha-prod-cluster \
     --service bramha-prod-api --force-new-deployment
   ```
4. To validate self-heal behavior in staging first:
   ```bash
   CLUSTER=bramha-staging AZ=us-east-1a \
   HEALTH_URL=https://staging.bramha.ai/api/health \
   ./scripts/dr/kill-az-tasks.sh
   ```

**Expected RTO:** < 5 min (ECS automatic task replacement).

---

## 2. RDS failure / corruption

**Detection:** CloudWatch RDS alarm or application `DatabaseConnectionError` alerts in logs.

**Recovery — Point-in-time restore:**

```bash
SOURCE_DB_ID=bramha-prod-rds \
RESTORE_TIME=$(date -u -d '15 minutes ago' +%Y-%m-%dT%H:%M:%SZ) \
DRILL_SUBNET_GROUP=bramha-dr-subnet-group \
DRILL_SG=sg-dr-isolated \
MIGRATOR_PASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id bramha-prod-db-migrator-password \
  --query SecretString --output text) \
./scripts/dr/rds-restore-drill.sh
```

Steps after restore completes:
1. Update `DATABASE_URL` in Secrets Manager to point to restored instance endpoint.
2. Trigger rolling restart of ECS API service:
   ```bash
   aws ecs update-service --cluster bramha-prod-cluster \
     --service bramha-prod-api --force-new-deployment
   ```
3. Verify application health endpoint returns 200.
4. Once stable, rename or promote restored instance to replace the failed one.

**Expected RTO:** 30-60 min (restore time) + 15 min (service restart). **Total well within 4 h target.**
**RPO:** RDS automated backups with 5-minute granularity PITR. **15 min target met.**

---

## 3. Redis failure

**Detection:** ElastiCache alarm or `redis_connection_failed` application errors.

**Recovery:**
1. ElastiCache Multi-AZ with automatic failover — primary fails over in < 60 s with no action required.
2. Monitor status:
   ```bash
   aws elasticache describe-replication-groups \
     --replication-group-id bramha-prod-redis \
     --query 'ReplicationGroups[0].{Status:Status,Primary:NodeGroups[0].PrimaryEndpoint.Address}'
   ```
3. If failover stalls, force it manually (staging only for drills):
   ```bash
   REPLICATION_GROUP_ID=bramha-staging-redis ./scripts/dr/redis-failover-test.sh
   ```

**Expected RTO:** < 2 min (automatic). Manual: < 5 min.

---

## 4. Key rotation after breach

1. Immediately rotate all Secrets Manager secrets:
   ```bash
   for secret in db_password redis_auth_token jwt_secret api_key_salt encryption_key; do
     aws secretsmanager rotate-secret --secret-id "bramha-prod-${secret}"
   done
   ```
2. Force ECS task restart across all services to pick up new secrets:
   ```bash
   for svc in api web agent-runtime ingestion-worker; do
     aws ecs update-service --cluster bramha-prod-cluster \
       --service "bramha-prod-${svc}" --force-new-deployment
   done
   ```
3. Invalidate all active JWT sessions by setting `jwt_issued_before = NOW()` in the database (implementation-specific config table or environment variable update).
4. Invalidate all active API keys: mark `revoked_at = NOW()` for all rows in `api_keys` table.
5. Notify affected users of forced re-login requirement.
6. Create audit log entry (via `/admin` audit log or direct DB insert with `bramha_migrator`).

---

## 5. Breach response

Per security compliance doc (07_security_compliance.md §6):

1. **Isolate:** Remove ECS services from ALB target groups (zero traffic):
   ```bash
   aws ecs update-service --cluster bramha-prod-cluster \
     --service bramha-prod-api --desired-count 0
   ```
2. **Snapshot:** Create immediate RDS + ElastiCache snapshots:
   ```bash
   aws rds create-db-snapshot \
     --db-instance-identifier bramha-prod-rds \
     --db-snapshot-identifier "breach-$(date +%Y%m%d%H%M%S)"
   ```
3. **Preserve:** Enable CloudWatch log retention lock; do not delete any logs.
4. **Notify:** Issue breach notification per applicable legal obligations (GDPR, SOC 2, etc.) within required timeframe.
5. **Rotate:** All credentials per §4 above.
6. **Investigate:** Use CloudWatch Logs Insights + OpenSearch audit trail to determine scope.
7. **Restore:** From pre-breach snapshot to clean isolated VPC (use `rds-restore-drill.sh` with `DRILL_SUBNET_GROUP` pointing to clean DR VPC), verify integrity via row-count checksums.

---

## Scheduled drills

| Drill | Frequency | Script | Expected outcome |
|-------|-----------|--------|-----------------|
| AZ kill test | Monthly | `scripts/dr/kill-az-tasks.sh` | Self-heal < 5 min, no sustained 5xx |
| RDS PITR restore | Weekly | `scripts/dr/rds-restore-drill.sh` | All tables queryable, checksums pass |
| Redis failover | Quarterly | `scripts/dr/redis-failover-test.sh` | New primary elected < 60 s |
| Full game day | Quarterly | `scripts/dr/game-day.sh` | All drills pass |

### CI cron (GitHub Actions / scheduled Lambda)

Add to `.github/workflows/dr-drills.yml`:

```yaml
on:
  schedule:
    - cron: '0 3 * * 0'   # weekly Sunday 03:00 UTC — RDS restore
    - cron: '0 4 1 * *'   # monthly 1st — AZ kill test (staging)
```

---

## RTO / RPO summary

| Scenario | RTO | RPO | Demonstrated by |
|----------|-----|-----|-----------------|
| AZ failure | < 5 min | 0 (no data loss) | `kill-az-tasks.sh` |
| RDS PITR restore | < 4 h | 15 min | `rds-restore-drill.sh` |
| Redis failover | < 2 min | 0 (in-memory cache) | `redis-failover-test.sh` |
| Full region failure | Manual DR | 15 min | Cross-region restore (future) |
