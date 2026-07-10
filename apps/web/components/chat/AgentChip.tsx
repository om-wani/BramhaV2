'use client'

import { cn } from '@/lib/utils'

interface AgentChipProps {
  personaId: string
  name: string
  slug: string
  color: string
  isStreaming: boolean
  onStop: () => void
}

/** Return up to two uppercase initials from a name string. */
function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
}

/**
 * Identity chip rendered above an agent's message bubble.
 * Shows a colored avatar, the agent name, @slug, a streaming pulse dot, and —
 * only while streaming — a Stop button.
 */
export function AgentChip({ name, slug, color, isStreaming, onStop }: AgentChipProps) {
  return (
    <div className="mb-1 flex items-center gap-2">
      {/* Colored avatar with initials */}
      <div
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      >
        {getInitials(name)}
      </div>

      {/* Agent name */}
      <span className="text-xs font-semibold text-foreground">{name}</span>

      {/* @slug */}
      <span className="text-xs text-muted-foreground">@{slug}</span>

      {/* Live streaming pulse */}
      {isStreaming && (
        <span
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary"
          aria-hidden="true"
        />
      )}

      {/* Stop button — only while streaming */}
      {isStreaming && (
        <button
          type="button"
          onClick={onStop}
          aria-label={`Stop ${name}`}
          className={cn(
            'ml-auto rounded border border-destructive/40 bg-destructive/10',
            'px-2 py-0.5 text-xs text-destructive transition-colors hover:bg-destructive/20',
          )}
        >
          Stop
        </button>
      )}
    </div>
  )
}
