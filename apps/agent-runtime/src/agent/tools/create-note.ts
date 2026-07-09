/**
 * create_note core tool.
 * Creates a note in the project knowledge base.
 */

import { z } from 'zod'
import type { ToolDefinition } from '@bramha/agents'

export const CreateNoteInputSchema = z.object({
  title: z.string(),
  content: z.string(),
  tags: z.array(z.string()).default([]),
})

export type CreateNoteInput = z.infer<typeof CreateNoteInputSchema>

export const createNoteTool = {
  name: 'create_note',
  description: "Create a note in the project's knowledge base",
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Note title' },
      content: { type: 'string', description: 'Note body in Markdown' },
      tags: {
        type: 'array',
        items: { type: 'string' },
        default: [],
        description: 'Optional topic tags',
      },
    },
    required: ['title', 'content'],
    additionalProperties: false,
  },
} satisfies ToolDefinition

export interface CreateNoteDeps {
  createNote: (
    title: string,
    content: string,
    tags: string[],
    projectId: string,
    personaId: string,
  ) => Promise<{ noteId: string }>
  projectId: string
  personaId: string
}

export async function executeCreateNote(
  rawInput: unknown,
  deps: CreateNoteDeps,
): Promise<{ noteId: string }> {
  const input = CreateNoteInputSchema.parse(rawInput)
  return deps.createNote(
    input.title,
    input.content,
    input.tags,
    deps.projectId,
    deps.personaId,
  )
}
