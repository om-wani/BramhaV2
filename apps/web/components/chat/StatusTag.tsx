'use client'

import { cn } from '@/lib/utils'
import type { AgentStatus } from '@/stores/stream-store'

// ── Label map (from 04-doc §3) ─────────────────────────────────────────────────

const STATUS_LABELS: Record<AgentStatus, string> = {
  invoking_subagent: 'Invoking Sub-Agent',
  reading_database: 'Reading Database via MCP',
  running_code: 'Running Code',
  generating_artifact: 'Generating Artifact',
  waiting_for_approval: 'Waiting for Approval',
}

interface StatusTagProps {
  status: AgentStatus | null
}

/**
 * Inline pill shown beneath a streaming agent bubble.
 * Returns null when there is no active status, so callers can render it
 * unconditionally without adding dead whitespace.
 *
 * `waiting_for_approval` uses amber styling to draw the user's attention;
 * all other statuses use the muted neutral palette.
 */
export function StatusTag({ status }: StatusTagProps) {
  if (!status) return null

  const isWaiting = status === 'waiting_for_approval'
  const label = STATUS_LABELS[status]

  return (
    <div
      role="status"
      className={cn(
        'mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        isWaiting
          ? 'bg-amber-500/15 text-amber-500'
          : 'bg-muted text-muted-foreground',
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 animate-pulse rounded-full',
          isWaiting ? 'bg-amber-500' : 'bg-muted-foreground',
        )}
        aria-hidden="true"
      />
      {label}
    </div>
  )
}
