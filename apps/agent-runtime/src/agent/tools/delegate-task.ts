/**
 * delegate_task core tool.
 * Enqueues a delegation job for a specialist worker agent.
 */

import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { ToolDefinition } from '@bramha/agents'

export const DelegateTaskInputSchema = z.object({
  workerType: z.string(),
  taskDescription: z.string(),
  inputs: z.record(z.string(), z.unknown()).default({}),
})

export type DelegateTaskInput = z.infer<typeof DelegateTaskInputSchema>

export const delegateTaskTool = {
  name: 'delegate_task',
  description: 'Delegate a task to a specialist worker agent',
  parameters: {
    type: 'object',
    properties: {
      workerType: {
        type: 'string',
        description: 'Worker type slug (e.g. "researcher", "analyst")',
      },
      taskDescription: {
        type: 'string',
        description: 'Plain-language description of the work to be done',
      },
      inputs: {
        type: 'object',
        additionalProperties: true,
        default: {},
        description: 'Structured inputs for the worker',
      },
    },
    required: ['workerType', 'taskDescription'],
    additionalProperties: false,
  },
} satisfies ToolDefinition

export interface DelegateTaskDeps {
  enqueueDelegation: (data: unknown) => Promise<{ delegationId: string }>
  projectId: string
  personaId: string
  conversationId: string
}

export async function executeDelegateTask(
  rawInput: unknown,
  deps: DelegateTaskDeps,
): Promise<{ delegationId: string }> {
  const input = DelegateTaskInputSchema.parse(rawInput)
  const delegationId = randomUUID()
  await deps.enqueueDelegation({
    delegationId,
    projectId: deps.projectId,
    requestedByPersonaId: deps.personaId,
    conversationId: deps.conversationId,
    workerType: input.workerType,
    taskDescription: input.taskDescription,
    inputs: input.inputs,
    enqueuedAt: new Date().toISOString(),
  })
  return { delegationId }
}
