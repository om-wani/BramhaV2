/**
 * Tests for the Background Activity pane (T3.4.2).
 *
 * Coverage:
 *   - ActivityPane collapsed strip (active count display)
 *   - Click to expand
 *   - Running entry progress bar
 *   - Progress bar updates via store
 *   - Cancel button visibility (queued/running only)
 *   - Cancel button calls DELETE + updates status
 *   - Completed entry "View report" link
 *   - Status badge labels (spot checks)
 *   - cancelDelegation store action API endpoint
 *   - useActivityEvents: delegation.progress → updateProgress
 *   - useActivityEvents: delegation.completed → status becomes 'completed'
 *   - isExpanded localStorage persistence
 *   - Security: no BullMQ job IDs in rendered output
 *   - Security: entries from different project not rendered
 */

import React from 'react'
import { render, screen, fireEvent, act, renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { ActivityPane } from './ActivityPane'
import { useActivityStore } from '@/stores/activity-store'
import type { ActivityEntry } from '@/stores/activity-store'
import { useActivityEvents } from '@/hooks/useActivityEvents'

// ── Socket mock (vi.hoisted ensures this runs before imports) ──────────────────

const socketHandlers = vi.hoisted(
  () => new Map<string, (payload: unknown) => void>(),
)

vi.mock('@/lib/socket', () => ({
  getSocket: () => ({
    on: (event: string, handler: (payload: unknown) => void) => {
      socketHandlers.set(event, handler)
    },
    off: () => undefined,
  }),
  createSocket: vi.fn(),
  destroySocket: vi.fn(),
}))

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    delegationId: 'd1',
    projectId: 'proj-1',
    workerSlug: 'ceo',
    objective: 'Prepare Q3 financial forecast for board presentation',
    status: 'queued',
    progressPct: 0,
    costUsd: 0.05,
    createdAt: new Date().toISOString(),
    completedAt: null,
    originNodeId: null,
    conversationId: null,
    ...overrides,
  }
}

function resetStore() {
  useActivityStore.setState({
    entries: new Map(),
    isExpanded: false,
    _currentProjectId: null,
  })
}

// ── beforeEach / afterEach ────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear()
  resetStore()
  socketHandlers.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── 1. Collapsed strip shows active count ─────────────────────────────────────

describe('ActivityPane — collapsed strip', () => {
  it('shows active task count when entries are running/queued', () => {
    useActivityStore.getState().upsertEntry(makeEntry({ status: 'running', delegationId: 'd1' }))
    useActivityStore.getState().upsertEntry(makeEntry({ status: 'queued', delegationId: 'd2' }))
    useActivityStore.getState().upsertEntry(makeEntry({ status: 'completed', delegationId: 'd3' }))

    render(<ActivityPane projectId="proj-1" />)

    // 2 active (running + queued), not the completed one
    expect(screen.getByText(/2 active tasks/i)).toBeInTheDocument()
  })

  it('shows "1 active task" (singular) for a single active entry', () => {
    useActivityStore.getState().upsertEntry(makeEntry({ status: 'queued' }))

    render(<ActivityPane projectId="proj-1" />)

    expect(screen.getByText(/1 active task/i)).toBeInTheDocument()
  })
})

// ── 2. Click strip expands ─────────────────────────────────────────────────────

describe('ActivityPane — expand/collapse', () => {
  it('click on collapsed strip expands to show entry list region', () => {
    useActivityStore.getState().upsertEntry(makeEntry({ status: 'queued' }))

    render(<ActivityPane projectId="proj-1" />)

    // Initially collapsed — no "region" role present
    expect(screen.queryByRole('region', { name: /background tasks/i })).toBeNull()

    const strip = screen.getByRole('button', { name: /background tasks/i })
    fireEvent.click(strip)

    // Now expanded — region is visible
    expect(screen.getByRole('region', { name: /background tasks/i })).toBeInTheDocument()
  })

  it('collapse button in expanded state collapses the pane', () => {
    localStorage.setItem('bramha:activity:expanded:proj-1', 'true')
    useActivityStore.getState().upsertEntry(makeEntry())

    render(<ActivityPane projectId="proj-1" />)

    // Pane starts expanded due to localStorage
    expect(screen.getByRole('region', { name: /background tasks/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /collapse background tasks/i }))

    expect(screen.queryByRole('region', { name: /background tasks/i })).toBeNull()
  })
})

