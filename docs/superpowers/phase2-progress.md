# Phase 2 Progress Log

Last updated: 2026-07-09

## Status: COMPLETE ✅

All 12 tasks (T2.1.1–T2.4.2) committed. Phase 3 (Multi-Agent Orchestration Engine) is next.

---

## Completed tasks

### T2.1.1 — DAG schema + append-only machinery ✅
Commits: `bba71d8`, `7c2e38f`, `9deaecf`

Files:
- `packages/db/src/migrations/0006_dag.sql` — 7 tables, 3 triggers, RLS, GRANTs
- `packages/db/src/schema/conversations.ts` — Drizzle ORM schema
- `packages/db/src/schema/conversations.test.ts` — 23 vitest tests

Key fixes: `pg_trigger_depth()` cascade guard, cycle-limit raises exception, `node_links_isolation` WITH CHECK on both nodes, `branches.created_by_kind` constraint.

---

### T2.1.2 — Conversation service + REST API ✅
Commits: `8cd6492`, `0e6717e`, `9891016`

Files:
- `packages/shared/src/schemas/conversations.ts`
- `apps/api/src/modules/common/redis/redis.module.ts`
- `apps/api/src/modules/rooms/` — module, controller, service
- `apps/api/src/modules/conversations/` — module, controller, service, e2e spec

Key fixes: ltree `@>` direction, Lua atomic rate-limit, idempotency result inside `db.run()`, parallel-${nodeId.slice(0,8)} fork name, composite `(created_at, id)` cursor, `Buffer.byteLength`.

---

### T2.1.3 — Event bus package + realtime gateway ✅
Commits: `2981058`, `db78b87`

Files:
- `packages/event-bus/src/index.ts` — typed pub/sub, EventPublisher/Subscriber
- `apps/api/src/modules/realtime/realtime.gateway.ts` — Socket.IO, 64kB cap, 5-socket-per-user Lua cap
- `apps/api/src/modules/realtime/ws-auth.guard.ts` — JWT verify on handshake
- `apps/api/src/modules/realtime/event-relay.service.ts` — event-bus → socket room relay
- `apps/api/src/modules/realtime/sse.controller.ts` — SSE fallback + 15s heartbeat + Last-Event-ID resume

Key fixes: TOCTOU socket cap via Lua EVAL, Zod validation on all incoming frames, event-bus tests.

---

### T2.1.4 — Chat room UI with branching ✅
Commits: `0f58714`, `6e7dabd`, `61b290c`

Files:
- `apps/web/app/(app)/p/[projectId]/room/[roomId]/page.tsx`
- `apps/web/components/room/` — ChatRoom, MessageBubble, BranchSelector, TypingIndicator

Key fix: typing indicator keyed on userId not displayName.

---

### T2.1.5 — Graph view ✅
Commits: `3a10a78`, `42484ce`, `1e496d4`

Files:
- `apps/web/app/(app)/p/[projectId]/graph/page.tsx`
- `apps/web/components/graph/ConversationGraph.tsx` — @xyflow/react DAG visualizer

Key fixes: fadeIn keyframe in Tailwind config, 3 code-quality fixes in ConversationGraph.

---

### T2.2.1 — Artifact schema + streaming API ✅
Commits: `ae4735d`, `8ea0508`, `f58774a`

Files:
- `packages/db/src/migrations/0007_artifacts.sql`
- `apps/api/src/modules/artifacts/` — module, controller, service

Key fixes: S3 upload outside transaction in createVersion, missing token tests, presigned URL security.

---

### T2.2.2 — Sandboxed artifact renderer ✅
Commits: `2f0a4f5`, `19eb42b`, `57516f2`

Files:
- `apps/web/components/artifacts/ArtifactFrame.tsx` — sandboxed iframe renderer
- `apps/web/app/(app)/p/[projectId]/artifacts/[artifactId]/page.tsx`

Key fix: ref for onConsole to avoid stale closure.

---

### T2.3.1 — Upload flow (presigned) + file registry ✅
Commits: `aa83f8c`, `e530ff1`, `99b8390`, `5585bda`

Files:
- `packages/db/src/migrations/0008_files.sql`
- `apps/api/src/modules/files/` — module, controller, service
- `apps/web/components/storage/FileDropzone.tsx`

Key fixes: `FOR UPDATE` on quota SELECT, atomic rate limit, confirmUpload idempotency, XHR abort on unmount.

---

### T2.3.2 — Ingestion worker: security gate ✅
Commits: `276c571`, `0c9a736`

Files:
- `apps/ingestion-worker/src/main.ts` — BullMQ Worker, ClamAV pause/resume loop
- `apps/ingestion-worker/src/security/security-gate.processor.ts` — size→magic→allowlist→ClamAV→disarm→promote
- `apps/ingestion-worker/src/security/steps/disarm/{pdf,svg,zip}.ts`

