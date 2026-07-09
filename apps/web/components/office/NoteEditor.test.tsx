import React from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// vi.hoisted lets us define stable objects that vi.mock factories can reference
const { mockEditor } = vi.hoisted(() => {
  const mockEditor = {
    getJSON: vi.fn(() => ({ type: 'doc', content: [] })),
    storage: { markdown: { getMarkdown: vi.fn(() => '') } },
    commands: {
      setContent: vi.fn(),
      focus: vi.fn(),
      scrollIntoView: vi.fn(),
      insertContent: vi.fn(),
    },
    chain: vi.fn(() => ({
      focus: vi.fn(() => ({
        deleteRange: vi.fn(() => ({ insertContent: vi.fn(() => ({ run: vi.fn() })) })),
      })),
    })),
    on: vi.fn(),
    off: vi.fn(),
    destroy: vi.fn(),
    isDestroyed: false,
    getText: vi.fn(() => ''),
    view: {
      coordsAtPos: vi.fn(() => ({ top: 50, bottom: 60, left: 100, right: 110 })),
      dom: { getBoundingClientRect: vi.fn(() => ({ top: 0, left: 0, width: 800, height: 600 })) },
    },
    state: {
      doc: {
        textContent: '',
        textBetween: vi.fn(() => ''),
      },
      selection: { from: 0 },
    },
  }
  return { mockEditor }
})

// Mock TipTap — useEditor returns the SAME stable object every call
vi.mock('@tiptap/react', () => ({
  useEditor: vi.fn(() => mockEditor),
  EditorContent: () => <div data-testid="editor-content" />,
}))
vi.mock('@tiptap/starter-kit', () => ({ default: {} }))
vi.mock('@tiptap/extension-placeholder', () => ({
  default: { configure: vi.fn(() => ({})) },
}))
vi.mock('tiptap-markdown', () => ({
  Markdown: { configure: vi.fn(() => ({})) },
}))
vi.mock('./WikilinkExtension', () => ({
  WikilinkExtension: { name: 'wikilink' },
}))

