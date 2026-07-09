import { z } from 'zod'

// ── SpeakProfile ──────────────────────────────────────────────────────────────

export const SpeakProfileSchema = z
  .object({
    /** How eagerly the persona speaks (0–1) */
    eagerness: z.number().min(0).max(1),
    /** Turn-interrupt threshold: number of semantic-distance tokens before interrupting */
    interruptThreshold: z.number().nonnegative(),
    /** Silence bias: tendency to stay quiet (0–1) */
    silenceBias: z.number().min(0).max(1).default(0),
  })
  .strict()

export type SpeakProfile = z.infer<typeof SpeakProfileSchema>

// ── DelegationAuthority ───────────────────────────────────────────────────────

export const DelegationAuthoritySchema = z
  .object({
    /** Worker slugs this persona can delegate to */
    canDelegate: z.array(z.string()),
    /** Per-task budget cap in USD */
    perTaskBudgetUsd: z.number().nonnegative(),
  })
  .strict()

export type DelegationAuthority = z.infer<typeof DelegationAuthoritySchema>

// ── AgentPersona ──────────────────────────────────────────────────────────────

export const AgentPersonaSchema = z
  .object({
    id: z.string().uuid(),
    scope: z.enum(['global', 'project']),
    projectId: z.string().uuid().nullable(),
    tier: z.enum(['csuite', 'specialist', 'pa']),
    slug: z.string().min(1).max(100),
    name: z.string().min(1).max(100),
    title: z.string().max(200).nullable(),
    avatarKey: z.string().nullable(),
    color: z.string().nullable(),
    systemPromptTpl: z.string(),
    expertiseTags: z.array(z.string()),
    speakProfile: SpeakProfileSchema,
    delegationAuthority: DelegationAuthoritySchema,
    toolAllowlist: z.array(z.string()),
    enabled: z.boolean(),
  })
  .strict()

export type AgentPersona = z.infer<typeof AgentPersonaSchema>

// ── AgentModelPolicy ──────────────────────────────────────────────────────────

export const FallbackProviderSchema = z
  .object({
    provider: z.string(),
    model: z.string(),
  })
  .strict()

export const AgentModelPolicySchema = z
  .object({
    id: z.string().uuid(),
    personaId: z.string().uuid(),
    tier: z.enum(['csuite', 'specialist', 'utility']),
    primaryProvider: z.string(),
    primaryModel: z.string(),
    fallbacks: z.array(FallbackProviderSchema),
    maxInputTokens: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    temperature: z.number().min(0).max(2),
    perTurnUsd: z.string(), // numeric stored as string by pg driver
    perDayUsd: z.string(),
    promptCaching: z.boolean(),
  })
  .strict()

export type AgentModelPolicy = z.infer<typeof AgentModelPolicySchema>

// ── ProjectAgent ──────────────────────────────────────────────────────────────

export const ProjectAgentSchema = z
  .object({
    projectId: z.string().uuid(),
    personaId: z.string().uuid(),
    hiredAt: z.string().datetime({ offset: true }),
  })
  .strict()

export type ProjectAgent = z.infer<typeof ProjectAgentSchema>

// ── TokenUsage ────────────────────────────────────────────────────────────────

export const TokenUsageSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    personaId: z.string().uuid().nullable(),
    conversationNodeId: z.string().uuid().nullable(),
    turnId: z.string().uuid().nullable(),
    provider: z.string(),
    model: z.string(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    estimatedUsd: z.string(), // numeric from pg driver
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict()

export type TokenUsage = z.infer<typeof TokenUsageSchema>

// ── ModelPolicy (runtime shape used by ModelRouter) ───────────────────────────

export const ModelPolicySchema = z
  .object({
    tier: z.enum(['csuite', 'specialist', 'utility']),
    primary: z.object({ provider: z.string(), model: z.string() }).strict(),
    fallbacks: z.array(z.object({ provider: z.string(), model: z.string() }).strict()),
    maxInputTokens: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    temperature: z.number().min(0).max(2),
    budget: z
      .object({
        perTurnUSD: z.number().positive(),
        perDayUSD: z.number().positive(),
      })
      .strict(),
    cache: z
      .object({
        promptCaching: z.boolean(),
        semanticCacheTTLs: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()

export type ModelPolicy = z.infer<typeof ModelPolicySchema>

// ── StreamEvent (Zod schemas for wire format / logging) ───────────────────────

export const StreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('thought'), text: z.string() }).strict(),
  z.object({ type: z.literal('content'), text: z.string() }).strict(),
  z
    .object({
      type: z.literal('tool_call'),
      callId: z.string(),
      name: z.string(),
      input: z.unknown(),
    })
    .strict(),
  z
    .object({
      type: z.literal('usage'),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      estimatedUsd: z.number().nonnegative(),
    })
    .strict(),
])

export type StreamEvent = z.infer<typeof StreamEventSchema>