// ── 3. Running entry shows animated progress bar ──────────────────────────────

describe('ActivityPane — progress bar', () => {
  it('running entry renders a progressbar with correct aria-valuenow', () => {
    localStorage.setItem('bramha:activity:expanded:proj-1', 'true')
    useActivityStore
      .getState()
      .upsertEntry(makeEntry({ status: 'running', progressPct: 42 }))

    render(<ActivityPane projectId="proj-1" />)

    const bar = screen.getByRole('progressbar', { name: /task progress/i })
    expect(bar).toBeInTheDocument()
    expect(bar).toHaveAttribute('aria-valuenow', '42')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
  })

  it('queued entry does NOT render a progress bar', () => {
    localStorage.setItem('bramha:activity:expanded:proj-1', 'true')
    useActivityStore
      .getState()
      .upsertEntry(makeEntry({ status: 'queued', progressPct: 0 }))

    render(<ActivityPane projectId="proj-1" />)

    expect(screen.queryByRole('progressbar')).toBeNull()
  })
})

// ── 4. Progress bar updates when updateProgress called ────────────────────────

describe('ActivityPane — progress bar value updates', () => {
  it('re-renders with updated progressPct after updateProgress', () => {
    localStorage.setItem('bramha:activity:expanded:proj-1', 'true')
    useActivityStore
      .getState()
      .upsertEntry(makeEntry({ status: 'running', progressPct: 10 }))

    render(<ActivityPane projectId="proj-1" />)

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '10')

    act(() => {
      useActivityStore.getState().updateProgress('d1', 75)
    })

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75')
  })
})

// ── 5. Cancel button visibility ───────────────────────────────────────────────

describe('ActivityPane — cancel button visibility', () => {
  it('cancel button shown for queued entry', () => {
    localStorage.setItem('bramha:activity:expanded:proj-1', 'true')
    useActivityStore.getState().upsertEntry(makeEntry({ status: 'queued' }))

    render(<ActivityPane projectId="proj-1" />)

    expect(screen.getByRole('button', { name: /cancel task/i })).toBeInTheDocument()
  })

  it('cancel button shown for running entry', () => {
    localStorage.setItem('bramha:activity:expanded:proj-1', 'true')
    useActivityStore.getState().upsertEntry(makeEntry({ status: 'running' }))

    render(<ActivityPane projectId="proj-1" />)

    expect(screen.getByRole('button', { name: /cancel task/i })).toBeInTheDocument()
  })

  it('cancel button NOT shown for completed entry', () => {
    localStorage.setItem('bramha:activity:expanded:proj-1', 'true')
    useActivityStore.getState().upsertEntry(makeEntry({ status: 'completed' }))

    render(<ActivityPane projectId="proj-1" />)

    expect(screen.queryByRole('button', { name: /cancel task/i })).toBeNull()
  })

  it('cancel button NOT shown for failed entry', () => {
    localStorage.setItem('bramha:activity:expanded:proj-1', 'true')
    useActivityStore.getState().upsertEntry(makeEntry({ status: 'failed' }))

    render(<ActivityPane projectId="proj-1" />)

    expect(screen.queryByRole('button', { name: /cancel task/i })).toBeNull()
  })
})

// ── 6. Cancel button calls DELETE API + updates status ────────────────────────

describe('ActivityPane — cancel button interaction', () => {
  it('clicking cancel calls DELETE endpoint and updates status to cancelled', async () => {
    const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response)

    localStorage.setItem('bramha:activity:expanded:proj-1', 'true')
    useActivityStore
      .getState()
      .upsertEntry(makeEntry({ status: 'running', delegationId: 'd1' }))

    render(<ActivityPane projectId="proj-1" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cancel task/i }))
    })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/projects/proj-1/delegations/d1'),
      expect.objectContaining({ method: 'DELETE' }),
    )

    expect(useActivityStore.getState().entries.get('d1')?.status).toBe('cancelled')
  })
})

