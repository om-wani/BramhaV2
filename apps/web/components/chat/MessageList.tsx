'use client'

import { useRef, useEffect, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { MessageBubble } from './MessageBubble'
import { BranchChips } from './BranchChips'
import { Skeleton } from '@/components/ui/skeleton'
import { useChatStore } from '@/lib/stores/chat-store'
import type { ConversationNode } from '@/lib/stores/chat-store'

// ── Types ──────────────────────────────────────────────────────────────────────

type RowItem =
  | { type: 'node'; node: ConversationNode }
  | { type: 'branch-chips'; forkNodeId: string }

// ── Component ──────────────────────────────────────────────────────────────────

interface MessageListProps {
  isLoading: boolean
  isTransitioning: boolean
  onBranch: (nodeId: string) => void
  onSwitchBranch: (branchId: string) => void
}

export function MessageList({
  isLoading,
  isTransitioning,
  onBranch,
  onSwitchBranch,
}: MessageListProps) {
  const { nodes, nodeOrder, branches, activeBranchId } = useChatStore()
  const parentRef = useRef<HTMLDivElement>(null)

  // Ordered nodes for the active branch
  const orderedNodes = useMemo<ConversationNode[]>(() => {
    return nodeOrder
      .map((id) => nodes.get(id))
      .filter((n): n is ConversationNode => n !== undefined)
  }, [nodes, nodeOrder])

  // Set of node ids that are fork points (parent of multiple branches)
  const forkPointIds = useMemo<Set<string>>(() => {
    const forks = new Set<string>()
    for (const branch of branches) {
      if (branch.forkedFromNode) forks.add(branch.forkedFromNode)
    }
    return forks
  }, [branches])

  // Build the flat item list: each message may be followed by a branch-chips row
  const items = useMemo<RowItem[]>(() => {
    const result: RowItem[] = []
    for (const node of orderedNodes) {
      result.push({ type: 'node', node })
      if (forkPointIds.has(node.id)) {
        result.push({ type: 'branch-chips', forkNodeId: node.id })
      }
    }
    return result
  }, [orderedNodes, forkPointIds])

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      // eslint-disable-next-line security/detect-object-injection
      const item: RowItem | undefined = items[index]
      if (item?.type === 'branch-chips') return 44
      return 80
    },
    overscan: 5,
  })

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (items.length > 0 && !isLoading) {
      rowVirtualizer.scrollToIndex(items.length - 1, { behavior: 'smooth' })
    }
    // We intentionally only depend on length — not the virtualizer instance
    }, [items.length, isLoading])

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="flex-1 space-y-3 p-4" aria-busy="true" aria-label="Loading messages">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className={`h-14 rounded-2xl ${i % 2 === 0 ? 'ml-auto w-2/3' : 'w-3/4'}`} />
        ))}
      </div>
    )
  }

  // Empty state
  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Send a message to start the conversation.
        </p>
      </div>
    )
  }

  return (
    <div
      ref={parentRef}
      role="log"
      aria-label="Conversation messages"
      aria-live="polite"
      className="flex-1 overflow-auto"
      style={{
        opacity: isTransitioning ? 0 : 1,
        transition: 'opacity 150ms ease-in-out',
      }}
    >
      <div
        style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const item: RowItem | undefined = items[virtualRow.index]
          if (!item) return null

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={rowVirtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {item.type === 'node' ? (
                <MessageBubble node={item.node} onBranch={onBranch} />
              ) : (
                <BranchChips
                  branches={branches}
                  activeBranchId={activeBranchId ?? ''}
                  onSwitch={onSwitchBranch}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
