import { sql } from 'drizzle-orm'
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  primaryKey,
  index,
  customType,
} from 'drizzle-orm/pg-core'
import { users, projects } from './identity.js'
import { agentPersonas } from './agents.js'
import { conversations, conversationNodes } from './conversations.js'

// bytea is not a built-in drizzle-orm/pg-core column type — define via customType.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  },
  fromDriver(v: Buffer): Buffer {
    return v
  },
})

// -------------------------------------------------------------------------
// AGENT_WORKING_MEMORY
// Per-persona working memory scoped to a conversation.
// facts  : Fact[]      [{text, sourceNode, confidence, ts}]
// open_loops: OpenLoop[] [{id, text, createdAt, closedAt?}]
// -------------------------------------------------------------------------
export const agentWorkingMemory = pgTable(
  'agent_working_memory',
  {
    personaId: uuid('persona_id')
      .notNull()
      .references(() => agentPersonas.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** JSON array of Fact objects */
    facts: jsonb('facts').notNull().default([]),
    /** JSON array of OpenLoop objects */
    openLoops: jsonb('open_loops').notNull().default([]),
    lastSummaryNode: uuid('last_summary_node').references(
      () => conversationNodes.id,
      { onDelete: 'set null' },
    ),
    summaryMd: text('summary_md'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.personaId, t.conversationId] }),
    index('idx_agent_working_memory_project_conversation').on(t.projectId, t.conversationId),
  ],
)

// -------------------------------------------------------------------------
// GRAPH_CHECKPOINTS
// LangGraph thread state persistence.
// thread_id format: '{conversationId}:{branchId}:{personaId}:{turnId}'
// -------------------------------------------------------------------------
export const graphCheckpoints = pgTable('graph_checkpoints', {
  /** '{conversationId}:{branchId}:{personaId}:{turnId}' */
  threadId: text('thread_id').primaryKey(),
  checkpoint: bytea('checkpoint').notNull(),
  metadata: jsonb('metadata'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// -------------------------------------------------------------------------
// DELEGATIONS
// Records of C-Suite → worker delegation tasks.
// -------------------------------------------------------------------------
export const delegations = pgTable(
  'delegations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Turn group UUID — groups all agents speaking in the same turn */
    groupId: uuid('group_id').notNull(),
    parentPersonaId: uuid('parent_persona_id').references(
      () => agentPersonas.id,
      { onDelete: 'set null' },
    ),
    workerPersonaId: uuid('worker_persona_id').references(
      () => agentPersonas.id,
      { onDelete: 'set null' },
    ),
    originNodeId: uuid('origin_node_id').references(
      () => conversationNodes.id,
      { onDelete: 'set null' },
    ),
    /** Delegation spec — task description, constraints, expected output */
    spec: jsonb('spec').notNull(),
    /** Budget constraints — { maxUsd, maxTurns, timeoutMs } */
    budget: jsonb('budget').notNull(),
    /**
     * Status FSM:
     *   queued → running → completed | failed | cancelled | timeout
     *   running → waiting_approval → completed | denied
     */
    status: text('status').notNull().default('queued'),
    result: jsonb('result'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_delegations_project_id').on(t.projectId),
  ],
)

// -------------------------------------------------------------------------
// APPROVALS
// Human-in-the-loop approval gates for sensitive agent actions.
// -------------------------------------------------------------------------
export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Persona UUID requesting the approval */
    requestedByPersona: uuid('requested_by_persona').notNull(),
    delegationId: uuid('delegation_id').references(
      () => delegations.id,
      { onDelete: 'set null' },
    ),
    actionSummary: text('action_summary').notNull(),
    /** SHA-256 of the action payload for tamper detection */
    payloadHash: text('payload_hash').notNull(),
    status: text('status').notNull().default('pending'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_approvals_project_id').on(t.projectId),
    index('idx_approvals_delegation_id')
      .on(t.delegationId)
      .where(sql`delegation_id IS NOT NULL`),
  ],
)
