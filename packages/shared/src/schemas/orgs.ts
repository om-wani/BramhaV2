import { z } from 'zod'
import { uuidSchema, slugSchema, isoDateSchema, displayNameSchema } from './common.js'

export const OrgRoleSchema = z.enum(['owner', 'admin', 'member'])

export type OrgRole = z.infer<typeof OrgRoleSchema>

export const OrgSchema = z
  .object({
    id: uuidSchema,
    name: displayNameSchema,
    slug: slugSchema,
    ownerId: uuidSchema,
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .strict()

export type Org = z.infer<typeof OrgSchema>

export const CreateOrgInputSchema = z
  .object({
    name: displayNameSchema,
    slug: slugSchema,
  })
  .strict()

export type CreateOrgInput = z.infer<typeof CreateOrgInputSchema>

export const UpdateOrgInputSchema = z
  .object({
    name: displayNameSchema.optional(),
    slug: slugSchema.optional(),
  })
  .strict()

export type UpdateOrgInput = z.infer<typeof UpdateOrgInputSchema>
