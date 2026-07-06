import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  primaryKey,
  customType,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { type AnyPgColumn } from 'drizzle-orm/pg-core'
import { users, projects } from './identity.js'

// ltree is not a built-in drizzle-orm/pg-core column type — define via customType.
// The DB column is 'ltree'; values are dot-separated label strings e.g. "abc_def.xyz_123".
const ltree = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'ltree'
  },
})

// -------------------------------------------------------------------------
// ROOMS
// -------------------------------------------------------------------------
export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    name: text('name').notNull(),
    // created_by nullable — room may be system-created
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_rooms_project_id').on(t.projectId),
    // Partial unique (one 'conference' room per project) — enforced by migration SQL.
    // Drizzle doesn't support partial unique index where clauses in all versions,
    // so this is declared in 0006_dag.sql as rooms_conference_unique.
  ],
)

// -------------------------------------------------------------------------
// ROOM_PARTICIPANTS
// -------------------------------------------------------------------------
export const roomParticipants = pgTable(
  'room_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    participantKind: text('participant_kind').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    // persona_id: no FK constraint — agent_personas table doesn't exist until Phase 3.
    // Partial unique indexes (user/agent uniqueness per room) live in migration SQL.
    personaId: uuid('persona_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_room_participants_room_id').on(t.roomId)],
)

// -------------------------------------------------------------------------
// CONVERSATIONS
// -------------------------------------------------------------------------
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    // project_id denormalised for RLS + hot-path filters; not a FK in Drizzle
    // (the FK lives on room_id → rooms → project_id implicitly).
    projectId: uuid('project_id').notNull(),
    title: text('title'),
    // default_branch_id FK to branches is deferred (circular dependency).
    // The FK constraint is added in 0006_dag.sql after branches is created.
    defaultBranchId: uuid('default_branch_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_conversations_room_id').on(t.roomId),
    index('idx_conversations_project_id').on(t.projectId),
  ],
)

// -------------------------------------------------------------------------
// CONVERSATION_NODES  (APPEND-ONLY)
// -------------------------------------------------------------------------
// depth and path are trigger-maintained (set by conversation_nodes_set_depth_path
// BEFORE INSERT trigger). Provide defaults here so Drizzle's InsertModel treats
// them as optional — the trigger overrides whatever placeholder value is used.
export const conversationNodes = pgTable(
  'conversation_nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    // project_id denormalised for RLS + hot-path filters
    projectId: uuid('project_id').notNull(),
    // Self-referential FK; use AnyPgColumn to satisfy TypeScript's forward-reference check.
    parentId: uuid('parent_id').references((): AnyPgColumn => conversationNodes.id),
    // Trigger-maintained — defaults overridden on INSERT
    depth: integer('depth').notNull().default(0),
    path: ltree('path').notNull().default('_'),
    type: text('type').notNull(),
    authorKind: text('author_kind').notNull(),
    authorUserId: uuid('author_user_id'),
    authorPersonaId: uuid('author_persona_id'),
    content: jsonb('content').notNull(),
    tokenUsage: jsonb('token_usage'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // NO updatedAt — this is an append-only table; the trigger enforces it at DB level.
  },
  (t) => [
    // GiST index for ltree ancestor/descendant queries (requires btree_gist extension)
    index('idx_conversation_nodes_conv_path').using('gist', t.conversationId, t.path),
    index('idx_conversation_nodes_conv_parent').on(t.conversationId, t.parentId),
    index('idx_conversation_nodes_project_created').on(t.projectId, t.createdAt),
  ],
)

// -------------------------------------------------------------------------
// NODE_LINKS  (cross-branch references → full DAG)
// -------------------------------------------------------------------------
export const nodeLinks = pgTable(
  'node_links',
  {
    fromNode: uuid('from_node')
      .notNull()
      .references(() => conversationNodes.id, { onDelete: 'cascade' }),
    toNode: uuid('to_node')
      .notNull()
      .references(() => conversationNodes.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
  },
  (t) => [primaryKey({ columns: [t.fromNode, t.toNode] })],
)

// -------------------------------------------------------------------------
// BRANCHES  (git-ref-like named leaf pointers)
// -------------------------------------------------------------------------
export const branches = pgTable(
  'branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    name: text('name').notNull(),
    headNodeId: uuid('head_node_id')
      .notNull()
      .references(() => conversationNodes.id),
    forkedFromNode: uuid('forked_from_node').references(() => conversationNodes.id),
    createdByKind: text('created_by_kind').notNull(),
    createdById: uuid('created_by_id'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('branches_conversation_name_unique').on(t.conversationId, t.name),
    index('idx_branches_conversation_id').on(t.conversationId),
    index('idx_branches_project_id').on(t.projectId),
  ],
)

// -------------------------------------------------------------------------
// USER_ROOM_STATE  (read cursors, active branch, collapsed panes)
// -------------------------------------------------------------------------
export const userRoomState = pgTable(
  'user_room_state',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    activeBranchId: uuid('active_branch_id').references(() => branches.id, {
      onDelete: 'set null',
    }),
    lastReadNodeId: uuid('last_read_node_id').references(() => conversationNodes.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roomId, t.conversationId] })],
)
