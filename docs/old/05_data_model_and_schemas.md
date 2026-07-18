# 05 — Data Model & Schemas

Column-level specification of the Postgres schema (Drizzle ORM + raw SQL migrations), the
conversation DAG model, vector layout, Row-Level Security policies, and the Zod event/WS contracts.
All `id` columns are `uuid DEFAULT gen_random_uuid()`. All tables get `created_at timestamptz
DEFAULT now()` and (where mutable) `updated_at` via trigger. Soft deletes (`deleted_at`) only where
noted — everything else is append-only or hard-delete-with-audit.

---

## 1. Identity & tenancy

```sql
users (
  id uuid PK,
  email citext UNIQUE NOT NULL,
  email_verified_at timestamptz,
  password_hash text,                 -- argon2id; NULL if OAuth-only
  display_name text NOT NULL,
  avatar_key text,                    -- S3 key, never a raw URL
  totp_secret_enc bytea,              -- AES-GCM encrypted, NULL = 2FA off
  is_admin boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active'  -- active | suspended
)

auth_sessions (
  id uuid PK, user_id uuid FK→users ON DELETE CASCADE,
  refresh_token_hash text NOT NULL,   -- sha256; token itself only in HttpOnly cookie
  user_agent text, ip inet,
  expires_at timestamptz NOT NULL, revoked_at timestamptz,
  rotated_from uuid                   -- refresh-token rotation chain; reuse ⇒ revoke family
)

orgs ( id uuid PK, name text NOT NULL, slug citext UNIQUE, owner_id uuid FK→users )

org_members (
  org_id uuid FK→orgs, user_id uuid FK→users,
  role text NOT NULL CHECK (role IN ('owner','admin','member')),
  PRIMARY KEY (org_id, user_id)
)

projects (
  id uuid PK, org_id uuid FK→orgs NOT NULL,
  name text NOT NULL, description text,
  settings jsonb NOT NULL DEFAULT '{}',   -- token budgets, default branch policy, etc.
  archived_at timestamptz
)

project_members (
  project_id uuid FK→projects, user_id uuid FK→users,
  role text NOT NULL CHECK (role IN ('owner','editor','viewer')),
  PRIMARY KEY (project_id, user_id)
)
```

## 2. Agents & policies

```sql
agent_personas (
  id uuid PK,
  scope text NOT NULL CHECK (scope IN ('global','project')),
  project_id uuid FK→projects,        -- NULL when scope='global' (built-in C-Suite)
  tier text NOT NULL CHECK (tier IN ('csuite','specialist','pa')),
  slug text NOT NULL,                 -- 'cto', 'cmo', 'worker.code-reviewer'...
  name text NOT NULL, title text,     -- "Vera Stone", "Chief Technology Officer"
  avatar_key text, color text,
  system_prompt_tpl text NOT NULL,    -- handlebars-lite template (see 08_agent_personas)
  expertise_tags text[] NOT NULL,     -- drives relevance scoring
  speak_profile jsonb NOT NULL,       -- {eagerness, interrupt_threshold, silence_bias}
  delegation_authority jsonb NOT NULL,-- which worker types + budget caps it may spawn
  tool_allowlist text[] NOT NULL,     -- tool names this persona may use
  enabled boolean NOT NULL DEFAULT true,
  UNIQUE (scope, project_id, slug)
)

agent_model_policies (               -- ModelPolicy (see 01 §4); hot-reloaded by runtime
  id uuid PK,
  persona_id uuid FK→agent_personas UNIQUE,
  tier text NOT NULL,
  primary_provider text NOT NULL, primary_model text NOT NULL,
  fallbacks jsonb NOT NULL DEFAULT '[]',
  max_input_tokens int NOT NULL, max_output_tokens int NOT NULL,
  temperature real NOT NULL DEFAULT 0.7,
  per_turn_usd numeric(8,4) NOT NULL, per_day_usd numeric(8,2) NOT NULL,
  prompt_caching boolean NOT NULL DEFAULT true
)

project_agents (                     -- roster: which personas are "hired" into a project
  project_id uuid FK→projects, persona_id uuid FK→agent_personas,
  hired_at timestamptz DEFAULT now(),
  PRIMARY KEY (project_id, persona_id)
)
```

