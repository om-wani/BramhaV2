import { z } from 'zod'
import { uuidSchema } from './common.js'

export const InitiateUploadInputSchema = z.object({
  name: z.string().min(1).max(500),
  declaredMime: z.string().min(1).max(200),
  sizeBytes: z.number().int().positive().max(52428800), // 50 MB
  roomId: uuidSchema.optional(),
}).strict()

export type InitiateUploadInput = z.infer<typeof InitiateUploadInputSchema>

export const InitiateUploadResponseSchema = z.object({
  fileId: uuidSchema,
  uploadUrl: z.string().url(),
  key: z.string(),
  expiresAt: z.string(),
})

export type InitiateUploadResponse = z.infer<typeof InitiateUploadResponseSchema>

export const ScanStatusSchema = z.enum(['pending', 'scanning', 'clean', 'quarantined', 'failed'])
export type ScanStatus = z.infer<typeof ScanStatusSchema>

export const FileSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  uploadedBy: uuidSchema,
  roomId: uuidSchema.nullable(),
  name: z.string(),
  declaredMime: z.string(),
  detectedMime: z.string().nullable(),
  sizeBytes: z.number(),
  storageKey: z.string(),
  scanStatus: ScanStatusSchema,
  scanReport: z.unknown().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type FileDto = z.infer<typeof FileSchema>
