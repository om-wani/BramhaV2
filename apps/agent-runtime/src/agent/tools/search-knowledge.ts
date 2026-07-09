/**
 * search_knowledge core tool.
 * Searches the project knowledge base for relevant document chunks.
 */

import { z } from 'zod'
import type { RagChunk } from '../../pa/context-bundle.js'
import type { ToolDefinition } from '@bramha/agents'

export const SearchKnowledgeInputSchema = z.object({
  query: z.string(),
  topK: z.number().int().min(1).max(10).default(5),
})

export type SearchKnowledgeInput = z.infer<typeof SearchKnowledgeInputSchema>

export const searchKnowledgeTool = {
  name: 'search_knowledge',
  description: 'Search project knowledge base for relevant documents',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural language search query' },
      topK: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        default: 5,
        description: 'Maximum number of results to return',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
} satisfies ToolDefinition

export interface SearchKnowledgeDeps {
  searchKnowledge: (query: string, topK: number, projectId: string) => Promise<RagChunk[]>
  projectId: string
}

export async function executeSearchKnowledge(
  rawInput: unknown,
  deps: SearchKnowledgeDeps,
): Promise<{ chunks: RagChunk[] }> {
  const input = SearchKnowledgeInputSchema.parse(rawInput)
  const chunks = await deps.searchKnowledge(input.query, input.topK, deps.projectId)
  return { chunks }
}