## 3. Rooms & conversations (the DAG)

```sql
rooms (
  id uuid PK, project_id uuid FK→projects NOT NULL,
  type text NOT NULL CHECK (type IN ('conference','meeting','call','office','system')),
  name text NOT NULL,                 -- "Conference Room", "Pricing War-Room", "1:1 — CTO"
  created_by uuid FK→users,
  archived_at timestamptz,
  UNIQUE (project_id, type) WHERE type = 'conference'   -- exactly one conference room
)

room_participants (                  -- users AND agents; drives turn-engine roster
  room_id uuid FK→rooms,
  participant_kind text NOT NULL CHECK (participant_kind IN ('user','agent')),
  user_id uuid FK→users, persona_id uuid FK→agent_personas,
  CHECK ((participant_kind='user') = (user_id IS NOT NULL)),
  PRIMARY KEY (room_id, participant_kind, COALESCE(user_id, persona_id))
)

conversations (
  id uuid PK, room_id uuid FK→rooms NOT NULL, project_id uuid NOT NULL,  -- denorm for RLS
  title text,                         -- utility-tier generated
  default_branch_id uuid              -- FK→branches (deferred)
)

conversation_nodes (                  -- APPEND-ONLY. The DAG vertices.
  id uuid PK,
  conversation_id uuid FK→conversations NOT NULL,
  project_id uuid NOT NULL,           -- denorm for RLS + hot-path filters
  parent_id uuid FK→conversation_nodes,        -- NULL = root
  depth int NOT NULL,                          -- parent.depth + 1 (trigger-maintained)
  path ltree NOT NULL,                         -- materialized path for fast ancestor slices
  type text NOT NULL CHECK (type IN (
    'user_message','agent_message','system_event','interrupt','summon',
    'delegation_report','artifact_ref','file_ref','branch_point_marker')),
  author_kind text NOT NULL CHECK (author_kind IN ('user','agent','system')),
  author_user_id uuid, author_persona_id uuid,
  content jsonb NOT NULL,             -- {text, mentions[], attachments[], meta} (Zod-validated)
  token_usage jsonb,                  -- {in, out, model, usd} for agent messages
  created_at timestamptz NOT NULL DEFAULT now()
)
-- Indexes: (conversation_id, path gist), (conversation_id, parent_id), (project_id, created_at)
-- Trigger: reject UPDATE/DELETE (append-only); maintain depth/path; cycle guard on node_links.

node_links (                          -- cross-branch references ⇒ full DAG
  from_node uuid FK→conversation_nodes, to_node uuid FK→conversation_nodes,
  kind text NOT NULL CHECK (kind IN ('reference','merge_summary','duplicate_of')),
  PRIMARY KEY (from_node, to_node)
)                                     -- BEFORE INSERT trigger: DFS cycle check (bounded depth 10k)

branches (                            -- git-ref-like named leaf pointers
  id uuid PK, conversation_id uuid FK→conversations NOT NULL, project_id uuid NOT NULL,
  name text NOT NULL,                 -- 'main', 'alt: aggressive pricing', auto-named
  head_node_id uuid FK→conversation_nodes NOT NULL,
  forked_from_node uuid FK→conversation_nodes,   -- branch point
  created_by_kind text NOT NULL, created_by_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','merged','abandoned')),
  UNIQUE (conversation_id, name)
)
-- "Active branch" per user per conversation is client state (last_viewed in user_room_state).

user_room_state (                     -- read cursors, active branch, collapsed panes
  user_id uuid, room_id uuid, conversation_id uuid,
  active_branch_id uuid, last_read_node_id uuid,
  PRIMARY KEY (user_id, room_id, conversation_id)
)
```