// ── 7. Completed entry shows "View report" link ───────────────────────────────

describe('ActivityPane — View report link', () => {
  it('completed entry with conversationId shows "View report" link with correct href', () => {
    localStorage.setItem('bramha:activity:expanded:proj-1', 'true')
    useActivityStore.getState().upsertEntry(
      makeEntry({
        status: 'completed',
        conversationId: 'conv-abc',
        originNodeId: 'node-xyz',
      }),
    )

    render(<ActivityPane projectId="proj-1" />)

    const link = screen.getByRole('link', { name: /view report/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/p/proj-1/graph/conv-abc#node-xyz')
  })

  it('completed entry without conversationId does NOT show "View report" link', () => {
    localStorage.setItem('bramha:activity:expanded:proj-1', 'true')
    useActivityStore
      .getState()
      .upsertEntry(makeEntry({ status: 'completed', conversationId: null }))

    render(<ActivityPane projectId="proj-1" />)

    expect(screen.queryByRole('link', { name: /view report/i })).toBeNull()
  })
})

// ── 8. Status badge labels (spot checks + all statuses) ───────────────────────

describe('ActivityPane — status badge labels', () => {
  const cases: Array<[ActivityEntry['status'], string]> = [
    ['queued', 'Queued'],
    ['running', 'Running'],
    ['waiting_approval', 'Waiting Approval'],
    ['completed', 'Completed'],
    ['failed', 'Failed'],
    ['timeout', 'Timed Out'],
    ['cancelled', 'Cancelled'],
  ]

  for (const [status, label] of cases) {
    it(`status "${status}" renders badge label "${label}"`, () => {
      localStorage.setItem('bramha:activity:expanded:proj-1', 'true')
      resetStore()
      useActivityStore.getState().upsertEntry(makeEntry({ status }))

      render(<ActivityPane projectId="proj-1" />)

      expect(screen.getByText(label)).toBeInTheDocument()
    })
  }
})

// ── 9. cancelDelegation store action API endpoint ─────────────────────────────

describe('ActivityStore — cancelDelegation', () => {
  it('calls the correct DELETE endpoint for the given project and delegation', async () => {
    const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response)

    useActivityStore
      .getState()
      .upsertEntry(makeEntry({ status: 'running', projectId: 'proj-9' }))

    await useActivityStore.getState().cancelDelegation('d1', 'proj-9')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/projects/proj-9/delegations/d1'),
      expect.objectContaining({ method: 'DELETE' }),
    )

    // Local status updated to cancelled
    expect(useActivityStore.getState().entries.get('d1')?.status).toBe('cancelled')
  })

  it('throws when the server responds with a non-ok status', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    } as Response)

    useActivityStore.getState().upsertEntry(makeEntry({ status: 'running' }))

    await expect(
      useActivityStore.getState().cancelDelegation('d1', 'proj-1'),
    ).rejects.toThrow('403')
  })
})

// ── 10. useActivityEvents: delegation.progress ────────────────────────────────

describe('useActivityEvents — delegation.progress', () => {
  it('progress event updates progressPct via updateProgress', () => {
    useActivityStore
      .getState()
      .upsertEntry(makeEntry({ status: 'running', progressPct: 0, delegationId: 'd1' }))

    const { unmount } = renderHook(() => useActivityEvents('proj-1'))

    const handler = socketHandlers.get('delegation.progress:proj-1')
    expect(handler).toBeDefined()

    act(() => {
      handler?.({ delegationId: 'd1', progressPct: 88 })
    })

    expect(useActivityStore.getState().entries.get('d1')?.progressPct).toBe(88)

    unmount()
  })
})

// ── 11. useActivityEvents: delegation.completed ───────────────────────────────

