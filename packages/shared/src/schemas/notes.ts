import { z } from 'zod'
import { uuidSchema, isoDateSchema } from './common.js'

export const NoteSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  authorId: uuidSchema,
  title: z.string(),
  contentMd: z.string(),
  contentJson: z.unknown().nullable(),
  folderPath: z.string(),
  isDaily: z.boolean(),
  deletedAt: isoDateSchema.nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
}).strict()

export type Note = z.infer<typeof NoteSchema>

export const CreateNoteInputSchema = z.object({
  title: z.string().min(1).max(500),
  contentMd: z.string().max(500_000),
  contentJson: z.unknown().optional(),
  folderPath: z.string().regex(/^\/[^<>:"\\|?*]*$/),
  isDaily: z.boolean().optional(),
}).strict()

export type CreateNoteInput = z.infer<typeof CreateNoteInputSchema>

export const UpdateNoteInputSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  contentMd: z.string().max(500_000).optional(),
  contentJson: z.unknown().optional(),
  folderPath: z.string().regex(/^\/[^<>:"\\|?*]*$/).optional(),
}).strict()

export type UpdateNoteInput = z.infer<typeof UpdateNoteInputSchema>

export const MoveFolderInputSchema = z.object({
  folderPath: z.string().regex(/^\/[^<>:"\\|?*]*$/),
}).strict()

export type MoveFolderInput = z.infer<typeof MoveFolderInputSchema>

export const NoteLinkSchema = z.object({
  fromNote: z.string().uuid(),
  toNote: z.string().uuid(),
}).strict()

export type NoteLink = z.infer<typeof NoteLinkSchema>
