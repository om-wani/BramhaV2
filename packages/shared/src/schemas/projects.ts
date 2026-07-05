import { z } from 'zod'
import { uuidSchema, isoDateSchema, displayNameSchema } from './common.js'

export const ProjectRoleSchema = z.enum(['owner', 'editor', 'viewer'])

export type ProjectRole = z.infer<typeof ProjectRoleSchema>

export const ProjectSettingsSchema = z
  .object({
    tokenBudgetPerDayUsd: z.number().positive().default(10),
    defaultBranchPolicy: z.enum(['linear', 'fork-on-conflict']).default('linear'),
    agentsPaused: z.boolean().default(false),
  })
  .strict()

export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>

export const ProjectSchema = z
  .object({
    id: uuidSchema,
    orgId: uuidSchema,
    name: displayNameSchema,
    description: z.string().max(500).nullable(),
    settings: ProjectSettingsSchema,
    archivedAt: isoDateSchema.nullable(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .strict()

export type Project = z.infer<typeof ProjectSchema>

export const CreateProjectInputSchema = z
  .object({
    orgId: uuidSchema,
    name: displayNameSchema,
    description: z.string().max(500).optional(),
  })
  .strict()

export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>

export const UpdateProjectInputSchema = z
  .object({
    name: displayNameSchema.optional(),
    description: z.string().max(500).nullable().optional(),
    // Intentionally permissive: partial settings patch — only provided keys are updated
    settings: ProjectSettingsSchema.partial().optional(),
  })
  .strict()

export type UpdateProjectInput = z.infer<typeof UpdateProjectInputSchema>