**DAG operations contract (service layer, `conversations` module):**
- `appendNode(convId, branchId, parentId?, payload)` — parent defaults to branch head; advances
  branch head atomically (`UPDATE branches SET head_node_id ... WHERE head_node_id = expected`
  optimistic-concurrency; on conflict, auto-fork `parallel-{n}` branch — this is how two agents
  answering simultaneously produce sibling branches instead of colliding).
- `fork(convId, fromNodeId, name?)` — new branch pointing at `fromNodeId`.
- `slice(branchId, tokenBudget)` — walk `path` ancestors from head until budget; the PA engine's
  raw window input.
- `graph(convId)` — nodes+edges+branches for the React Flow view (paginated by subtree).

## 4. Artifacts

```sql
artifacts (
  id uuid PK, project_id uuid NOT NULL, conversation_id uuid,
  created_by_persona uuid FK→agent_personas, created_by_user uuid FK→users,
  kind text NOT NULL CHECK (kind IN ('code','react','html','document','markdown','svg','mermaid','csv')),
  title text NOT NULL,
  current_version int NOT NULL DEFAULT 1
)

artifact_versions (
  artifact_id uuid FK→artifacts, version int,
  content_key text NOT NULL,          -- S3 key (content NOT in Postgres; keeps DB lean)
  content_sha256 text NOT NULL,
  size_bytes int NOT NULL CHECK (size_bytes <= 2*1024*1024),
  created_by_node uuid FK→conversation_nodes,   -- provenance
  PRIMARY KEY (artifact_id, version)
)
```

## 5. Files, sources & knowledge layer

```sql
files (
  id uuid PK, project_id uuid NOT NULL, uploaded_by uuid FK→users,
  room_id uuid FK→rooms,              -- where it was uploaded (context origin)
  name text NOT NULL, declared_mime text NOT NULL, detected_mime text,
  size_bytes bigint NOT NULL,
  storage_key text NOT NULL,          -- staging/... then clean/{projectId}/... or quarantine/...
  scan_status text NOT NULL DEFAULT 'pending'
    CHECK (scan_status IN ('pending','scanning','clean','quarantined','failed')),
  scan_report jsonb
)

knowledge_sources (
  id uuid PK, project_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('github_repo','gitlab_repo','sql_database','url','manual')),
  config jsonb NOT NULL,              -- repo url+branch / conn params (SECRET REF ONLY) / url
  credential_ref text,                -- pointer into secrets manager; NEVER raw credentials
  sync_schedule text,                 -- cron expr or NULL (manual)
  last_sync_at timestamptz, last_sync_status text
)

ingestion_jobs (
  id uuid PK, project_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('file','source_sync','note_delta')),
  file_id uuid FK→files, source_id uuid FK→knowledge_sources, note_id uuid,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','security_gate','extracting','chunking','embedding','done','failed','quarantined')),
  stats jsonb, error text
)

knowledge_chunks (                    -- THE vector store (pgvector)
  id uuid PK, project_id uuid NOT NULL,
  origin text NOT NULL CHECK (origin IN ('upload','source','ceo_office','conversation_summary','artifact')),
  origin_id uuid NOT NULL,            -- file/source/note/conversation/artifact id
  chunk_index int NOT NULL,
  heading_trail text[],               -- ["Architecture","Data layer"] breadcrumb
  content text NOT NULL,              -- the chunk text (≤ ~2k chars)
  content_tsv tsvector GENERATED,     -- for BM25-ish lexical leg of hybrid search
  embedding vector(1536),             -- dimension configurable per deployment; HNSW index
  token_count int NOT NULL,
  stale boolean NOT NULL DEFAULT false,  -- set by note-delta before re-embed
  UNIQUE (origin, origin_id, chunk_index)
)
-- Indexes: HNSW (embedding vector_cosine_ops) WHERE NOT stale; GIN (content_tsv);
--          (project_id, origin) btree.  ALL queries filter project_id FIRST (RLS + planner).
```

## 6. CEO's Office notes