// Mock api-client (no external vars in the factory)
vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn().mockResolvedValue({
      id: 'note-1', projectId: 'proj-1', authorId: 'user-1',
      title: 'Test Note', contentMd: '# Hello', contentJson: null,
      folderPath: '/', isDaily: false, deletedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }),
    patch: vi.fn().mockResolvedValue({
      id: 'note-1', projectId: 'proj-1', authorId: 'user-1',
      title: 'Test Note', contentMd: '', contentJson: null,
      folderPath: '/', isDaily: false, deletedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

// Mock turndown (no external vars in factory)
vi.mock('turndown', () => ({
  default: vi.fn().mockImplementation(() => ({
    turndown: vi.fn((html: string) => html.replace(/<[^>]+>/g, '')),
  })),
}))

// -- Imports after mocks --
import { NoteEditor, sanitizeHtml } from './NoteEditor'
import { api } from '@/lib/api-client'
import { useEditor } from '@tiptap/react'

const mockNote = {
  id: 'note-1', projectId: 'proj-1', authorId: 'user-1',
  title: 'Test Note', contentMd: '# Hello', contentJson: null,
  folderPath: '/', isDaily: false, deletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
}

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
}

describe('NoteEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset stable mock methods
    mockEditor.getJSON.mockReturnValue({ type: 'doc', content: [] })
    mockEditor.storage.markdown.getMarkdown.mockReturnValue('')
    mockEditor.state.doc.textContent = ''
    ;(mockEditor.state.doc as Record<string, unknown>).textBetween = vi.fn(() => '')
    ;(mockEditor.state as Record<string, unknown>).selection = { from: 0 }
  })

  // ── Test group 1: Paste sanitization (pure function, no async needed) ────────
  describe('sanitizeHtml', () => {
    it('strips script tags and their content', () => {
      const input = '<script>alert(1)</script><p>Hello</p>'
      const result = sanitizeHtml(input)
      expect(result).not.toContain('<script>')
      expect(result).not.toContain('alert(1)')
    })

    it('strips iframe tags', () => {
      const input = '<iframe src="evil.com"></iframe><p>Safe content</p>'
      const result = sanitizeHtml(input)
      expect(result).not.toContain('<iframe>')
      expect(result).not.toContain('evil.com')
    })

    it('strips javascript: hrefs', () => {
      const input = '<a href="javascript:alert(1)">click</a>'
      const result = sanitizeHtml(input)
      expect(result).not.toContain('javascript:')
    })

    it('preserves safe content (turndown mocked to strip tags)', () => {
      const input = '<p>Hello World</p>'
      const result = sanitizeHtml(input)
      expect(result).toContain('Hello World')
    })
  })

  // ── Test 2: Empty noteId shows placeholder ───────────────────────────────────
  it('shows placeholder when noteId is empty', () => {
    render(
      <NoteEditor projectId="proj-1" noteId="" onOutlineChange={vi.fn()} />,
      { wrapper: makeWrapper() }
    )
    expect(screen.getByText('Select a note to start writing')).toBeInTheDocument()
  })

  // ── Test 3: Loading skeleton shown before note resolves ──────────────────────
  it('shows skeleton loading when note is pending', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {})) // never resolves

    render(
      <NoteEditor projectId="proj-1" noteId="note-1" onOutlineChange={vi.fn()} />,
      { wrapper: makeWrapper() }
    )

    const skeletons = document.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  // ── Test 4: Editor renders after note loads ─────────────────────────────────
  it('renders editor content area after note loads', async () => {
    vi.mocked(api.get).mockResolvedValue(mockNote)

    render(
      <NoteEditor projectId="proj-1" noteId="note-1" onOutlineChange={vi.fn()} />,
      { wrapper: makeWrapper() }
    )

    expect(await screen.findByTestId('editor-content')).toBeInTheDocument()
  })

  // ── Test 5: Sync state "Saved" after note loads ──────────────────────────────
  it('shows "Saved" once note has loaded', async () => {
    vi.mocked(api.get).mockResolvedValue(mockNote)

    render(
      <NoteEditor projectId="proj-1" noteId="note-1" onOutlineChange={vi.fn()} />,
      { wrapper: makeWrapper() }
    )

    // Wait until the title input appears (note loaded)
    expect(await screen.findByRole('textbox', { name: /note title/i })).toBeInTheDocument()
    expect(screen.getByText('✓ Saved')).toBeInTheDocument()
  })

  // ── Test 6: Autosave debounce ─────────────────────────────────────────────────
  it('does not call PATCH immediately; calls it after 5s', async () => {
    vi.mocked(api.get).mockResolvedValue(mockNote)
    vi.mocked(api.patch).mockResolvedValue(mockNote)

    render(
      <NoteEditor projectId="proj-1" noteId="note-1" onOutlineChange={vi.fn()} />,
      { wrapper: makeWrapper() }
    )

    // Wait for note to load
    const titleInput = await screen.findByRole('textbox', { name: /note title/i })

    // Now switch to fake timers AFTER the note has loaded
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      fireEvent.change(titleInput, { target: { value: 'New Title' } })

      // PATCH should NOT be called immediately
      expect(vi.mocked(api.patch)).not.toHaveBeenCalled()

      // Advance past the 5-second debounce
      await act(async () => {
        vi.advanceTimersByTime(5001)
        await Promise.resolve()
        await Promise.resolve()
      })

      await waitFor(() =>
        expect(vi.mocked(api.patch)).toHaveBeenCalledWith(
          expect.stringContaining('/notes/note-1'),
          expect.anything(),
          expect.objectContaining({ title: 'New Title' }),
        )
      , { timeout: 3000 })
    } finally {
      vi.useRealTimers()
    }
  })

  // ── Test 7: Sync state transitions ───────────────────────────────────────────
  it('transitions sync state: synced → syncing → synced', async () => {
    vi.mocked(api.get).mockResolvedValue(mockNote)

    let resolvePatch!: (v: unknown) => void
    vi.mocked(api.patch).mockReturnValue(
      new Promise<unknown>((resolve) => { resolvePatch = resolve })
    )

    render(
      <NoteEditor projectId="proj-1" noteId="note-1" onOutlineChange={vi.fn()} />,
      { wrapper: makeWrapper() }
    )

    // Wait for note to load
    const titleInput = await screen.findByRole('textbox', { name: /note title/i })
    expect(screen.getByText('✓ Saved')).toBeInTheDocument()

    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      // Trigger autosave
      fireEvent.change(titleInput, { target: { value: 'Changed Title' } })

      // Fire the debounce
      await act(async () => {
        vi.advanceTimersByTime(5001)
        await Promise.resolve()
        await Promise.resolve()
      })

      // Should show syncing
      await waitFor(() => expect(screen.getByText('Saving…')).toBeInTheDocument())

      // Resolve the patch
      await act(async () => {
        resolvePatch(mockNote)
        await Promise.resolve()
      })

      // Should show synced
      await waitFor(() => expect(screen.getByText('✓ Saved')).toBeInTheDocument())
    } finally {
      vi.useRealTimers()
    }
  })

  // ── Test 8: Wikilink autocomplete ────────────────────────────────────────────
  it('shows wikilink dropdown on [[ and inserts [[NoteTitle]] on select', async () => {
    // notes list returns one note; current note query also resolves
    vi.mocked(api.get).mockImplementation((path: string) => {
      if ((path as string).match(/\/notes\/note-1$/)) return Promise.resolve(mockNote)
      // allNotes query — return array with one note
      return Promise.resolve([mockNote])
    })

    // Intercept insertContent so we can assert on it
    const mockInsertContent = vi.fn(() => ({ run: vi.fn() }))
    mockEditor.chain = vi.fn(() => ({
      focus: vi.fn(() => ({
        deleteRange: vi.fn(() => ({ insertContent: mockInsertContent })),
      })),
    }))

    render(
      <NoteEditor projectId="proj-1" noteId="note-1" onOutlineChange={vi.fn()} />,
      { wrapper: makeWrapper() }
    )

    // Wait for editor area to render
    await screen.findByTestId('editor-content')

    // Simulate typing [[ by calling the onUpdate callback captured from useEditor
    const editorOptions = vi.mocked(useEditor).mock.calls[0]?.[0] as unknown as {
      onUpdate?: (args: { editor: typeof mockEditor }) => void
    }

    // Make textBetween return text ending in [[ + partial title
    ;(mockEditor.state.doc as Record<string, unknown>).textBetween = vi.fn(() => 'prefix [[Test')
    ;(mockEditor.state as Record<string, unknown>).selection = { from: 14 }

    await act(async () => {
      editorOptions?.onUpdate?.({ editor: mockEditor })
    })

    // Dropdown should be visible with the matching note
    expect(await screen.findByTestId('wikilink-dropdown')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /test note/i })).toBeInTheDocument()

    // Selecting the note inserts [[Note Title]]
    // textBetween for handleWikilinkSelect must also return text with [[
    fireEvent.mouseDown(screen.getByRole('option', { name: /test note/i }))

    expect(mockInsertContent).toHaveBeenCalledWith('[[Test Note]]')
  })
})
