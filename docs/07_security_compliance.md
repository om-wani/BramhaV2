# 07 — Security & Compliance Lifecycle

The chronological security program for BramhaV2, ordered exactly as the build proceeds: from the
first local commit to production scale. Each stage lists binding controls; the per-task Security
Configuration checklists in `03_implementation_phases.md` are derived from this document.

---

## 1. Threat model (STRIDE-lite, agentic surfaces first)

| # | Threat | Vector | Primary controls |
|---|--------|--------|------------------|
| T1 | **Prompt injection** | Uploaded files, ingested repos/URLs, MCP results steering an agent ("ignore instructions, exfiltrate…") | `<untrusted_context>` delimiting; tools as the only action surface; zero-trust policy engine + approval gates on write/execute; injection-resistance clause in every persona; egress allowlists |
| T2 | **Cross-tenant data leak** | Bug in query scoping, vector search without filter, bus channel crossover, S3 key guessing | Postgres RLS (FORCE) on every tenant table; project-filtered HNSW queries; `:{projectId}`-suffixed channels with WsAuthGuard; presigned URLs w/ 60 s TTL; automated cross-tenant probe suite in CI |
| T3 | **Malicious uploads** | Malware, polyglot files, zip bombs, XSS-in-SVG, PDF with JS | Byte-level magic sniff vs declared MIME, extension allowlist, ClamAV, image re-encode, PDF disarm, SVG sanitization (or rasterization), decompression ratio caps, quarantine bucket |
| T4 | **Artifact XSS / sandbox escape** | Agent-generated HTML/JS reaching host DOM or cookies | Null-origin sandboxed iframe (`allow-scripts` only), separate artifact subdomain, CSP `default-src 'none'`, postMessage-only bridge, no cookies on artifact origin |
| T5 | **Agent code execution abuse** | `run_code` used for network attacks, resource exhaustion, container escape | No-network namespace, read-only rootfs, seccomp default-deny, cgroup caps (0.5 vCPU/512 MB/30 s), gVisor/Firecracker in prod, output caps, pooled-then-destroyed containers |
| T6 | **MCP credential/scope abuse** | Agent coaxed into over-broad connector calls; stolen capability tokens | Per-(persona×connector×scope) grants, single-use 60 s capability JWTs (jti replay check), mTLS, connector-side read-only enforcement, secrets injected only into MCP nodes |
| T7 | **AuthN/AuthZ breaks** | Credential stuffing, token theft, session fixation, IDOR | argon2id, rate limits + lockout w/ jitter, rotating refresh tokens (family revocation on reuse), HttpOnly/Secure/SameSite cookies, short-lived access JWT, membership guards on every route AND socket join, UUIDs everywhere (no sequential IDs exposed) |
| T8 | **DoS / cost bombing** | Flooding chat to burn LLM budget; upload floods; WS connection storms | Token-bucket rate limits (per user+IP+route), per-project daily USD circuit breaker, turn-depth/concurrency budgets, upload quotas, WAF rate rules, WS connection caps per user |
| T9 | **Supply chain** | Malicious dependency, compromised base image | Lockfile-only installs, Dependabot + osv-scanner, `pnpm audit` gate, pinned+digested base images, SBOM (syft) + cosign signing + admission verification |
| T10 | **Secret leakage** | Keys in code/logs/prompts | gitleaks pre-commit + CI full-history, dotenv-safe, secrets manager at runtime, log redaction filters, outbound-prompt secret-pattern scan, `credential_ref` indirection |
| T11 | **Insider/admin misuse** | Admin reads tenant data | Admin actions audit-logged + surfaced to org owners, no raw-DB access path in app, break-glass procedure documented |
| T12 | **Audit evasion** | Agent/user actions without trace | Append-only `audit_log` + Redis Stream mirror shipped to SIEM within 30 s; trace_id chain user→turn→tool→MCP |

---

## 2. STAGE A — Micro-security & development foundations (with Phase 1)

