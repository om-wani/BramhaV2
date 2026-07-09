import { sql } from 'drizzle-orm'
import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
  real,
  numeric,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core'
import { projects } from './identity.js'

// -------------------------------------------------------------------------
// AGENT_PERSONAS
// -------------------------------------------------------------------------
export const agentPersonas = pgTable(
  'agent_personas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 'global' | 'project' */
    scope: text('scope').notNull(),
    /** NULL for global personas; FK for project-scoped personas */
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    /** 'csuite' | 'specialist' | 'pa' */
    tier: text('tier').notNull(),
    /** Stable identifier: 'cto', 'worker.researcher', etc. */
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    title: text('title'),
    avatarKey: text('avatar_key'),
    color: text('color'),
    /** Mustache/Handlebars system prompt template */
    systemPromptTpl: text('system_prompt_tpl').notNull(),
    expertiseTags: text('expertise_tags').array().notNull().default([]),
    /** { eagerness, interruptThreshold, silenceBias } */
    speakProfile: jsonb('speak_profile').notNull().default({}),
    /** { canDelegate: string[], perTaskBudgetUsd: number } */
    delegationAuthority: jsonb('delegation_authority').notNull().default({}),
    toolAllowlist: text('tool_allowlist').array().notNull().default([]),
    enabled: boolean('enabled').notNull().default(true),
    // UNIQUE NULLS NOT DISTINCT (scope, project_id, slug) — enforced in migration SQL
  },
  (t) => [
    index('idx_agent_personas_scope').on(t.scope),
    index('idx_agent_personas_slug').on(t.slug),
  ],
)

// -------------------------------------------------------------------------
// AGENT_MODEL_POLICIES
// -------------------------------------------------------------------------
export const agentModelPolicies = pgTable('agent_model_policies', {
  id: uuid('id').primaryKey().defaultRandom(),
  personaId: uuid('persona_id')
    .notNull()
    .references(() => agentPersonas.id, { onDelete: 'cascade' })
    .unique(),
  /** 'csuite' | 'specialist' | 'utility' */
  tier: text('tier').notNull(),
  primaryProvider: text('primary_provider').notNull(),
  primaryModel: text('primary_model').notNull(),
  /** JSON array of { provider, model } fallback entries */
  fallbacks: jsonb('fallbacks').notNull().default([]),
  maxInputTokens: integer('max_input_tokens').notNull(),
  maxOutputTokens: integer('max_output_tokens').notNull(),
  /** float4 — 0.0..2.0 */
  temperature: real('temperature').notNull().default(0.7),
  /** Per-turn USD budget cap */
  perTurnUsd: numeric('per_turn_usd', { precision: 8, scale: 4 }).notNull(),
  /** Per-day USD budget cap */
  perDayUsd: numeric('per_day_usd', { precision: 8, scale: 2 }).notNull(),
  promptCaching: boolean('prompt_caching').notNull().default(true),
})

// -------------------------------------------------------------------------
// PROJECT_AGENTS  (roster)
// -------------------------------------------------------------------------
export const projectAgents = pgTable(
  'project_agents',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    personaId: uuid('persona_id')
      .notNull()
      .references(() => agentPersonas.id, { onDelete: 'cascade' }),
    hiredAt: timestamp('hired_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.personaId] }),
    index('idx_project_agents_project').on(t.projectId),
  ],
)

// -------------------------------------------------------------------------
// TOKEN_USAGE  (per-turn accounting)
// -------------------------------------------------------------------------
export const tokenUsage = pgTable(
  'token_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    personaId: uuid('persona_id').references(() => agentPersonas.id, { onDelete: 'set null' }),
    conversationNodeId: uuid('conversation_node_id'),
    turnId: uuid('turn_id'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    estimatedUsd: numeric('estimated_usd', { precision: 10, scale: 6 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_token_usage_project').on(t.projectId, t.createdAt),
    index('idx_token_usage_persona').on(t.personaId).where(sql`persona_id IS NOT NULL`),
    index('idx_token_usage_node').on(t.conversationNodeId).where(sql`conversation_node_id IS NOT NULL`),
  ],
)
