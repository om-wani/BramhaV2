'use client'

import { useEffect } from 'react'
import { getSocket } from '@/lib/socket'
import { useActivityStore } from '@/stores/activity-store'
import type { ActivityEntry } from '@/stores/activity-store'

/**
 * Subscribe to delegation lifecycle events for the given project via the
 * existing Socket.IO singleton.  Returns void — this hook is a pure side-effect.
 *
 * Events consumed (all scoped to `:projectId`):
 *   delegation.created   → upsertEntry (status: queued)
 *   delegation.started   → updateStatus → running
 *   delegation.progress  → updateProgress
 *   delegation.completed → updateStatus → completed
 *   delegation.failed    → updateStatus → failed
 *   delegation.timeout   → updateStatus → timeout
 *   delegation.cancelled → updateStatus → cancelled
 *
 * Uses `useActivityStore.getState()` inside handlers to avoid stale closure
 * issues (same pattern as useAgentStream.ts).
 */
export function useActivityEvents(projectId: string): void {
  useEffect(() => {
    const sock = getSocket()
    if (!sock) return

    // ── Handlers ─────────────────────────────────────────────────────────────

    const onCreated = (payload: unknown) => {
      const p = payload as Partial<ActivityEntry>
      if (!p.delegationId) return
      useActivityStore.getState().upsertEntry({
        delegationId: p.delegationId,
        projectId,
        workerSlug: p.workerSlug ?? '',
        objective: p.objective ?? '',
        status: 'queued',
        progressPct: 0,
        costUsd: p.costUsd ?? 0,
        createdAt: p.createdAt ?? new Date().toISOString(),
        completedAt: null,
        originNodeId: p.originNodeId ?? null,
        conversationId: p.conversationId ?? null,
      })
    }

    const onStarted = (payload: unknown) => {
      const p = payload as { delegationId?: string }
      if (!p.delegationId) return
      useActivityStore.getState().updateStatus(p.delegationId, 'running')
    }

    const onProgress = (payload: unknown) => {
      const p = payload as { delegationId?: string; progressPct?: number }
      if (!p.delegationId) return
      useActivityStore.getState().updateProgress(p.delegationId, p.progressPct ?? 0)
    }

    const onCompleted = (payload: unknown) => {
      const p = payload as { delegationId?: string; completedAt?: string }
      if (!p.delegationId) return
      useActivityStore.getState().updateStatus(p.delegationId, 'completed', p.completedAt)
    }

    const onFailed = (payload: unknown) => {
      const p = payload as { delegationId?: string }
      if (!p.delegationId) return
      useActivityStore.getState().updateStatus(p.delegationId, 'failed')
    }

    const onTimeout = (payload: unknown) => {
      const p = payload as { delegationId?: string }
      if (!p.delegationId) return
      useActivityStore.getState().updateStatus(p.delegationId, 'timeout')
    }

    const onCancelled = (payload: unknown) => {
      const p = payload as { delegationId?: string }
      if (!p.delegationId) return
      useActivityStore.getState().updateStatus(p.delegationId, 'cancelled')
    }

    // ── Subscribe ─────────────────────────────────────────────────────────────

    sock.on(`delegation.created:${projectId}`, onCreated)
    sock.on(`delegation.started:${projectId}`, onStarted)
    sock.on(`delegation.progress:${projectId}`, onProgress)
    sock.on(`delegation.completed:${projectId}`, onCompleted)
    sock.on(`delegation.failed:${projectId}`, onFailed)
    sock.on(`delegation.timeout:${projectId}`, onTimeout)
    sock.on(`delegation.cancelled:${projectId}`, onCancelled)

    return () => {
      sock.off(`delegation.created:${projectId}`, onCreated)
      sock.off(`delegation.started:${projectId}`, onStarted)
      sock.off(`delegation.progress:${projectId}`, onProgress)
      sock.off(`delegation.completed:${projectId}`, onCompleted)
      sock.off(`delegation.failed:${projectId}`, onFailed)
      sock.off(`delegation.timeout:${projectId}`, onTimeout)
      sock.off(`delegation.cancelled:${projectId}`, onCancelled)
    }
  }, [projectId])
}
