'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AgentOption {
  personaId: string
  slug: string
  name: string
  title: string
  color: string
}

interface MentionMenuProps {
  query: string
  agents: AgentOption[]
  onSelect: (agent: AgentOption) => void
  onDismiss: () => void
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
}

/**
 * @mention autocomplete dropdown.
 *
 * Renders at most 6 agents filtered by slug prefix OR case-insensitive name
 * match.  Supports keyboard navigation: ArrowUp/Down, Enter to select, Escape
 * to dismiss.
 *
 * Position the parent as `relative`; this element uses `absolute bottom-full`
 * to float above the composer.
 */
export function MentionMenu({ query, agents, onSelect, onDismiss }: MentionMenuProps) {
  const [activeIndex, setActiveIndex] = useState(0)

  const filtered = agents
    .filter(
      (a) =>
        a.slug.startsWith(query) ||
        a.name.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 6)

  // Reset selection when the filtered list changes
  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          onDismiss()
          break
        case 'ArrowDown':
          e.preventDefault()
          setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setActiveIndex((i) => Math.max(i - 1, 0))
          break
        case 'Enter': {
          e.preventDefault()
          const agent = filtered[activeIndex]
          if (agent) onSelect(agent)
          break
        }
        default:
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [filtered, activeIndex, onSelect, onDismiss])

  if (filtered.length === 0) return null

  return (
    <div
      role="listbox"
      aria-label="Mention an agent"
      className={cn(
        'absolute bottom-full left-0 z-50 mb-1 w-72 overflow-hidden rounded-xl',
        'border border-border bg-popover shadow-lg',
      )}
    >
      {filtered.map((agent, i) => (
        <div
          key={agent.personaId}
          role="option"
          aria-selected={i === activeIndex}
          onClick={() => onSelect(agent)}
          className={cn(
            'flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm transition-colors',
            i === activeIndex
              ? 'bg-accent text-accent-foreground'
              : 'text-popover-foreground hover:bg-accent/50',
          )}
        >
          {/* Colored avatar with initials */}
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
            style={{ backgroundColor: agent.color }}
            aria-hidden="true"
          >
            {getInitials(agent.name)}
          </div>

          {/* Info column */}
          <div className="flex min-w-0 flex-col">
            <span className="font-medium">@{agent.slug}</span>
            <span className="truncate text-xs text-muted-foreground">
              {agent.name} · {agent.title}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