```sql
notes (
  id uuid PK, project_id uuid NOT NULL, author_id uuid FK→users,
  title text NOT NULL, 
  content_md text NOT NULL,           -- canonical markdown (TipTap serializes to md)
  content_json jsonb,                 -- ProseMirror doc for lossless editing
  folder_path text NOT NULL DEFAULT '/',
  is_daily boolean NOT NULL DEFAULT false,
  deleted_at timestamptz              -- soft delete (trash)
)

note_links (                          -- [[wikilink]] backlink index, maintained on save
  from_note uuid FK→notes, to_note uuid FK→notes,
  PRIMARY KEY (from_note, to_note)
)
```

## 7. Orchestration state

```sql
delegations (
  id uuid PK, project_id uuid NOT NULL,
  group_id uuid NOT NULL,             -- cross-worker collaboration group
  parent_persona_id uuid FK→agent_personas NOT NULL,   -- delegating C-Suite agent
  worker_persona_id uuid FK→agent_personas NOT NULL,
  origin_node_id uuid FK→conversation_nodes,           -- provenance in the conversation
  spec jsonb NOT NULL,                -- {objective, inputs[], deliverable, constraints}
  budget jsonb NOT NULL,              -- {maxUsd, maxSeconds, maxToolCalls}
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','waiting_approval','completed','failed','cancelled','timeout')),
  result jsonb,                       -- {report_md, artifact_ids[], usage}
  started_at timestamptz, finished_at timestamptz
)

agent_working_memory (                -- PA-maintained per (persona, conversation) state
  persona_id uuid, conversation_id uuid, project_id uuid NOT NULL,
  facts jsonb NOT NULL DEFAULT '[]',        -- [{text, source_node, confidence, ts}]
  open_loops jsonb NOT NULL DEFAULT '[]',   -- promises/questions awaiting this agent
  last_summary_node uuid, summary_md text,  -- rolling summary (utility-tier generated)
  updated_at timestamptz,
  PRIMARY KEY (persona_id, conversation_id)
)

graph_checkpoints (                   -- LangGraph checkpointer table
  thread_id text PK,                  -- '{conversationId}:{branchId}:{personaId}:{turnId}'
  checkpoint bytea NOT NULL, metadata jsonb, updated_at timestamptz
)

approvals (                           -- human-in-the-loop gates for write-scoped tools
  id uuid PK, project_id uuid NOT NULL,
  requested_by_persona uuid NOT NULL, delegation_id uuid FK→delegations,
  action_summary text NOT NULL,       -- "Write file README.md to connected repo X"
  payload_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','expired')),
  decided_by uuid FK→users, decided_at timestamptz, expires_at timestamptz NOT NULL
)

mcp_connectors (
  id uuid PK, scope text CHECK (scope IN ('global','project')), project_id uuid,
  slug text NOT NULL, name text NOT NULL,
  endpoint text NOT NULL,             -- internal DNS of the isolated node
  manifest jsonb NOT NULL,            -- validated connector manifest (tools, scopes) — see 04 §6
  enabled boolean NOT NULL DEFAULT true
)

mcp_grants (                          -- zero-trust: persona × connector × scopes
  persona_id uuid, connector_id uuid, project_id uuid NOT NULL,
  scopes text[] NOT NULL,             -- ['fs.read','db.query'] — never '*'
  requires_approval boolean NOT NULL DEFAULT true,   -- for any write-classified scope
  granted_by uuid FK→users, PRIMARY KEY (persona_id, connector_id, project_id)
)
```

## 8. Audit & usage

```sql
audit_log (                           -- APPEND-ONLY; also mirrored to Redis Stream → SIEM
  id bigserial PK, ts timestamptz NOT NULL DEFAULT now(),
  project_id uuid, actor_kind text NOT NULL, actor_id uuid,
  action text NOT NULL,               -- 'auth.login','node.create','mcp.call','approval.decide'...
  target_kind text, target_id uuid,
  ip inet, meta jsonb NOT NULL DEFAULT '{}',   -- args hash, result size — never raw secrets
  trace_id text                       -- OTel correlation
) PARTITION BY RANGE (ts);            -- monthly partitions

token_usage (
  id bigserial PK, ts timestamptz DEFAULT now(),
  project_id uuid NOT NULL, persona_id uuid, conversation_id uuid,
  provider text, model text, input_tokens int, output_tokens int,
  cached_tokens int, usd numeric(10,6),
  kind text CHECK (kind IN ('turn','delegation','summary','embedding','utility'))
)
```

