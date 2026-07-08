'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { NoteSchema } from '@bramha/shared'
import { api } from '@/lib/api-client'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor, JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import TurndownService from 'turndown'

type SyncState = 'synced' | 'syncing' | 'error'

interface NoteEditorProps {
  projectId: string
  noteId: string
  onOutlineChange: (headings: Array<{ level: number; text: string; id: string }>) => void
  editorRef?: React.MutableRefObject<Editor | null>
}

// Exported for testing
export function sanitizeHtml(html: string): string {
  // 1. Strip <script>...</script> blocks (including content)
  let clean = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  // 2. Strip <iframe>...</iframe> blocks
  clean = clean.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
  // 3. Strip javascript: hrefs/srcs from attributes
  clean = clean.replace(/(href|src)=["']javascript:[^"']*["']/gi, '$1="#"')
  // 4. Convert remaining HTML to markdown using turndown
  const td = new TurndownService()
  return td.turndown(clean)
}

function extractOutlineHeadings(json: JSONContent): Array<{ level: number; text: string; id: string }> {
  const headings: Array<{ level: number; text: string; id: string }> = []
  const content = json?.content ?? []
  for (const node of content) {
    if (node.type === 'heading') {
      const level = (node.attrs?.level as number) ?? 1
      const text = (node.content ?? []).map((c: JSONContent) => (c.text as string | undefined) ?? '').join('')
      const id = `heading-${level}-${text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`
      headings.push({ level, text, id })
    }
  }
  return headings
}

export function NoteEditor({ projectId, noteId, onOutlineChange, editorRef }: NoteEditorProps) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [syncState, setSyncState] = useState<SyncState>('synced')
  const [wikilinkSearch, setWikilinkSearch] = useState<string | null>(null)
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const titleRef = useRef(title)
  titleRef.current = title

  // Fetch all notes for wikilink autocomplete
  const { data: allNotes = [] } = useQuery({
    queryKey: ['notes', projectId],
    queryFn: () => api.get(`/projects/${projectId}/notes`, z.array(NoteSchema)),
  })

  // Fetch current note
  const { data: note, isLoading } = useQuery({
    queryKey: ['note', projectId, noteId],
    queryFn: () => api.get(`/projects/${projectId}/notes/${noteId}`, NoteSchema),
    enabled: !!noteId,
  })

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: 'Start writing…' }),
      Markdown.configure({ html: false, tightLists: true }),
    ],
    editorProps: {
      attributes: { class: 'prose prose-sm dark:prose-invert max-w-none p-4 focus:outline-none min-h-[200px]' },
      handlePaste: (_view, event) => {
        const types = event.clipboardData?.types ?? []
        if (types.includes('text/html')) {
          const html = event.clipboardData!.getData('text/html')
          const markdown = sanitizeHtml(html)
          editor?.commands.insertContent(markdown)
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor: ed }) => {
      scheduleAutosave()

      // Outline: parse headings from JSON
      const json = ed.getJSON()
      const headings = extractOutlineHeadings(json)
      onOutlineChange(headings)

      // Wikilink detection: check text near cursor for [[...
      const { from } = ed.state.selection
      const text = ed.state.doc.textBetween(Math.max(0, from - 50), from, '')
      const wlMatch = text.match(/\[\[([^\]]+)$/)
      if (wlMatch) {
        setWikilinkSearch(wlMatch[1] ?? null)
      } else {
        setWikilinkSearch(null)
      }
    },
  })

  // Expose editor via editorRef
  useEffect(() => {
    if (editorRef && editor) {
      editorRef.current = editor
    }
  }, [editor, editorRef])

  // Set initial content when note loads
  useEffect(() => {
    if (!note || !editor) return
    setTitle(note.title)
    if (note.contentJson) {
      editor.commands.setContent(note.contentJson as JSONContent)
    } else if (note.contentMd) {
      editor.commands.setContent(note.contentMd)
    }
    // Extract initial headings
    const json = editor.getJSON()
    onOutlineChange(extractOutlineHeadings(json))
  }, [note?.id, editor])

  // Cleanup autosave timer on unmount
  useEffect(() => {
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    }
  }, [])

  const scheduleAutosave = () => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(async () => {
      if (!editor) return
      setSyncState('syncing')
      try {
        await api.patch(`/projects/${projectId}/notes/${noteId}`, NoteSchema, {
          title: titleRef.current,
          contentMd: (editor.storage as unknown as Record<string, { getMarkdown: () => string } | undefined>).markdown?.getMarkdown() ?? '',
          contentJson: editor.getJSON(),
        })
        queryClient.invalidateQueries({ queryKey: ['notes', projectId] })
        setSyncState('synced')
      } catch {
        setSyncState('error')
      }
    }, 5000)
  }

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value)
    scheduleAutosave()
  }

  const handleWikilinkSelect = (noteTitle: string) => {
    if (!editor || wikilinkSearch === null) return
    // Replace the partial [[search with [[NoteTitle]]
    const { from } = editor.state.selection
    const text = editor.state.doc.textBetween(Math.max(0, from - 100), from, '')
    const idx = text.lastIndexOf('[[')
    if (idx !== -1) {
      const deleteFrom = from - (text.length - idx)
      editor.chain().focus()
        .deleteRange({ from: deleteFrom, to: from })
        .insertContent(`[[${noteTitle}]]`)
        .run()
    }
    setWikilinkSearch(null)
  }

  if (!noteId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Select a note to start writing
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-col h-full p-4 gap-3">
        <div className="h-8 w-3/4 rounded bg-muted animate-pulse" />
        <div className="h-4 w-full rounded bg-muted animate-pulse" />
        <div className="h-4 w-5/6 rounded bg-muted animate-pulse" />
        <div className="h-4 w-2/3 rounded bg-muted animate-pulse" />
      </div>
    )
  }

  const filteredNotes = wikilinkSearch !== null
    ? (allNotes as Array<{ id: string; title: string }>)
        .filter((n) => n.title.toLowerCase().includes(wikilinkSearch.toLowerCase()))
        .slice(0, 8)
    : []

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      {/* Title */}
      <div className="px-4 pt-4 pb-2 shrink-0">
        <input
          type="text"
          value={title}
          onChange={handleTitleChange}
          placeholder="Note title"
          aria-label="Note title"
          className="w-full text-2xl font-bold bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-y-auto relative">
        <EditorContent editor={editor} />

        {/* Wikilink autocomplete dropdown */}
        {wikilinkSearch !== null && filteredNotes.length > 0 && (
          <div
            data-testid="wikilink-dropdown"
            className="absolute z-50 w-64 bg-popover border rounded-md shadow-lg py-1"
            style={{ top: '100px', left: '1rem' }}
            role="listbox"
            aria-label="Wikilink suggestions"
          >
            {filteredNotes.map((n) => (
              <button
                key={n.id}
                role="option"
                aria-selected={false}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleWikilinkSelect(n.title)
                }}
              >
                {n.title}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Sync indicator */}
      <div className="flex items-center justify-end px-4 py-2 shrink-0 border-t">
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {syncState === 'synced' && '✓ Saved'}
          {syncState === 'syncing' && 'Saving…'}
          {syncState === 'error' && '⚠ Sync failed'}
        </span>
      </div>
    </div>
  )
}
