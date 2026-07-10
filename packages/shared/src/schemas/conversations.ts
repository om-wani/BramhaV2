import { z } from 'zod'

// ── Content ───────────────────────────────────────────────────────────────────

export const NodeContentSchema = z
  .object({
    text: z
      .string()
      .max(32768)
      .refine((v) => Buffer.byteLength(v, 'utf8') <= 32768, { message: 'text exceeds 32 kB' }),
    mentions: z.array(z.string().uuid()).default([]),
    attachments: z
      .array(z.object({ fileId: z.string().uuid(), name: z.string() }))
      .default([]),
    meta: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()

export type NodeContent = z.infer<typeof NodeContentSchema>

// ── Nodes ─────────────────────────────────────────────────────────────────────

export const NodeTypeSchema = z.enum([
  'user_message',
  'agent_message',
  'system_event',
  'interrupt',
  'summon',
  'delegation_report',
  'artifact_ref',
  'file_ref',
  'branch_point_marker',
])

export type NodeType = z.infer<typeof NodeTypeSchema>

export const AuthorKindSchema = z.enum(['user', 'agent', 'system'])
export type AuthorKind = z.infer<typeof AuthorKindSchema>

export const AppendNodeInputSchema = z
  .object({
    branchId: z.string().uuid(),
    parentId: z.string().uuid().optional(),
    type: NodeTypeSchema,
    authorKind: AuthorKindSchema,
    content: NodeContentSchema,
    idempotencyKey: z.string().min(1).max(128),
  })
  .strict()

export type AppendNodeInput = z.infer<typeof AppendNodeInputSchema>

// ── Branches ──────────────────────────────────────────────────────────────────

export const BranchStatusSchema = z.enum(['active', 'merged', 'abandoned'])
export type BranchStatus = z.infer<typeof BranchStatusSchema>

export const UpdateBranchInputSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    status: BranchStatusSchema.optional(),
  })
  .strict()

export type UpdateBranchInput = z.infer<typeof UpdateBranchInputSchema>

export const ForkInputSchema = z
  .object({
    fromNodeId: z.string().uuid(),
    name: z.string().min(1).max(100).optional(),
  })
  .strict()

export type ForkInput = z.infer<typeof ForkInputSchema>

// ── Conversations ─────────────────────────────────────────────────────────────

export const CreateConversationInputSchema = z
  .object({
    title: z.string().max(200).optional(),
  })
  .strict()

export type CreateConversationInput = z.infer<typeof CreateConversationInputSchema>

// ── Rooms ─────────────────────────────────────────────────────────────────────

export const RoomTypeSchema = z.enum(['conference', 'meeting', 'call', 'office', 'system'])
export type RoomType = z.infer<typeof RoomTypeSchema>

export const CreateRoomInputSchema = z
  .object({
    type: z.enum(['meeting', 'call']),
    name: z.string().min(1).max(100),
    seedPrompt: z.string().max(2000).optional(),
  })
  .strict()

export type CreateRoomInput = z.infer<typeof CreateRoomInputSchema>

// ── Project agents (roster) ───────────────────────────────────────────────────

export const HirePersonaInputSchema = z
  .object({ personaId: z.string().uuid() })
  .strict()

export type HirePersonaInput = z.infer<typeof HirePersonaInputSchema>

export const HiredPersonaSchema = z.object({
  personaId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  role: z.string().nullable(),
  accentColor: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  hiredAt: z.string(),
})

export type HiredPersona = z.infer<typeof HiredPersonaSchema>

export const UpdateRoomInputSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    archived: z.boolean().optional(),
  })
  .strict()

export type UpdateRoomInput = z.infer<typeof UpdateRoomInputSchema>

export const ParticipantKindSchema = z.enum(['user', 'agent'])
export type ParticipantKind = z.infer<typeof ParticipantKindSchema>

export const AddParticipantInputSchema = z
  .object({
    participantKind: ParticipantKindSchema,
    userId: z.string().uuid().optional(),
    personaId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (d) =>
      (d.participantKind === 'user' && d.userId != null && d.personaId == null) ||
      (d.participantKind === 'agent' && d.personaId != null && d.userId == null),
    {
      message:
        'user participant requires userId (no personaId); agent participant requires personaId (no userId)',
    },
  )

export type AddParticipantInput = z.infer<typeof AddParticipantInputSchema>
