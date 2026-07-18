# BramhaV2 — MVP Data Model

## 1. Entity overview

```
users ─┬─ org_members ─── orgs ─── projects ─┬─ project_members
       │                                     ├─ rooms ─┬─ conversation_nodes (tree)
       └─ sessions                           │         └─ branches (head pointers)
                                             ├─ files ─┬─ file_chunks (vectors)
                                             │         └─ ingestion_jobs
                                             ├─ delegation_tasks
                                             └─ model_calls
```

Every tenant-scoped table carries `project_id` directly (denormalized on purpose) so `withTenant()` can enforce scoping with a single predicate and hybrid search never joins four tables to check access.

## 2. DAG semantics (read this before touching conversation code)

- **Nodes form a tree** via `parent_id`. A node belongs to a room, **not** to a branch.
- **A branch is only a named head pointer.** The thread a branch shows = walk `parent_id` from `head_node_id` up to the root, reversed. History shared between branches is stored **once** — forking copies nothing.
- **Send message on branch B:** insert node with `parent_id = B.head_node_id`, then `UPDATE branches SET head_node_id = <new node> WHERE id = B.id AND head_node_id = <expected>` (optimistic — 0 rows updated means a concurrent advance; auto-fork a new branch instead of clobbering).
- **Branch off node N:** insert a branch with `head_node_id = N`, `forked_from_node_id = N`. That's the whole operation.
- Agent responses append as children of the user node on the same branch, in relevance-score order.

Thread read (recursive CTE up the ancestry — bounded by depth, not room size):

```sql
WITH RECURSIVE thread AS (
  SELECT n.*, 0 AS rev
  FROM conversation_nodes n WHERE n.id = $head_node_id
  UNION ALL
  SELECT p.*, t.rev + 1
  FROM conversation_nodes p JOIN thread t ON p.id = t.parent_id
)
SELECT * FROM thread ORDER BY rev DESC;   -- root first
```

## 3. Tables

Types abbreviated; all PKs `uuid DEFAULT gen_random_uuid()`, all tables get `created_at timestamptz NOT NULL DEFAULT now()`.

### users
| col | type | notes |
|---|---|---|
| email | text UNIQUE | citext-style lowercased in app |
| name | text | |
| password_hash | text | argon2id |
| email_verified_at | timestamptz | set = now() at registration (MVP auto-verify) |

### sessions
| col | type | notes |
|---|---|---|
| user_id | uuid → users | |
| token_hash | text UNIQUE | SHA-256 of opaque cookie token |
| expires_at | timestamptz | sliding 7-day window |

### orgs / org_members
`orgs(name, slug UNIQUE, created_by)` · `org_members(org_id, user_id, role ∈ owner|admin|member, PK(org_id,user_id))`

### projects / project_members
`projects(org_id, name, slug, description, working_memory jsonb DEFAULT '{}', proactive_pa_enabled bool DEFAULT false, UNIQUE(org_id,slug))`
`project_members(project_id, user_id, role ∈ owner|editor|viewer, PK(project_id,user_id))`

`working_memory` holds PA-lite open-loop items (`03_mvp_agents.md` §7).

### rooms
| col | type | notes |
|---|---|---|
| project_id | uuid → projects | |
| name | text | |
| kind | text ∈ council\|one_on_one | one_on_one gets `persona` col set; PA-lite only fires here |
| persona | text NULL | required when kind=one_on_one |
| main_branch_id | uuid → branches | set right after root branch insert |

### conversation_nodes
| col | type | notes |
|---|---|---|
| room_id | uuid → rooms | |
| project_id | uuid → projects | denormalized for withTenant |
| parent_id | uuid → conversation_nodes NULL | NULL = room root |
| author_type | text ∈ user\|agent\|system | |
| user_id | uuid → users NULL | when author_type=user |
| persona | text NULL | slug, when author_type=agent |
| content | text | raw markdown |
| metadata | jsonb DEFAULT '{}' | citations[], delegation{from,taskId}, artifact{html} |

Indexes: `(room_id)`, `(parent_id)`, `(project_id)`.

### branches
| col | type | notes |
|---|---|---|
| room_id | uuid → rooms | |
| project_id | uuid | denormalized |
| name | text | "main", else user-named |
| head_node_id | uuid → conversation_nodes NULL | NULL only before first message |
| forked_from_node_id | uuid NULL | NULL for main |
| created_by | uuid → users | |

