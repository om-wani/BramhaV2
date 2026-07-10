'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { SourceResponseSchema, SourceHistoryEntrySchema } from '@bramha/shared'
import type { SourceResponse, SourceHistoryEntry } from '@bramha/shared'
import { api } from '@/lib/api-client'
import {
  Lock,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronRight,
  Globe,
  Database,
  Github,
  GitBranch,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Type icon map ─────────────────────────────────────────────────────────────

function SourceTypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'github_repo':
      return <Github className="h-4 w-4 shrink-0" aria-hidden="true" />
    case 'gitlab_repo':
      return <GitBranch className="h-4 w-4 shrink-0" aria-hidden="true" />
    case 'sql_database':
      return <Database className="h-4 w-4 shrink-0" aria-hidden="true" />
    case 'url':
      return <Globe className="h-4 w-4 shrink-0" aria-hidden="true" />
    default:
      return <Globe className="h-4 w-4 shrink-0" aria-hidden="true" />
  }
}

// ── Source label ──────────────────────────────────────────────────────────────

function sourceLabel(source: SourceResponse): string {
  const cfg = source.config
  if (cfg['repoUrl'] && typeof cfg['repoUrl'] === 'string') return cfg['repoUrl']
  if (cfg['rootUrl'] && typeof cfg['rootUrl'] === 'string') return cfg['rootUrl']
  if (cfg['host'] && typeof cfg['host'] === 'string') {
    return `${cfg['host']}/${cfg['database'] ?? ''}`
  }
  return source.type
}

// ── Sync status badge ─────────────────────────────────────────────────────────

function SyncStatusBadge({ status }: { status: string | null }) {
  if (!status) return null

  if (status === 'success') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-green-600 bg-green-600/10">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        Synced
      </span>
    )
  }
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-blue-600 bg-blue-600/10">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        Syncing…
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-destructive bg-destructive/10">
        <XCircle className="h-3 w-3" aria-hidden="true" />
        Failed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-muted-foreground bg-muted">
      <AlertCircle className="h-3 w-3" aria-hidden="true" />
      {status}
    </span>
  )
}

// ── Job status badge ──────────────────────────────────────────────────────────

function JobStatusBadge({ status }: { status: string }) {
  const color =
    status === 'done' ? 'text-green-600 bg-green-600/10' :
    status === 'failed' ? 'text-destructive bg-destructive/10' :
    'text-muted-foreground bg-muted'

  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', color)}>
      {status}
    </span>
  )
}

// ── History accordion ─────────────────────────────────────────────────────────

function SourceHistory({ projectId, sourceId }: { projectId: string; sourceId: string }) {
  const { data: history, isLoading } = useQuery({
    queryKey: ['source-history', projectId, sourceId],
    queryFn: () => api.get(`/projects/${projectId}/sources/${sourceId}/history`, z.array(SourceHistoryEntrySchema)),
  })

  if (isLoading) {
    return (
      <div className="py-4 text-center text-xs text-muted-foreground">
        <Loader2 className="mx-auto mb-1 h-4 w-4 animate-spin" />
        Loading history…
      </div>
    )
  }

  if (!history || history.length === 0) {
    return <p className="py-4 text-center text-xs text-muted-foreground">No sync history yet</p>
  }

  return (
    <ul className="space-y-2">
      {history.map((entry: SourceHistoryEntry) => (
        <li key={entry.id} className="rounded border bg-background px-3 py-2 text-xs">
          <div className="flex items-center justify-between">
            <JobStatusBadge status={entry.status} />
            <span className="text-muted-foreground">
              {new Date(entry.createdAt).toLocaleString()}
            </span>
          </div>
          {entry.stats && (
            <div className="mt-1 text-muted-foreground">
              {Object.entries(entry.stats)
                .map(([k, v]) => `${k}: ${String(v)}`)
                .join(' · ')}
            </div>
          )}
          {entry.error && (
            <p className="mt-1 text-destructive">{entry.error}</p>
          )}
        </li>
      ))}
    </ul>
  )
}

// ── SourceRow ─────────────────────────────────────────────────────────────────

function SourceRow({
  source,
  projectId,
  onDelete,
  onSync,
}: {
  source: SourceResponse
  projectId: string
  onDelete: (id: string) => void
  onSync: (id: string) => void
}) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)

  return (
    <li className="rounded-lg border bg-card">
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <SourceTypeIcon type={source.type} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground" title={sourceLabel(source)}>
            {sourceLabel(source)}
          </p>
          <div className="mt-0.5 flex items-center gap-2">
            {source.hasCredential && (
              <span title="Credential stored" className="text-muted-foreground">
                <Lock className="h-3 w-3" aria-label="Has credential" />
              </span>
            )}
            {source.lastSyncAt && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" aria-hidden="true" />
                {new Date(source.lastSyncAt).toLocaleString()}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <SyncStatusBadge status={source.lastSyncStatus} />

          <button
            type="button"
            onClick={() => onSync(source.id)}
            aria-label={`Sync ${sourceLabel(source)}`}
            className="rounded p-1 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </button>

          {confirming ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onDelete(source.id)}
                className="rounded px-2 py-0.5 text-xs font-medium text-destructive hover:bg-destructive/10"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              aria-label={`Delete ${sourceLabel(source)}`}
              className="rounded p-1 text-muted-foreground hover:text-destructive focus:outline-none focus:ring-2 focus:ring-destructive"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setHistoryOpen((o) => !o)}
            aria-expanded={historyOpen}
            aria-label="Toggle sync history"
            className="rounded p-1 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {historyOpen ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* History accordion */}
      {historyOpen && (
        <div className="border-t px-4 py-3">
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Sync History
          </h3>
          <SourceHistory projectId={projectId} sourceId={source.id} />
        </div>
      )}
    </li>
  )
}

// ── SourceList ────────────────────────────────────────────────────────────────

interface SourceListProps {
  projectId: string
}

export function SourceList({ projectId }: SourceListProps) {
  const queryClient = useQueryClient()

  const { data: sources, isLoading } = useQuery({
    queryKey: ['sources', projectId],
    queryFn: () => api.get(`/projects/${projectId}/sources`, z.array(SourceResponseSchema)),
    refetchInterval: (query) => {
      const data = query.state.data
      if (Array.isArray(data) && data.some((s: SourceResponse) => s.lastSyncStatus === 'running')) return 5000
      return false
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (sourceId: string) =>
      api.delete(`/projects/${projectId}/sources/${sourceId}`, z.unknown()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sources', projectId] })
    },
  })

  const syncMutation = useMutation({
    mutationFn: (sourceId: string) =>
      api.post(`/projects/${projectId}/sources/${sourceId}/sync`, z.object({ jobId: z.string() }), {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sources', projectId] })
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Loading sources…
      </div>
    )
  }

  if (!sources || sources.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-muted-foreground">
        No knowledge sources connected yet.
      </div>
    )
  }

  return (
    <ul className="space-y-2" aria-label="Connected knowledge sources">
      {sources.map((source: SourceResponse) => (
        <SourceRow
          key={source.id}
          source={source}
          projectId={projectId}
          onDelete={(id) => deleteMutation.mutate(id)}
          onSync={(id) => syncMutation.mutate(id)}
        />
      ))}
    </ul>
  )
}