describe('useActivityEvents — delegation.completed', () => {
  it('completed event updates entry status to "completed"', () => {
    useActivityStore
      .getState()
      .upsertEntry(makeEntry({ status: 'running', delegationId: 'd1' }))

    const { unmount } = renderHook(() => useActivityEvents('proj-1'))

    const handler = socketHandlers.get('delegation.completed:proj-1')
    expect(handler).toBeDefined()

    const completedAt = new Date().toISOString()
    act(() => {
      handler?.({ delegationId: 'd1', completedAt })
    })

    const entry = useActivityStore.getState().entries.get('d1')
    expect(entry?.status).toBe('completed')
    expect(entry?.completedAt).toBe(completedAt)

    unmount()
  })
})

// ── 12. isExpanded localStorage persistence ───────────────────────────────────

describe('ActivityPane — localStorage persistence', () => {
  it('reads isExpanded=true from localStorage on mount', () => {
    localStorage.setItem('bramha:activity:expanded:proj-1', 'true')
    useActivityStore.getState().upsertEntry(makeEntry())

    render(<ActivityPane projectId="proj-1" />)

    // If localStorage was read correctly, the pane starts expanded
    expect(screen.getByRole('region', { name: /background tasks/i })).toBeInTheDocument()
  })

  it('toggleExpanded writes updated value to localStorage', () => {
    useActivityStore.getState().upsertEntry(makeEntry())

    render(<ActivityPane projectId="proj-1" />)

    // Pane starts collapsed (localStorage empty → false)
    expect(screen.queryByRole('region', { name: /background tasks/i })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /background tasks/i }))

    // localStorage should now hold 'true'
    expect(localStorage.getItem('bramha:activity:expanded:proj-1')).toBe('true')
  })
})

// ── 13. Security: no BullMQ job IDs in rendered output ───────────────────────

describe('Security — no queue-internal identifiers', () => {
  it('rendered HTML contains no BullMQ or queue-internal strings', () => {
    localStorage.setItem('bramha:activity:expanded:proj-1', 'true')
    // Entry uses a proper UUID delegationId — never a BullMQ job id like "bull:queue:123"
    useActivityStore.getState().upsertEntry(
      makeEntry({
        delegationId: '550e8400-e29b-41d4-a716-446655440000',
        status: 'running',
      }),
    )

    const { container } = render(<ActivityPane projectId="proj-1" />)

    expect(container.innerHTML).not.toMatch(/bull:/)
    expect(container.innerHTML).not.toMatch(/queue-internal/)
    expect(container.innerHTML).not.toMatch(/job:\d+/)
    expect(container.innerHTML).not.toMatch(/bullmq/i)
  })
})

// ── 14. Security: entries filtered by projectId ───────────────────────────────

describe('Security — project isolation', () => {
  it('entries from a different project are NOT rendered', () => {
    localStorage.setItem('bramha:activity:expanded:proj-1', 'true')

    useActivityStore.getState().upsertEntry(
      makeEntry({
        delegationId: 'd1',
        projectId: 'proj-1',
        objective: 'Task belonging to project 1',
      }),
    )
    useActivityStore.getState().upsertEntry(
      makeEntry({
        delegationId: 'd2',
        projectId: 'proj-OTHER',
        objective: 'Task belonging to other project',
      }),
    )

    render(<ActivityPane projectId="proj-1" />)

    expect(screen.getByText('Task belonging to project 1')).toBeInTheDocument()
    expect(screen.queryByText('Task belonging to other project')).toBeNull()
  })

  it('active count only reflects entries for the current project', () => {
    // proj-1 has 1 active; proj-OTHER has 2 active
    useActivityStore
      .getState()
      .upsertEntry(makeEntry({ delegationId: 'd1', projectId: 'proj-1', status: 'running' }))
    useActivityStore
      .getState()
      .upsertEntry(makeEntry({ delegationId: 'd2', projectId: 'proj-OTHER', status: 'running' }))
    useActivityStore
      .getState()
      .upsertEntry(makeEntry({ delegationId: 'd3', projectId: 'proj-OTHER', status: 'queued' }))

    render(<ActivityPane projectId="proj-1" />)

    // Should show "1 active task", not 3
    expect(screen.getByText(/1 active task/i)).toBeInTheDocument()
  })
})