Key fixes: no `ignoreEncryption`, promote race (DB update before staging delete), SVG `FORBID_ATTR: ['href', 'xlink:href']`, fileName path traversal, ClamAV down pauses all workers.

---

### T2.3.3 — Extraction, chunking, embedding ✅
Commits: `4bfe19f`, `186ab4f`

Files:
- `packages/db/src/migrations/0009_knowledge.sql` — knowledge_sources, ingestion_jobs, knowledge_chunks; pgvector HNSW
- `packages/agents/src/embedder.ts` — OpenAI + Ollama providers
- `apps/ingestion-worker/src/knowledge-writer.ts` — stale-swap in `sql.begin()`
- `apps/ingestion-worker/src/extraction-pipeline.processor.ts`

Key fixes: stale-swap project_id in UPDATE+DELETE, fileId→projectId ownership check before extraction, `sql.begin()` atomicity, no zero-vector silent success.

---

### T2.3.4 — Hybrid search API ✅
Commits: `3c5e171`, `69b674e`

Files:
- `apps/api/src/modules/knowledge/knowledge.service.ts` — RRF (k=60), dedupe max 3/origin_id, recency boost for ceo_office
- `packages/shared/src/schemas/knowledge.ts`

Key fixes: Redis error → 503 (not 500), empty query → empty results (no .min(1)).

---

### T2.3.5 — Storage Room UI ✅
Commits: `b4dd541`, `b7e82f3`

Files:
- `apps/web/components/storage/StorageRoom.tsx`
- `apps/web/components/storage/FileTree.tsx`
- `apps/web/components/storage/PreviewPane.tsx`
- `apps/web/components/storage/ConnectSourceDialog.tsx`

Key fixes: PDF iframe `sandbox="allow-same-origin"` (no allow-scripts), `parseCsvRow()` for quoted fields, Range request 1MB cap, separate fetchError state, `aria-current="location"`.

---

### T2.4.1 — Notes backend + backlinks ✅
Commits: `1e573fa`, `b700f69`, `ed0e25e`

Files:
- `packages/db/src/migrations/0010_notes.sql` — notes + note_links, RLS WITH CHECK on both ends
- `apps/api/src/modules/notes/` — module, controller, service
- `apps/ingestion-worker/src/note-delta.processor.ts`

Key fixes: wikilink DB ops in same tx as note mutation, folderPath blocks `..` traversal, contentJson 100KB cap.

---

### T2.4.2 — CEO's Office (TipTap three-pane) ✅
Commits: `06fcfe9`, `4b7fdef`, `82c0716`

Files:
- `apps/web/components/office/CeoOffice.tsx` — NoteTree (220px) + editor (flex-1) + RightPane (280px)
- `apps/web/components/office/NoteEditor.tsx` — TipTap, autosave 5s debounce, image paste upload pipeline
- `apps/web/components/office/WikilinkExtension.ts`
- `apps/web/components/office/OutlinePane.tsx` — heading positions + scrollIntoView
- `apps/web/components/office/GraphPane.tsx`
- `apps/web/components/office/NoteTree.tsx`
- `apps/web/app/(app)/p/[projectId]/office/page.tsx`

Key fixes: image paste → upload pipeline (no blob:// URLs), WikilinkExtension registered, Outline scrollIntoView, autosave cancel on note switch, isDestroyed guard.

---

## Phase 2 exit gate (demo checklist)

From `docs/03_implementation_phases.md`:
- [ ] User chats with self in conference room
- [ ] Branches a message
- [ ] Views the DAG
- [ ] Uploads a PDF → appears in Storage Room → becomes searchable
- [ ] Writes a note → becomes searchable
- [ ] Creates a manual document artifact rendered in sandbox
- [ ] Hostile-file corpus fully green
- [ ] Cross-tenant probes green for all new tables

---

## Established patterns (for Phase 3)

### API (NestJS)
- Controller: `@UseGuards(JwtAuthGuard, ProjectViewerGuard)` reads, `ProjectEditorGuard` writes
- Service: `this.db.run({ userId, projectId }, async (tx) => { ... })`
- DTOs: `class FooDto extends createZodDto(FooSchema) {}`
- Errors: NestJS exceptions (NotFoundException, ForbiddenException, BadRequestException)
- Logging: `this.logger.log({ event: 'x.y', actorId, targetId, action })`
- Redis: `@Inject(REDIS_CLIENT)`

### DB migrations
- File: `packages/db/src/migrations/00NN_name.sql` — idempotent (IF NOT EXISTS, DROP POLICY IF EXISTS)
- Always: ENABLE + FORCE RLS, policy to bramha_app, GRANT to bramha_app
- Next migration number: **0011** (for Phase 3)

### Shared schemas
- Add to `packages/shared/src/schemas/{domain}.ts`
- Export from `packages/shared/src/index.ts`
- Always `.strict()` on object schemas