### files
| col | type | notes |
|---|---|---|
| project_id | uuid | |
| uploaded_by | uuid → users | |
| filename / mime_type / size_bytes | | mime from magic bytes, not client |
| storage_path | text | disk path (MVP); S3 key later |
| status | text ∈ pending\|processing\|ready\|error | |
| error_msg | text NULL | |

### file_chunks
| col | type | notes |
|---|---|---|
| file_id | uuid → files ON DELETE CASCADE | |
| project_id | uuid | denormalized — search never joins files for scoping |
| chunk_index | int | |
| content | text | |
| embedding | vector(1536) | text-embedding-3-small |
| tsv | tsvector GENERATED (english, content) STORED | |

Indexes: `hnsw (embedding vector_cosine_ops)` · `GIN (tsv)` · `(file_id, chunk_index)`.

### ingestion_jobs
`(file_id, status ∈ queued|running|done|failed, attempt int DEFAULT 0, error_msg, started_at, finished_at)`

Claimed in-process every 2 s:

```sql
UPDATE ingestion_jobs SET status='running', started_at=now(), attempt=attempt+1
WHERE id = (SELECT id FROM ingestion_jobs WHERE status='queued'
            ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
RETURNING *;
```

`FOR UPDATE SKIP LOCKED` keeps this correct if the server ever runs >1 instance. Max 3 attempts → `failed` + `files.status='error'`.

### delegation_tasks
`(room_id, project_id, source_node_id, from_persona, to_persona, task text, status ∈ pending|running|done|failed, result_node_id NULL)`

### model_calls
`(project_id, room_id NULL, persona NULL, provider, model, purpose ∈ turn|delegation|embedding|proactive, input_tokens, output_tokens, latency_ms)` — powers the "silent agents cost zero" assertion and the demo cost story.

## 4. Hybrid search (the exact query behind `searchKnowledge`)

Reciprocal Rank Fusion over a vector leg and a lexical leg; k=60 constant.

```sql
WITH vec AS (
  SELECT id, row_number() OVER (ORDER BY embedding <=> $qvec) AS r
  FROM file_chunks WHERE project_id = $project_id
  ORDER BY embedding <=> $qvec LIMIT 30
),
lex AS (
  SELECT id, row_number() OVER (ORDER BY ts_rank_cd(tsv, q) DESC) AS r
  FROM file_chunks, websearch_to_tsquery('english', $qtext) q
  WHERE project_id = $project_id AND tsv @@ q
  LIMIT 30
),
fused AS (
  SELECT COALESCE(vec.id, lex.id) AS id,
         COALESCE(1.0/(60+vec.r), 0) + COALESCE(1.0/(60+lex.r), 0) AS score
  FROM vec FULL OUTER JOIN lex USING (id)
)
SELECT c.id, c.content, c.chunk_index, f.filename, fused.score
FROM fused JOIN file_chunks c ON c.id = fused.id
JOIN files f ON f.id = c.file_id
ORDER BY fused.score DESC LIMIT $k;
```

`websearch_to_tsquery` (not `to_tsquery`) — user/agent text is free-form and must not throw on syntax.

## 5. withTenant (`packages/db`)

```ts
export async function withTenant<T>(
  ctx: { projectId: string; userId: string },
  fn: (db: TenantDb) => Promise<T>,
): Promise<T>
```

- The **only** query entry point exported for tenant data. Raw client is package-private.
- `TenantDb` exposes per-table helpers that inject `WHERE project_id = ctx.projectId`; it does not expose `db.execute` with arbitrary SQL — the hybrid-search and CTE queries live inside `packages/db` as named functions.
- Membership is checked by `ProjectMemberGuard` before `ctx` is ever constructed; `withTenant` scopes, guards authorize.
- RLS deferred (accepted risk, `01_mvp_architecture.md` §8).

## 6. Migrations

- Raw SQL files: `packages/db/src/migrations/00xx_name.sql`, starting **0001** (fresh schema — v0's 0001–0026 live only on the archive branch).
- Runner: tiny in-package script, `schema_migrations(version PK, applied_at)` bookkeeping table; each file runs in a transaction.
- Applied migrations are immutable — changes are new numbered files.
- Same files run on PGlite (local) and managed Postgres (deployed); no dialect forks. `CREATE EXTENSION IF NOT EXISTS vector` is migration 0001 line 1.