---

## 9. Row-Level Security (RLS)

Every request path sets GUCs inside a transaction via `withTenant()`:

```sql
SET LOCAL app.user_id = '<uuid>';
SET LOCAL app.project_id = '<uuid|NULL>';   -- NULL for cross-project dashboard queries
```

Policy pattern (applied to EVERY table carrying `project_id` — nodes, branches, rooms, files,
chunks, notes, delegations, artifacts, approvals, working memory, usage):

```sql
ALTER TABLE conversation_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_nodes FORCE ROW LEVEL SECURITY;   -- applies to table owner too

CREATE POLICY tenant_isolation ON conversation_nodes
  USING (project_id IN (
    SELECT pm.project_id FROM project_members pm
    WHERE pm.user_id = current_setting('app.user_id')::uuid
  ));
-- Hot paths additionally: AND project_id = current_setting('app.project_id')::uuid
```

Rules:
1. The app connects as `bramha_app` (NOT owner, NOT superuser); `FORCE ROW LEVEL SECURITY` on all
   tenant tables; a separate `bramha_migrator` role runs migrations.
2. Agent-runtime workers act *on behalf of* a project: they set `app.user_id` to the reserved
   `system_agent` user which `project_members` grants per-project via a `system_memberships` view —
   workers can never read outside the project their job belongs to.
3. `users`, `auth_sessions`, `orgs` use user-scoped policies (`id = app.user_id` /
   membership joins). Admin endpoints use a `bramha_admin` role + `is_admin` check, still logged.
4. CI runs an automated **cross-tenant probe suite**: for every tenant table, attempt reads/writes
   as tenant B against tenant A fixtures; any row returned = build failure (Phase 4 task).

## 10. Event & WS contracts (Zod, in `packages/shared`)

```ts
// events/conv.ts (excerpt — all payloads share {projectId, conversationId, ts, traceId})
ConvNodeCreated   = { nodeId, branchId, parentId, type, authorKind, authorId }
ConvStreamChunk   = { turnId, personaId, branchId, channel: 'thought'|'content', seq, delta }
ConvAgentStatus   = { personaId, state: 'idle'|'thinking'|'speaking'|'invoking_subagent'|
                      'reading_mcp'|'running_code'|'generating_artifact'|'waiting_approval',
                      detail?: string }
ConvInterrupt     = { byKind:'user'|'agent', byId, targetPersonaId?, reason:'summon'|'stop'|'redirect',
                      atNodeId }
DelegationEvent   = { delegationId, groupId, status, progressPct?, note? }
IngestEvent       = { jobId, fileId?, sourceId?, status, error? }
ArtifactStream    = { artifactId, version, seq, delta, done: boolean }
ApprovalRequested = { approvalId, personaId, actionSummary, expiresAt }

// ws-protocol.ts — client⇄server
Client→Server: room.join{roomId}, room.leave, node.compose.typing, interrupt.raise{...},
               branch.switch{branchId}, approval.decide{approvalId, decision}
Server→Client: every bus event above, scoped: socket joins channels
               `proj:{projectId}:room:{roomId}` only after WsAuthGuard verifies membership.
```

## 11. Retention & housekeeping

- `audit_log` partitions: 13 months hot, then export to S3 Glacier (SIEM already has a copy).
- `graph_checkpoints`: deleted 7 days after turn completion (housekeeping queue).
- `files` in `quarantine/`: purged after 30 days; `staging/` orphans after 24 h.
- `knowledge_chunks` where `stale=true` older than 1 h: deleted after replacement chunks land.
- Token usage aggregated nightly into `token_usage_daily` materialized view for dashboards.
