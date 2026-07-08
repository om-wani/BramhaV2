import React from 'react'
import { render, screen } from '@testing-library/react'
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

import { BacklinksPane } from './BacklinksPane'
import { api } from '@/lib/api-client'

const now = new Date().toISOString()

function makeNote(id: string, title: string, folderPath = '/') {
  return {
    id,
    projectId: 'proj-1',
    authorId: 'user-1',
    title,
    contentMd: '',
    contentJson: null,
    folderPath,
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

describe('BacklinksPane', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows backlinks list when there are backlinks', async () => {
    vi.mocked(api.get).mockResolvedValue([
      makeNote('note-2', 'Design Strategy'),
      makeNote('note-3', 'Q4 Roadmap', '/projects'),
    ])

    render(
      <BacklinksPane
        projectId="proj-1"
        noteId="note-1"
        onSelectNote={vi.fn()}
      />,
      { wrapper }
    )

    expect(await screen.findByText('Design Strategy')).toBeInTheDocument()
    expect(await screen.findByText('Q4 Roadmap')).toBeInTheDocument()
  })

  it('shows empty state when there are no backlinks', async () => {
    vi.mocked(api.get).mockResolvedValue([])

    render(
      <BacklinksPane
        projectId="proj-1"
        noteId="note-1"
        onSelectNote={vi.fn()}
      />,
      { wrapper }
    )

    expect(await screen.findByText('No backlinks yet')).toBeInTheDocument()
  })

  it('shows "Select a note" message when noteId is empty', () => {
    render(
      <BacklinksPane
        projectId="proj-1"
        noteId=""
        onSelectNote={vi.fn()}
      />,
      { wrapper }
    )

    expect(screen.getByText('Select a note to see backlinks')).toBeInTheDocument()
    // No API call should be made for empty noteId
    expect(vi.mocked(api.get)).not.toHaveBeenCalled()
  })

  it('calls onSelectNote when a backlink is clicked', async () => {
    const onSelectNote = vi.fn()
    vi.mocked(api.get).mockResolvedValue([
      makeNote('note-2', 'Design Strategy'),
    ])

    render(
      <BacklinksPane
        projectId="proj-1"
        noteId="note-1"
        onSelectNote={onSelectNote}
      />,
      { wrapper }
    )

    const noteButton = await screen.findByText('Design Strategy')
    noteButton.click()

    expect(onSelectNote).toHaveBeenCalledWith('note-2')
  })
})
