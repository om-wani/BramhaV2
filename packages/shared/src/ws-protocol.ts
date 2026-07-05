import { z } from 'zod'
import { uuidSchema } from './schemas/common.js'

// Client → Server events
export const WsClientEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('room.join'), roomId: uuidSchema }).strict(),
  z.object({ type: z.literal('room.leave'), roomId: uuidSchema }).strict(),
  z.object({ type: z.literal('presence.ping'), projectId: uuidSchema }).strict(),
])

export type WsClientEvent = z.infer<typeof WsClientEventSchema>

// Server → Client events
export const WsServerEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('conv.node.created'),
      roomId: uuidSchema,
      nodeId: uuidSchema,
      branchId: uuidSchema,
      actorId: uuidSchema,
      actorType: z.enum(['user', 'agent']),
      createdAt: z.string().datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      type: z.literal('presence.update'),
      projectId: uuidSchema,
      userId: uuidSchema,
      status: z.enum(['online', 'away', 'offline']),
    })
    .strict(),
  z
    .object({
      type: z.literal('system.error'),
      code: z.string(),
      message: z.string(),
    })
    .strict(),
])

export type WsServerEvent = z.infer<typeof WsServerEventSchema>
