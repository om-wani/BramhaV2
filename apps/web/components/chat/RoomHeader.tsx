'use client'

import { Layers } from 'lucide-react'
import { useChatStore } from '@/lib/stores/chat-store'
import { cn } from '@/lib/utils'

interface Room {
  id: string
  name: string
  type: string
}

interface RoomHeaderProps {
  room: Room | null
  onSwitchBranch: (branchId: string) => void
  artifactsOpen: boolean
  onToggleArtifacts: () => void
}

/**
 * Top bar for a chat room.
 * Shows the room name, current branch (when not on 'main'), a branch
 * selector dropdown when multiple branches exist, and the Artifacts pane toggle.
 */
export function RoomHeader({ room, onSwitchBranch, artifactsOpen, onToggleArtifacts }: RoomHeaderProps) {
  const { branches, activeBranchId, isConnected } = useChatStore()
  const activeBranch = branches.find((b) => b.id === activeBranchId)
  const isNonMainBranch = activeBranch && activeBranch.name !== 'main'

  return (
    <header className="flex items-center justify-between border-b border-border px-6 py-3.5">
      <div className="min-w-0">
        <h1 className="truncate text-base font-semibold">
          {room?.name ?? 'Conference'}
        </h1>
        {isNonMainBranch && (
          <p className="text-xs text-muted-foreground">
            Branch:{' '}
            <span className="font-medium text-primary">{activeBranch.name}</span>
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Realtime connection indicator */}
        <span
          aria-label={isConnected ? 'Connected' : 'Disconnected'}
          title={isConnected ? 'Connected' : 'Reconnecting…'}
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: isConnected ? 'hsl(142 71% 45%)' : 'hsl(38 92% 50%)' }}
        />

        <button
          type="button"
          onClick={onToggleArtifacts}
          aria-pressed={artifactsOpen}
          aria-label={artifactsOpen ? 'Hide artifacts pane' : 'Show artifacts pane'}
          title="Artifacts"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors',
            artifactsOpen
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-input text-muted-foreground hover:bg-card',
          )}
        >
          <Layers className="h-3.5 w-3.5" aria-hidden />
          Artifacts
        </button>

        {/* Branch selector dropdown — only when there are multiple branches */}
        {branches.length > 1 && (
          <div className="flex items-center gap-1.5">
            <label
              htmlFor="room-branch-select"
              className="text-xs text-muted-foreground"
            >
              Branch
            </label>
            <select
              id="room-branch-select"
              value={activeBranchId ?? ''}
              onChange={(e) => onSwitchBranch(e.target.value)}
              className="rounded-md border border-input bg-card px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="Switch branch"
            >
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </header>
  )
}
