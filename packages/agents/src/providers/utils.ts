/**
 * Shared utilities for provider implementations.
 *
 * This file is in packages/agents/src/providers/** and may import vendor SDKs.
 * Do NOT import this from outside providers/**.
 */

// ── Vendor SDK imports (allowed only in packages/agents/src/providers/**) ─────
import { jsonSchema, type ToolSet } from 'ai'

import type { ToolDefinition } from './types.js'

/**
 * Build a Vercel AI SDK ToolSet from our internal ToolDefinition array.
 * Returns undefined when toolDefs is empty (signals "no tools" to the SDK).
 *
 * Uses two separate reduce branches so `description` is never typed as
 * `string | undefined` — required by exactOptionalPropertyTypes: true.
 */
export function buildToolSet(toolDefs: ToolDefinition[]): ToolSet | undefined {
  if (toolDefs.length === 0) return undefined
  return toolDefs.reduce<ToolSet>((acc, t) => {
    const params = jsonSchema(t.parameters as Parameters<typeof jsonSchema>[0])
    if (t.description !== undefined) {
      acc[t.name] = { parameters: params, description: t.description }
    } else {
      acc[t.name] = { parameters: params }
    }
    return acc
  }, {})
}
