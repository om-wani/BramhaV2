'use client'

import { cn } from '@/lib/utils'
import type { Branch } from '@/lib/stores/chat-store'

interface BranchChipsProps {
  branches: Branch[]
  activeBranchId: string
  onSwitch: (branchId: string) => void
}

/**
 * Horizontal scrollable row of branch chips.  Rendered inline at each fork
 * point in the message list so users can see and switch between siblings.
 */
export function BranchChips({ branches, activeBranchId, onSwitch }: BranchChipsProps) {
  if (branches.length <= 1) return null

  return (
    <div
      aria-label="Branch selector"
      className="flex items-center gap-2 overflow-x-auto border-y border-border/40 bg-muted/30 px-4 py-2 scrollbar-none"
    >
      <span className="shrink-0 text-xs text-muted-foreground">Branches:</span>
      {branches.map((branch) => {
        const isActive = branch.id === activeBranchId
        return (
          <button
            key={branch.id}
            onClick={() => onSwitch(branch.id)}
            aria-pressed={isActive}
            aria-label={`Switch to branch ${branch.name}`}
            className={cn(
              'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {branch.name}
          </button>
        )
      })}
    </div>
  )
}