**A1. Repository hygiene (first commit):**
- `.gitignore` covers `.env*`, keys, coverage; `.env.example` documents every variable with
  dummy values; `dotenv-safe` fails boot on missing/extra vars.
- Pre-commit (husky + lint-staged): gitleaks, eslint (incl. `eslint-plugin-security`,
  boundaries), typecheck of staged packages, conventional-commit lint.
- Branch protection: PR-only to `main`, required checks (ci, security), signed commits encouraged.

**A2. CI security lane (`security.yml`), blocking from day one:**
- gitleaks (full history), Semgrep (owasp-top-ten + typescript rulesets), CodeQL weekly,
  osv-scanner + `pnpm audit --audit-level=high` (fail on high/critical),
  Dependabot weekly (npm, docker, actions).

**A3. Local environment isolation:**
- Everything runs in Docker Compose; no host-installed services; compose networks segment
  `data`, `app`, `mcp-isolated` (the last with `internal: true`); MinIO/Postgres/Redis bound to
  localhost only; distinct dev credentials that never resemble prod.

**A4. Secure-by-default app skeleton:**
- helmet-equivalent headers (Fastify): HSTS (preload in prod), `X-Content-Type-Options`,
  `Referrer-Policy: strict-origin-when-cross-origin`, frameguard deny (except artifact route),
  CSP nonce-based for the Next app.
- CORS: exact-origin allowlist (no wildcards), credentials-mode deliberate.
- Global ZodValidationPipe: every route body/query/param schema-validated; unknown keys stripped;
  problem+json errors with stable codes, zero stack traces.
- Structured logs (Pino) with redaction paths (`req.headers.authorization`, `*.password`, `*.token`).

## 3. STAGE B — AuthN/AuthZ & session security (Phase 1)

- Passwords: argon2id (m=19456, t=2, p=1), zxcvbn ≥ 3 enforced server-side, breach-list check
  (offline top-100k list at MVP).
- Sessions: access JWT 15 min (aud/iss/exp/nbf validated, EdDSA keys via JWKS, kid rotation);
  refresh token 30 d, `HttpOnly Secure SameSite=Lax` cookie, rotation-on-use, reuse ⇒ revoke
  token family + force re-login + audit event.
- Login abuse: per-account lockout (10 fails/15 min, exponential), per-IP token bucket, constant
  response times, generic errors (no enumeration), all attempts audited.
- 2FA: TOTP (otplib), secret AES-GCM-encrypted at rest, 10 single-use recovery codes (argon2
  hashed, shown once), 2FA required for admin accounts.
- Email verification mandatory before project creation; verification/reset tokens: 32-byte
  random, sha256-stored, 1 h TTL, single-use.
- AuthZ: `JwtAuthGuard` → `ProjectMemberGuard(role)` on every project route; WS handshake
  re-verifies JWT and every `room.join` re-checks membership server-side; API keys scoped+hashed.

## 4. STAGE C — Application & data-layer isolation (Phases 2–4)

- **RLS as specified in 05-doc §9**: FORCE on all tenant tables, non-owner app role, migrator
  role separation, `withTenant()` as the only DB entry point (lint rule bans raw `db.` outside
  `packages/db`).
- **Vector/graph/blob tenancy**: every `knowledge_chunks` query carries `project_id` predicate
  (verified by a pgTAP test asserting the planner uses the composite index); S3 keys prefixed
  `{projectId}/`, bucket policy denies `s3:GetObject` except via the API's presigner role;
  bus channels carry `:{projectId}` and the WS gateway refuses relay without a verified join.
- **Rate limiting matrix (Redis token buckets):**
  `auth/login 5/min/IP · message send 20/min/user · uploads 10/hour/user ·
  mcp calls 30/5min/persona · WS conns 5/user · admin API 60/min`.
- **File pipeline hard gates (ingestion worker, in order, fail-closed):**
  size cap → magic-byte sniff (`file-type`) must match declared MIME class → allowlist →
  ClamAV (fail = quarantine, scanner-down = queue paused, NOT bypass) → per-type disarm
  (sharp re-encode; pdf strip JS/embeds/launch actions; svg → sanitize or rasterize; zip:
  depth ≤ 2, ratio ≤ 100×, entries ≤ 1000) → only then extraction, inside a worker with no
  general egress.
