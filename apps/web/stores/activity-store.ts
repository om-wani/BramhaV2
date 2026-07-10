'use client'

import { create } from 'zustand'

// ── Types ──────────────────────────────────────────────────────────────────────

export type DelegationStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'cancelled'

export interface ActivityEntry {
  delegationId: string
  projectId: string
  workerSlug: string
  objective: string
  status: DelegationStatus
  progressPct: number // 0–100
  costUsd: number
  createdAt: string
  completedAt: string | null
  originNodeId: string | null
  conversationId: string | null
}

interface ActivityStore {
  entries: Map<string, ActivityEntry> // key: delegationId
  isExpanded: boolean
  /** Internal: tracks which project's expanded state is currently loaded. */
  _currentProjectId: string | null

  /**
   * Hydrate `isExpanded` from localStorage for the given project.
   * Must be called once per project mount (from ActivityPane useEffect).
   */
  initExpanded: (projectId: string) => void

  toggleExpanded: () => void
  upsertEntry: (entry: ActivityEntry) => void
  updateProgress: (delegationId: string, pct: number) => void
  updateStatus: (delegationId: string, status: DelegationStatus, completedAt?: string) => void
  cancelDelegation: (delegationId: string, projectId: string) => Promise<void>
  clearCompleted: () => void
}

const STORAGE_KEY = (projectId: string) => `bramha:activity:expanded:${projectId}`

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'

// ── Store ──────────────────────────────────────────────────────────────────────

export const useActivityStore = create<ActivityStore>((set, get) => ({
  entries: new Map(),
  isExpanded: false,
  _currentProjectId: null,

  initExpanded: (projectId) => {
    let expanded = false
    if (typeof window !== 'undefined') {
      try {
        expanded = localStorage.getItem(STORAGE_KEY(projectId)) === 'true'
      } catch {
        // storage access denied — ignore
      }
    }
    set({ isExpanded: expanded, _currentProjectId: projectId })
  },

  toggleExpanded: () => {
    set((state) => {
      const next = !state.isExpanded
      if (state._currentProjectId && typeof window !== 'undefined') {
        try {
          localStorage.setItem(STORAGE_KEY(state._currentProjectId), String(next))
        } catch {
          // ignore
        }
      }
      return { isExpanded: next }
    })
  },

  upsertEntry: (entry) =>
    set((state) => {
      const next = new Map(state.entries)
      const existing = next.get(entry.delegationId)
      // Merge: preserve fields from existing entry that the new payload doesn't override
      next.set(entry.delegationId, existing ? { ...existing, ...entry } : entry)
      return { entries: next }
    }),

  updateProgress: (delegationId, pct) =>
    set((state) => {
      const entry = state.entries.get(delegationId)
      if (!entry) return state
      const next = new Map(state.entries)
      next.set(delegationId, {
        ...entry,
        progressPct: Math.max(0, Math.min(100, pct)),
      })
      return { entries: next }
    }),

  updateStatus: (delegationId, status, completedAt) =>
    set((state) => {
      const entry = state.entries.get(delegationId)
      if (!entry) return state
      const next = new Map(state.entries)
      next.set(delegationId, {
        ...entry,
        status,
        completedAt: completedAt ?? entry.completedAt,
      })
      return { entries: next }
    }),

  cancelDelegation: async (delegationId, projectId) => {
    const res = await fetch(
      `${API_BASE}/projects/${projectId}/delegations/${delegationId}`,
      { method: 'DELETE', credentials: 'include' },
    )
    if (!res.ok) {
      throw new Error(`Cancel failed with status ${res.status}`)
    }
    // Confirm cancellation in local state
    const entry = get().entries.get(delegationId)
    if (entry) {
      set((state) => {
        const next = new Map(state.entries)
        next.set(delegationId, { ...entry, status: 'cancelled' })
        return { entries: next }
      })
    }
  },

  clearCompleted: () =>
    set((state) => {
      const next = new Map(state.entries)
      for (const [key, entry] of next) {
        if (
          entry.status === 'completed' ||
          entry.status === 'failed' ||
          entry.status === 'timeout' ||
          entry.status === 'cancelled'
        ) {
          next.delete(key)
        }
      }
      return { entries: next }
    }),
}))
