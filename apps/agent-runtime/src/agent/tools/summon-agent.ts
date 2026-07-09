/**
 * summon_agent core tool.
 * Requests another C-Suite agent to join the conversation.
 * Publishes `agent.summoned:{projectId}` on the event bus.
 */

import { z } from 'zod'
import type { ToolDefinition } from '@bramha/agents'

export const SummonAgentInputSchema = z.object({
  agentSlug: z.string(),
  reason: z.string(),
})

export type SummonAgentInput = z.infer<typeof SummonAgentInputSchema>

export const summonAgentTool = {
  name: 'summon_agent',
  description: 'Request another C-Suite agent to join this conversation',
  parameters: {
    type: 'object',
    properties: {
      agentSlug: {
        type: 'string',
        description: 'Slug of the agent to summon (e.g. "cto", "cfo")',
      },
      reason: {
        type: 'string',
        description: 'Why this agent is needed in the conversation',
      },
    },
    required: ['agentSlug', 'reason'],
    additionalProperties: false,
  },
} satisfies ToolDefinition

export interface SummonAgentDeps {
  publishEvent: (channel: string, payload: unknown) => Promise<void>
  projectId: string
  conversationId: string
  personaId: string
}

export async function executeSummonAgent(
  rawInput: unknown,
  deps: SummonAgentDeps,
): Promise<{ summoned: true; agentSlug: string }> {
  const input = SummonAgentInputSchema.parse(rawInput)
  await deps.publishEvent(`agent.summoned:${deps.projectId}`, {
    projectId: deps.projectId,
    conversationId: deps.conversationId,
    requestedByPersonaId: deps.personaId,
    agentSlug: input.agentSlug,
    reason: input.reason,
    ts: new Date().toISOString(),
  })
  return { summoned: true, agentSlug: input.agentSlug }
}