- **Cross-tenant probe suite (CI, Phase 4 gate):** fixture tenants A/B; for every tenant table
  and every API route touching one, execute as B against A's IDs; assert 0 rows / 403/404;
  includes vector search, S3 presign attempts, WS join, and bus-relay probes.

## 5. STAGE D — Runtime & agent-execution security (Phases 3–4)

- Artifact sandbox and code-exec sandbox exactly per 01-doc §6.3 / threats T4–T5; sandbox images
  rebuilt weekly (patch cadence) and pinned by digest.
- MCP zero-trust path exactly per 04-doc §6 (grants → classification gates → capability JWT
  single-use → mTLS → audit). Connector containers: read-only rootfs, no shared volumes,
  deny-all egress + explicit manifest targets, distinct low-priv creds per connector per project.
- Prompt-side defenses: untrusted-content delimiters applied by ONE shared wrapper function
  (unit-tested against delimiter-breakout strings); outbound prompts scanned for secret patterns
  (AWS keys, JWTs, connection strings) — hits are redacted + alerted.
- Human-in-the-loop: approval flow (04-doc §4.4) with 15 min expiry default; approval decisions
  signed by user session and audit-logged with payload hash.
- Kill switches: per-project `agents_paused`, global admin pause, per-provider circuit breakers.

## 6. STAGE E — Infrastructure, deployment & late-stage hardening (Phase 5)

- **Network (Terraform `modules/network`):** VPC with 3 tiers — public (ALB/CloudFront origin
  only), private-app (ECS services; egress via NAT with FQDN allowlisting for LLM APIs),
  isolated (RDS, ElastiCache, MCP nodes, sandbox hosts; NO internet route; VPC endpoints for
  S3/SecretsManager/ECR). Security groups: least-privilege pairs (alb→api:3000,
  api→pg:5432, runtime→mcp:8801, …); MCP nodes additionally per-manifest egress rules.
- **Edge:** WAF (managed core rule set + SQLi/XSS + rate rules + bot control; count-mode in
  staging, block in prod), TLS 1.2+ only, HSTS preload, CloudFront in front of web + artifact
  origin isolation (separate distribution + domain for artifacts).
- **CI/CD:** GitHub OIDC → cloud role (no long-lived keys); pipeline: build → SBOM → trivy image
  scan (fail high) → cosign sign → push; deploy job verifies signature; secrets masked in logs;
  prod deploys require environment approval + are audit-events themselves; instant rollback =
  previous task-def revision.
- **Data:** RDS encrypted (KMS), automated backups (PITR 7 d) + weekly snapshot restore drill
  (scripted, verified checksum), Redis TLS+AUTH, S3 SSE-KMS + versioning + object-lock on
  audit exports.
- **Audit/SIEM:** `audit_log` → Redis Stream consumer → Firehose → S3 (object-locked) +
  OpenSearch/SIEM; dashboards: authn anomalies, approval denials, MCP call spikes, egress
  denials; alert routing to on-call.
- **Ops runbooks (docs deliverable in Phase 5):** incident response (sev matrix, containment =
  kill switches above), key rotation (JWKS 90 d, provider keys 90 d, capability signing 30 d),
  breach notification checklist, dependency-zero-day fast path.

## 7. Compliance posture (forward-looking, not blocking MVP)

- Data map + retention schedule maintained in this doc as tables evolve (05-doc §11 is the base).
- GDPR-ready primitives: user export (JSON bundle of owned data), account deletion (hard-delete
  user rows, tombstone authored nodes to `author redacted`), per-project data residency noted as
  future work.
- SOC2-trajectory controls already present by design: audit trail, access reviews (admin UI),
  change management via protected branches + CI, encryption everywhere, vendor list (LLM
  providers) documented in admin diagnostics.
