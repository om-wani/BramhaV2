# MVP Data Model

## Schema overview

```
users
 └─ org_members ──► orgs
                     └─ project_members ──► projects
                                             └─ rooms
                                                 └─ conversation_nodes (DAG)
                                                     └─ branches
                                             └─ files
                                                 └─ file_chunks (vectors)
                                             └─ delegation_tasks
```

## Tables

### users
```sql
id          uuid PK default gen_random_uuid()
email       text UNIQUE NOT NULL
name        text NOT NULL
password_hash text NOT NULL          -- argon2id
email_verified_at timestamptz        -- NULL = auto-verified in MVP
created_at  timestamptz default now()
```

### orgs
```sql
id          uuid PK
name        text NOT NULL
slug        text UNIQUE NOT NULL
created_by  uuid REFERENCES users(id)
created_at  timestamptz default now()
```

### org_members
```sql
org_id      uuid REFERENCES orgs(id)
user_id     uuid REFERENCES users(id)
role        text NOT NULL CHECK (role IN ('owner','admin','member'))
joined_at   timestamptz default now()
PRIMARY KEY (org_id, user_id)
```

### projects
```sql
id          uuid PK
org_id      uuid REFERENCES orgs(id) NOT NULL
name        text NOT NULL
slug        text NOT NULL
description text
created_by  uuid REFERENCES users(id)
created_at  timestamptz default now()
UNIQUE (org_id, slug)
```

### project_members
```sql
project_id  uuid REFERENCES projects(id)
user_id     uuid REFERENCES users(id)
role        text NOT NULL CHECK (role IN ('owner','editor','viewer'))
joined_at   timestamptz default now()
PRIMARY KEY (project_id, user_id)
```

### rooms
```sql
id          uuid PK
project_id  uuid REFERENCES projects(id) NOT NULL
name        text NOT NULL
created_by  uuid REFERENCES users(id)
created_at  timestamptz default now()
```

### conversation_nodes
```sql
id          uuid PK default gen_random_uuid()
room_id     uuid REFERENCES rooms(id) NOT NULL
branch_id   uuid REFERENCES branches(id) NOT NULL
parent_id   uuid REFERENCES conversation_nodes(id)   -- NULL = root
depth       int NOT NULL default 0
author_type text NOT NULL CHECK (author_type IN ('user','agent','system'))
author_id   uuid            -- user_id or persona slug stored as text
persona     text            -- e.g. 'ceo', 'cto'
content     text NOT NULL
content_html text           -- sanitized render cache
metadata    jsonb default '{}'
created_at  timestamptz default now()
```

Index: `(room_id, branch_id, depth)`, `(parent_id)`

Subtree query (recursive CTE):
```sql
WITH RECURSIVE subtree AS (
  SELECT * FROM conversation_nodes WHERE id = $root
  UNION ALL
  SELECT n.* FROM conversation_nodes n
  JOIN subtree s ON n.parent_id = s.id
  WHERE n.branch_id = $branch_id
)
SELECT * FROM subtree ORDER BY depth, created_at;
```

### branches
```sql
id          uuid PK default gen_random_uuid()
room_id     uuid REFERENCES rooms(id) NOT NULL
name        text
head_node_id uuid REFERENCES conversation_nodes(id)  -- latest node on branch
forked_from_node_id uuid REFERENCES conversation_nodes(id)
created_by  uuid REFERENCES users(id)
created_at  timestamptz default now()
```

Branch ops:
- **Create branch**: insert branch row with `forked_from_node_id`, copy lineage up to fork node
- **Advance head**: `UPDATE branches SET head_node_id = $new_node WHERE id = $branch_id`
- **Auto-fork**: any branch-off action creates new branch, user stays on new branch

### files
```sql
id          uuid PK
project_id  uuid REFERENCES projects(id) NOT NULL
uploaded_by uuid REFERENCES users(id)
filename    text NOT NULL
mime_type   text NOT NULL
size_bytes  bigint NOT NULL
storage_path text NOT NULL   -- local disk path (MVP) or S3 key (prod)
status      text NOT NULL CHECK (status IN ('pending','processing','ready','error'))
error_msg   text
created_at  timestamptz default now()
```

### file_chunks
```sql
id          uuid PK
file_id     uuid REFERENCES files(id) NOT NULL
chunk_index int NOT NULL
content     text NOT NULL
embedding   vector(1536)     -- text-embedding-3-small
tsv         tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
created_at  timestamptz default now()
```

Index: `USING hnsw (embedding vector_cosine_ops)`, `USING GIN (tsv)`

### ingestion_jobs
```sql
id          uuid PK
file_id     uuid REFERENCES files(id) NOT NULL
status      text NOT NULL CHECK (status IN ('queued','running','done','failed'))
attempt     int NOT NULL default 0
error_msg   text
queued_at   timestamptz default now()
started_at  timestamptz
finished_at timestamptz
```

Polled in-process (no BullMQ). Worker queries `WHERE status = 'queued' ORDER BY queued_at LIMIT 1` on interval.

### delegation_tasks
```sql
id          uuid PK
room_id     uuid REFERENCES rooms(id) NOT NULL
parent_node_id uuid REFERENCES conversation_nodes(id) NOT NULL
delegating_persona text NOT NULL
target_persona     text NOT NULL
task_description   text NOT NULL
result_node_id     uuid REFERENCES conversation_nodes(id)
status      text NOT NULL CHECK (status IN ('pending','running','done','failed'))
created_at  timestamptz default now()
```

## Hybrid search

```sql
-- RRF fusion: vector cosine + BM25 tsvector
WITH vector_ranked AS (
  SELECT id, chunk_index, content, file_id,
         ROW_NUMBER() OVER (ORDER BY embedding <=> $query_vec) AS rank
  FROM file_chunks
  JOIN files ON files.id = file_chunks.file_id
  WHERE files.project_id = $project_id
  ORDER BY embedding <=> $query_vec
  LIMIT 40
),
text_ranked AS (
  SELECT id, chunk_index, content, file_id,
         ROW_NUMBER() OVER (ORDER BY ts_rank_cd(tsv, query) DESC) AS rank,
         ts_headline('english', content, query) AS headline
  FROM file_chunks, to_tsquery('english', $query_text) query
  JOIN files ON files.id = file_chunks.file_id
  WHERE files.project_id = $project_id
    AND tsv @@ query
  LIMIT 40
)
SELECT
  COALESCE(v.id, t.id) AS id,
  COALESCE(v.content, t.content) AS content,
  1.0/(60 + COALESCE(v.rank, 1000)) + 1.0/(60 + COALESCE(t.rank, 1000)) AS rrf_score
FROM vector_ranked v
FULL OUTER JOIN text_ranked t ON v.id = t.id
ORDER BY rrf_score DESC
LIMIT $k;
```

## Migration convention

Files: `packages/db/src/migrations/00xx_name.sql`
Next migration number: `0001` (fresh schema for MVP build).
Never edit applied migrations. Add new numbered file for changes.

## withTenant pattern

```typescript
// packages/db/src/index.ts
export async function withTenant<T>(
  fn: (db: DrizzleDb) => Promise<T>,
  ctx: { projectId: string; userId: string }
): Promise<T> {
  // app-level ctx passed to all queries; all tables have project_id column
  return fn(drizzleDb);  // RLS deferred to productionization
}
```

All feature modules import `withTenant` only. Raw `sql` client never exported.
