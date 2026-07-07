import { z } from 'zod'
import { uuidSchema } from '../schemas/common.js'

// ── Shared sub-schemas ────────────────────────────────────────────────────────

/**
 * Minimal shape of a ConversationNode as published on the event bus.
 * Mirrors ConversationNodeDto from the conversations service.
 */
const ConversationNodeEventSchema = z
  .object({
    id: uuidSchema,
    conversationId: uuidSchema,
    projectId: uuidSchema,
    parentId: uuidSchema.nullable(),
    depth: z.number().int().nonnegative(),
    path: z.string(),
    type: z.string(),
    authorKind: z.string(),
    authorUserId: uuidSchema.nullable(),
    authorPersonaId: uuidSchema.nullable(),
    content: z.unknown(),
    tokenUsage: z.unknown(),
    createdAt: z.string(),
  })
  .passthrough() // allow extra fields added in future

/**
 * Minimal shape of a Branch as published on the event bus.
 * Mirrors BranchDto from the conversations service.
 */
const BranchEventSchema = z
  .object({
    id: uuidSchema,
    conversationId: uuidSchema,
    projectId: uuidSchema,
    name: z.string(),
    headNodeId: uuidSchema,
    forkedFromNode: uuidSchema.nullable(),
    createdByKind: z.string(),
    createdById: z.string().nullable(),
    status: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough()

// ── Event payload schemas ─────────────────────────────────────────────────────

export const ConvNodeAppendedPayloadSchema = z
  .object({
    conversationId: uuidSchema,
    roomId: uuidSchema,
    projectId: uuidSchema,
    node: ConversationNodeEventSchema,
  })
  .strict()

export type ConvNodeAppendedPayload = z.infer<typeof ConvNodeAppendedPayloadSchema>

export const ConvBranchForkedPayloadSchema = z
  .object({
    conversationId: uuidSchema,
    roomId: uuidSchema,
    projectId: uuidSchema,
    branch: BranchEventSchema,
  })
  .strict()

export type ConvBranchForkedPayload = z.infer<typeof ConvBranchForkedPayloadSchema>

export const ConvBranchUpdatedPayloadSchema = z
  .object({
    conversationId: uuidSchema,
    roomId: uuidSchema,
    projectId: uuidSchema,
    branch: BranchEventSchema,
  })
  .strict()

export type ConvBranchUpdatedPayload = z.infer<typeof ConvBranchUpdatedPayloadSchema>
