/**
 * Drizzle ORM schema for BramhaV2.
 *
 * Note on file_chunks: the `embedding vector(1536)` and `tsv tsvector GENERATED`
 * columns are omitted here because Drizzle has no native vector/tsvector type.
 * They are created authoritatively in the raw SQL migration (0001_init.sql).
 * All other columns are present for query building.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
  bigint,
  primaryKey,
  index,
  unique,
} from 'drizzle-orm/pg-core';

// Convenience alias: timestamp with time zone (maps to TIMESTAMPTZ in Postgres)
const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
import { relations } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique().notNull(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  emailVerifiedAt: timestamptz('email_verified_at'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').unique().notNull(),
  expiresAt: timestamptz('expires_at').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// orgs
// ---------------------------------------------------------------------------
export const orgs = pgTable('orgs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// org_members
// ---------------------------------------------------------------------------
export const orgMembers = pgTable(
  'org_members',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // owner | admin | member — CHECK enforced in SQL
    joinedAt: timestamptz('joined_at').notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.userId] }),
  }),
);

// ---------------------------------------------------------------------------
// projects
// ---------------------------------------------------------------------------
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    workingMemory: jsonb('working_memory').notNull().default({}),
    proactivePaEnabled: boolean('proactive_pa_enabled').notNull().default(false),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => ({
    orgSlugUniq: unique('projects_org_slug_uniq').on(t.orgId, t.slug),
  }),
);

// ---------------------------------------------------------------------------
// project_members
// ---------------------------------------------------------------------------
export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // owner | editor | viewer — CHECK in SQL
    joinedAt: timestamptz('joined_at').notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.projectId, t.userId] }),
  }),
);

// ---------------------------------------------------------------------------
// rooms  (main_branch_id is a plain uuid — forward ref, no FK in Drizzle)
// ---------------------------------------------------------------------------
export const rooms = pgTable('rooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  kind: text('kind').notNull(), // council | one_on_one — CHECK in SQL
  persona: text('persona'),
  mainBranchId: uuid('main_branch_id'), // forward ref to branches — no FK
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// branches
// ---------------------------------------------------------------------------
export const branches = pgTable('branches', {
  id: uuid('id').primaryKey().defaultRandom(),
  roomId: uuid('room_id')
    .notNull()
    .references(() => rooms.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull(),
  name: text('name').notNull(),
  headNodeId: uuid('head_node_id'), // null before first message; updated after insert
  forkedFromNodeId: uuid('forked_from_node_id'), // null for main branch
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// conversation_nodes
// ---------------------------------------------------------------------------
export const conversationNodes = pgTable(
  'conversation_nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    parentId: uuid('parent_id'), // self-ref — no inline FK (circular); managed in SQL
    authorType: text('author_type').notNull(), // user | agent | system — CHECK in SQL
    userId: uuid('user_id'), // set when authorType = 'user'
    persona: text('persona'), // set when authorType = 'agent'
    content: text('content').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => ({
    idxRoom: index('idx_nodes_room').on(t.roomId),
    idxParent: index('idx_nodes_parent').on(t.parentId),
    idxProject: index('idx_nodes_project').on(t.projectId),
  }),
);

// ---------------------------------------------------------------------------
// files
// ---------------------------------------------------------------------------
export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  uploadedBy: uuid('uploaded_by')
    .notNull()
    .references(() => users.id),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  storagePath: text('storage_path').notNull(),
  status: text('status').notNull(), // pending | processing | ready | error — CHECK in SQL
  errorMsg: text('error_msg'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// file_chunks  (embedding + tsv omitted — defined in raw SQL migration)
// ---------------------------------------------------------------------------
export const fileChunks = pgTable(
  'file_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    tokenCount: integer('token_count'),
    // embedding vector(1536) — in SQL migration only
    // tsv tsvector GENERATED — in SQL migration only
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => ({
    idxChunksFile: index('idx_chunks_file').on(t.fileId, t.chunkIndex),
  }),
);

// ---------------------------------------------------------------------------
// ingestion_jobs
// ---------------------------------------------------------------------------
export const ingestionJobs = pgTable('ingestion_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  fileId: uuid('file_id')
    .notNull()
    .references(() => files.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull(),
  status: text('status').notNull(), // pending | running | done | failed — CHECK in SQL
  attempt: integer('attempt').notNull().default(0),
  errorMsg: text('error_msg'),
  queuedAt: timestamptz('queued_at').notNull().defaultNow(),
  startedAt: timestamptz('started_at'),
  finishedAt: timestamptz('finished_at'),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// delegation_tasks
// ---------------------------------------------------------------------------
export const delegationTasks = pgTable('delegation_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  roomId: uuid('room_id')
    .notNull()
    .references(() => rooms.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull(),
  sourceNodeId: uuid('source_node_id').notNull(),
  fromPersona: text('from_persona').notNull(),
  toPersona: text('to_persona').notNull(),
  task: text('task').notNull(),
  status: text('status').notNull(), // pending | running | done | failed — CHECK in SQL
  resultNodeId: uuid('result_node_id'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// model_calls
// ---------------------------------------------------------------------------
export const modelCalls = pgTable('model_calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull(),
  roomId: uuid('room_id'),
  persona: text('persona'),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  purpose: text('purpose').notNull(), // turn | delegation | embedding | proactive — CHECK in SQL
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Relations (optional, for drizzle relational queries)
// ---------------------------------------------------------------------------
export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  orgMembers: many(orgMembers),
  projectMembers: many(projectMembers),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const orgsRelations = relations(orgs, ({ many, one }) => ({
  members: many(orgMembers),
  projects: many(projects),
  createdByUser: one(users, { fields: [orgs.createdBy], references: [users.id] }),
}));

export const orgMembersRelations = relations(orgMembers, ({ one }) => ({
  org: one(orgs, { fields: [orgMembers.orgId], references: [orgs.id] }),
  user: one(users, { fields: [orgMembers.userId], references: [users.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  org: one(orgs, { fields: [projects.orgId], references: [orgs.id] }),
  members: many(projectMembers),
  rooms: many(rooms),
  files: many(files),
  delegationTasks: many(delegationTasks),
  modelCalls: many(modelCalls),
}));

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, { fields: [projectMembers.projectId], references: [projects.id] }),
  user: one(users, { fields: [projectMembers.userId], references: [users.id] }),
}));

export const roomsRelations = relations(rooms, ({ one, many }) => ({
  project: one(projects, { fields: [rooms.projectId], references: [projects.id] }),
  branches: many(branches),
  nodes: many(conversationNodes),
  delegationTasks: many(delegationTasks),
}));

export const branchesRelations = relations(branches, ({ one }) => ({
  room: one(rooms, { fields: [branches.roomId], references: [rooms.id] }),
  createdByUser: one(users, { fields: [branches.createdBy], references: [users.id] }),
}));

export const conversationNodesRelations = relations(conversationNodes, ({ one, many }) => ({
  room: one(rooms, { fields: [conversationNodes.roomId], references: [rooms.id] }),
  children: many(conversationNodes, { relationName: 'nodeChildren' }),
  parent: one(conversationNodes, {
    fields: [conversationNodes.parentId],
    references: [conversationNodes.id],
    relationName: 'nodeChildren',
  }),
}));

export const filesRelations = relations(files, ({ one, many }) => ({
  project: one(projects, { fields: [files.projectId], references: [projects.id] }),
  uploadedByUser: one(users, { fields: [files.uploadedBy], references: [users.id] }),
  chunks: many(fileChunks),
  ingestionJobs: many(ingestionJobs),
}));

export const fileChunksRelations = relations(fileChunks, ({ one }) => ({
  file: one(files, { fields: [fileChunks.fileId], references: [files.id] }),
}));

export const ingestionJobsRelations = relations(ingestionJobs, ({ one }) => ({
  file: one(files, { fields: [ingestionJobs.fileId], references: [files.id] }),
}));

export const delegationTasksRelations = relations(delegationTasks, ({ one }) => ({
  room: one(rooms, { fields: [delegationTasks.roomId], references: [rooms.id] }),
}));
