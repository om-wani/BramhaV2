'use client'

import { useEffect, useState } from 'react'
import { ChevronUp, ChevronDown, X, ExternalLink, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useActivityStore } from '@/stores/activity-store'
import type { ActivityEntry, DelegationStatus } from '@/stores/activity-store'

// ── Status display configuration ───────────────────────────────────────────────

const STATUS_LABELS: Record<DelegationStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  waiting_approval: 'Waiting Approval',
  completed: 'Completed',
  failed: 'Failed',
  timeout: 'Timed Out',
  cancelled: 'Cancelled',
}

const STATUS_BADGE: Record<DelegationStatus, string> = {
  queued: 'bg-muted text-muted-foreground',
  running: 'bg-blue-500/15 text-blue-400',
  waiting_approval: 'bg-amber-500/15 text-amber-500',
  completed: 'bg-emerald-500/15 text-emerald-500',
  failed: 'bg-red-500/15 text-red-400',
  timeout: 'bg-orange-500/15 text-orange-400',
  cancelled: 'bg-muted text-muted-foreground',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`
}

// ── ActivityEntryRow ───────────────────────────────────────────────────────────

interface ActivityEntryRowProps {
  entry: ActivityEntry
  projectId: string
}

function ActivityEntryRow({ entry, projectId }: ActivityEntryRowProps) {
  const [rowExpanded, setRowExpanded] = useState(false)
  const cancelDelegation = useActivityStore((s) => s.cancelDelegation)

  const canCancel = entry.status === 'queued' || entry.status === 'running'
  const isRunning = entry.status === 'running'
  const isCompleted = entry.status === 'completed'

  // Build "View report" href — only expose delegationId (UUID), never queue-internal identifiers
  const reportHref =
    isCompleted && entry.conversationId
      ? `/p/${projectId}/graph/${entry.conversationId}${entry.originNodeId ? `#${entry.originNodeId}` : ''}`
      : null

  const handleCancel = async () => {
    try {
      await cancelDelegation(entry.delegationId, entry.projectId)
    } catch {
      // Cancellation error is non-fatal; user can retry
    }
  }

  return (
    <div className="border-b border-border/50 px-4 py-2.5 last:border-0">
      <div className="flex items-start gap-2">
        {/* Status badge */}
        <span
          className={cn(
            'mt-0.5 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium',
            STATUS_BADGE[entry.status],
          )}
          aria-label={`Status: ${STATUS_LABELS[entry.status]}`}
        >
          {STATUS_LABELS[entry.status]}
        </span>

        {/* Main content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs font-medium text-foreground">
              {entry.workerSlug}
            </p>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {formatCost(entry.costUsd)}
            </span>
          </div>

          <p className="mt-0.5 text-xs text-muted-foreground">
            {rowExpanded ? entry.objective : truncate(entry.objective, 60)}
          </p>

          {/* Progress bar — only shown when running */}
          {isRunning && (
            <div
              className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={entry.progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Task progress"
            >
              <div
                className="h-full rounded-full bg-blue-500 transition-[width] duration-300 ease-in-out animate-pulse"
                style={{ width: `${entry.progressPct}%` }}
              />
            </div>
          )}

          {/* Expanded detail: timestamps */}
          {rowExpanded && (
            <p className="mt-1 text-xs text-muted-foreground/70">
              {`Started: ${new Date(entry.createdAt).toLocaleTimeString()}`}
              {entry.completedAt
                ? ` · Completed: ${new Date(entry.completedAt).toLocaleTimeString()}`
                : null}
            </p>
          )}
        </div>

        {/* Row actions */}
        <div className="flex shrink-0 items-center gap-1">
          {/* View report — only for completed entries with a linked conversation */}
          {reportHref !== null && (
            <a
              href={reportHref}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-emerald-500 hover:bg-emerald-500/10"
              aria-label="View report"
            >
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              View report
            </a>
          )}

          {/* Cancel — queued or running only */}
          {canCancel && (
            <button
              type="button"
              onClick={handleCancel}
              className="inline-flex items-center rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label="Cancel task"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}

          {/* Expand/collapse row details */}
          <button
            type="button"
            onClick={() => setRowExpanded((prev) => !prev)}
            className="inline-flex items-center rounded p-0.5 text-muted-foreground hover:bg-muted"
            aria-label={rowExpanded ? 'Collapse details' : 'Expand details'}
            aria-expanded={rowExpanded}
          >
            {rowExpanded ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── ActivityPane ───────────────────────────────────────────────────────────────

export interface ActivityPaneProps {
  projectId: string
}

/**
 * Collapsed strip (default) at the bottom of the chat view that expands to a
 * scrollable list of delegation entries.  Reads exclusively from
 * `useActivityStore` — raw BullMQ job IDs are never surfaced here.
 */
export function ActivityPane({ projectId }: ActivityPaneProps) {
  const entries = useActivityStore((s) => s.entries)
  const isExpanded = useActivityStore((s) => s.isExpanded)
  const toggleExpanded = useActivityStore((s) => s.toggleExpanded)
  const initExpanded = useActivityStore((s) => s.initExpanded)
  const clearCompleted = useActivityStore((s) => s.clearCompleted)

  // Hydrate expanded state from localStorage for this project
  useEffect(() => {
    initExpanded(projectId)
  }, [projectId, initExpanded])

  // Filter to this project's entries (store is global; entries carry projectId)
  const projectEntries = Array.from(entries.values()).filter(
    (e) => e.projectId === projectId,
  )

  const activeEntries = projectEntries.filter(
    (e) =>
      e.status === 'queued' ||
      e.status === 'running' ||
      e.status === 'waiting_approval',
  )

  const totalCost = projectEntries.reduce((sum, e) => sum + e.costUsd, 0)
  const hasEntries = projectEntries.length > 0
  const hasActive = activeEntries.length > 0

  // ── Collapsed strip ─────────────────────────────────────────────────────────

  if (!isExpanded) {
    return (
      <button
        type="button"
        className="flex h-8 w-full items-center justify-between border-t border-border bg-card px-4 transition-colors hover:bg-muted/50"
        onClick={toggleExpanded}
        aria-expanded={false}
        aria-label="Background tasks — click to expand"
      >
        <div className="flex items-center gap-2">
          <Activity
            className={cn(
              'h-3.5 w-3.5',
              hasActive ? 'animate-pulse text-blue-400' : 'text-muted-foreground',
            )}
            aria-hidden="true"
          />
          <span className="text-xs text-muted-foreground">
            {activeEntries.length > 0
              ? `${activeEntries.length} active task${activeEntries.length !== 1 ? 's' : ''}`
              : hasEntries
                ? 'No active tasks'
                : 'Background tasks'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {hasEntries && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatCost(totalCost)}
            </span>
          )}
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        </div>
      </button>
    )
  }

  // ── Expanded pane ───────────────────────────────────────────────────────────

  return (
    <div
      className="flex max-h-64 flex-col border-t border-border bg-card"
      role="region"
      aria-label="Background tasks"
    >
      {/* Pane header */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-2">
        <div className="flex items-center gap-2">
          <Activity
            className={cn(
              'h-3.5 w-3.5',
              hasActive ? 'animate-pulse text-blue-400' : 'text-muted-foreground',
            )}
            aria-hidden="true"
          />
          <span className="text-xs font-medium text-foreground">Background Tasks</span>
          {activeEntries.length > 0 && (
            <span className="rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
              {activeEntries.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {hasEntries && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {`Total: ${formatCost(totalCost)}`}
            </span>
          )}
          <button
            type="button"
            onClick={clearCompleted}
            className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Clear completed tasks"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={toggleExpanded}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted"
            aria-label="Collapse background tasks"
            aria-expanded={true}
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Entry list */}
      <div className="overflow-y-auto" aria-label="Task list">
        {projectEntries.length === 0 ? (
          <p className="px-4 py-3 text-center text-xs text-muted-foreground">
            No background tasks.
          </p>
        ) : (
          projectEntries.map((entry) => (
            <ActivityEntryRow key={entry.delegationId} entry={entry} projectId={projectId} />
          ))
        )}
      </div>
    </div>
  )
}
