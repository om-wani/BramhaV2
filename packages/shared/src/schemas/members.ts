import { z } from 'zod'
import { uuidSchema, isoDateSchema, emailSchema } from './common.js'
import { OrgRoleSchema } from './orgs.js'
import { ProjectRoleSchema } from './projects.js'

export const OrgMemberSchema = z
  .object({
    orgId: uuidSchema,
    userId: uuidSchema,
    role: OrgRoleSchema,
    createdAt: isoDateSchema,
  })
  .strict()

export type OrgMember = z.infer<typeof OrgMemberSchema>

export const InviteOrgMemberInputSchema = z
  .object({
    email: emailSchema, // normalized to lowercase via emailSchema
    role: OrgRoleSchema,
  })
  .strict()

export type InviteOrgMemberInput = z.infer<typeof InviteOrgMemberInputSchema>

export const ProjectMemberSchema = z
  .object({
    projectId: uuidSchema,
    userId: uuidSchema,
    role: ProjectRoleSchema,
    createdAt: isoDateSchema,
  })
  .strict()

export type ProjectMember = z.infer<typeof ProjectMemberSchema>

export const InviteProjectMemberInputSchema = z
  .object({
    email: emailSchema, // normalized to lowercase via emailSchema
    role: ProjectRoleSchema,
  })
  .strict()

export type InviteProjectMemberInput = z.infer<typeof InviteProjectMemberInputSchema>
