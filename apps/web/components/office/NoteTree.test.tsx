import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

// TrashPane makes its own API calls; stub it out since we render with showTrash=false
vi.mock('./TrashPane', () => ({
  TrashPane: () => <div data-testid="trash-pane" />,
}))

import { NoteTree } from './NoteTree'
import { api } from '@/lib/api-client'

const now = new Date().toISOString()

function makeNote(id: string, title: string) {
  return {
    id,
    projectId: 'proj-1',
    authorId: 'user-1',
    title,
    contentMd: '',
    contentJson: null,
    folderPath: '/',
    isDaily: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('NoteTree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: notes list and deleted list both return empty arrays
    vi.mocked(api.get).mockResolvedValue([])
  })

  // ── Daily Note button ────────────────────────────────────────────────────────
  it('creates a daily note with isDaily:true and a YYYY-MM-DD title on button click', async () => {
    const newNote = makeNote('new-1', new Date().toISOString().split('T')[0]!)
    newNote.isDaily = true
    vi.mocked(api.post).mockResolvedValue(newNote)

    const onSelectNote = vi.fn()

    render(
      <NoteTree
        projectId="proj-1"
        selectedNoteId={null}
        onSelectNote={onSelectNote}
        showTrash={false}
        onToggleTrash={vi.fn()}
      />,
      { wrapper }
    )

    const dailyBtn = screen.getByRole('button', { name: /daily note/i })
    fireEvent.click(dailyBtn)

    await waitFor(() =>
      expect(vi.mocked(api.post)).toHaveBeenCalledWith(
        expect.stringContaining('/notes'),
        expect.anything(),
        expect.objectContaining({
          isDaily: true,
          title: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      )
    )
  })

  // ── Trash count badge ────────────────────────────────────────────────────────
  it('shows count badge on Trash button when there are deleted notes', async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if ((path as string).includes('/deleted')) {
        return Promise.resolve([makeNote('d-1', 'Deleted Note')])
      }
      return Promise.resolve([])
    })

    render(
      <NoteTree
        projectId="proj-1"
        selectedNoteId={null}
        onSelectNote={vi.fn()}
        showTrash={false}
        onToggleTrash={vi.fn()}
      />,
      { wrapper }
    )

    // Badge with count "1" should appear inside the Trash button
    expect(await screen.findByText('1')).toBeInTheDocument()
  })
})
