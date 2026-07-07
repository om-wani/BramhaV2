import { z } from 'zod'
import { uuidSchema } from './common.js'

// ── Kind ──────────────────────────────────────────────────────────────────────

export const ArtifactKindSchema = z.enum([
  'code',
  'react',
  'html',
  'document',
  'markdown',
  'svg',
  'mermaid',
  'csv',
])
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>

// ── Input schemas ─────────────────────────────────────────────────────────────

export const CreateArtifactInputSchema = z
  .object({
    kind: ArtifactKindSchema,
    title: z.string().min(1).max(200),
    content: z.string().min(1),
    conversationId: uuidSchema.optional(),
  })
  .strict()

export type CreateArtifactInput = z.infer<typeof CreateArtifactInputSchema>

export const CreateVersionInputSchema = z
  .object({
    content: z.string().min(1),
    createdByNodeId: uuidSchema.optional(),
  })
  .strict()

export type CreateVersionInput = z.infer<typeof CreateVersionInputSchema>

// ── Response schemas ──────────────────────────────────────────────────────────

export const ArtifactVersionSchema = z.object({
  artifactId: uuidSchema,
  version: z.number().int().positive(),
  contentKey: z.string(),
  contentSha256: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  createdByNode: uuidSchema.nullable(),
  createdAt: z.string(),
})

export type ArtifactVersion = z.infer<typeof ArtifactVersionSchema>

export const ArtifactSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  conversationId: uuidSchema.nullable(),
  createdByPersona: uuidSchema.nullable(),
  createdByUser: uuidSchema.nullable(),
  kind: ArtifactKindSchema,
  title: z.string(),
  currentVersion: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Artifact = z.infer<typeof ArtifactSchema>
