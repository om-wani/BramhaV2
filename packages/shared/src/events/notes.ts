import { z } from 'zod'
import { uuidSchema } from '../schemas/common.js'

export const NoteDeltaDonePayloadSchema = z.object({
  noteId: uuidSchema,
  projectId: uuidSchema,
  chunkCount: z.number().int(),
}).strict()
export type NoteDeltaDonePayload = z.infer<typeof NoteDeltaDonePayloadSchema>

export const NoteDeltaFailedPayloadSchema = z.object({
  noteId: uuidSchema,
  projectId: uuidSchema,
  reason: z.string(),
}).strict()
export type NoteDeltaFailedPayload = z.infer<typeof NoteDeltaFailedPayloadSchema>
