'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

interface ThoughtsCollapseProps {
  thoughts: string
  tokenCount: number
  isStreaming: boolean
}

/**
 * Collapsible reasoning block shown above/below an agent bubble.
 * Collapsed by default; header ticks the token count in real time while streaming.
 */
export function ThoughtsCollapse({ thoughts, tokenCount, isStreaming }: ThoughtsCollapseProps) {
  const [expanded, setExpanded] = useState(false)

  const headerLabel = isStreaming
    ? `Thinking… ▸ ${tokenCount} tokens`
    : `Thoughts ▸ ${tokenCount} tokens`

  return (
    <div className="mt-1.5 overflow-hidden rounded-lg border border-border bg-muted/30">
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <span
          className={cn(
            'inline-block transition-transform duration-200',
            expanded ? 'rotate-90' : 'rotate-0',
          )}
          aria-hidden="true"
        >
          ▸
        </span>

        <span className="flex-1 text-left">{headerLabel}</span>

        {/* Pulse dot while streaming */}
        {isStreaming && (
          <span
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary"
            aria-hidden="true"
          />
        )}
      </button>

      {/* Expanded thoughts body */}
      {expanded && (
        <div className="border-t border-border px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
          {thoughts}
        </div>
      )}
    </div>
  )
}
