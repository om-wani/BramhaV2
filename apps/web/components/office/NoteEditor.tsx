'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { NoteSchema, InitiateUploadResponseSchema, FileSchema } from '@bramha/shared'
import { api } from '@/lib/api-client'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor, JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import TurndownService from 'turndown'
import { WikilinkExtension } from './WikilinkExtension'

const DownloadUrlSchema = z.object({ url: z.string() })

type SyncState = 'synced' | 'syncing' | 'error'

interface NoteEditorProps {
  projectId: string
  noteId: string
  onOutlineChange: (headings: Array<{ level: number; text: string; id: string }>) => void
  editorRef?: React.MutableRefObject<Editor | null>
  /** Bearer token for API calls. Optional — API falls back to cookie auth when omitted. */
  token?: string
}

// token param intentionally omitted: API uses cookie auth; add as param when bearer auth is needed
async function uploadImageAndInsert(
  editor: Editor,
  file: File,
  projectId: string,
): Promise<void> {
  const placeholder = `![uploading…]()`
  // Insert placeholder at cursor so the user sees feedback immediately
  editor.chain().focus().insertContent(placeholder).run()

  const getMd = () =>
    (editor.storage as unknown as Record<string, { getMarkdown: () => string } | undefined>)
      .markdown?.getMarkdown() ?? ''

  try {
    // 1. Initiate upload — get presigned URL
    const { fileId, uploadUrl } = await api.post(
      `/projects/${projectId}/files/initiate`,
      InitiateUploadResponseSchema,
      { name: file.name, declaredMime: file.type, sizeBytes: file.size },
    )

    // 2. Upload directly to presigned URL (no auth header required)
    await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    })

    // 3. Confirm upload with API
    await api.post(
      `/projects/${projectId}/files/${fileId}/confirm`,
      FileSchema,
      {},
    )

    // 4. Fetch a presigned download URL
    const { url: downloadUrl } = await api.get(
      `/projects/${projectId}/files/${fileId}/download-url`,
      DownloadUrlSchema,
    )

    // 5. Replace placeholder with actual markdown image
    const updated = getMd().replace(placeholder, `![${file.name}](${downloadUrl})`)
    editor.commands.setContent(updated)
  } catch {
    // On failure, remove the placeholder to leave the doc clean
    const current = getMd()
    const cleaned = current.replace(placeholder, '')
    if (cleaned !== current) {
      editor.commands.setContent(cleaned)
    }
  }
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

export function NoteEditor({ projectId, noteId, onOutlineChange, editorRef, token }: NoteEditorProps) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [syncState, setSyncState] = useState<SyncState>('synced')
  const [wikilinkSearch, setWikilinkSearch] = useState<string | null>(null)
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const titleRef = useRef(title)
  titleRef.current = title
  // Refs keep paste handler closure fresh without stale values
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId
  const tokenRef = useRef(token)
  tokenRef.current = token

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
      WikilinkExtension,
    ],
    editorProps: {
      attributes: { class: 'prose prose-sm dark:prose-invert max-w-none p-4 focus:outline-none min-h-[200px]' },
      handlePaste: (_view, event) => {
        // ── 1. Image file items → secure upload pipeline (no blob:// URLs) ──
        const files = Array.from(event.clipboardData?.items ?? [])
          .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
          .map((item) => item.getAsFile())
          .filter(Boolean) as File[]

        if (files.length > 0) {
          event.preventDefault()
          if (editor) {
            void (async () => {
              for (const file of files) {
                await uploadImageAndInsert(editor, file, projectIdRef.current)
              }
            })()
          }
          return true
        }

        // ── 2. HTML paste → sanitize to markdown ────────────────────────────
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

  // Cancel autosave timer when note changes
  useEffect(() => {
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    }
  }, [noteId])

  const scheduleAutosave = () => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(async () => {
      if (!editor || editor.isDestroyed) return
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

        {/* Wikilink autocomplete dropdown — positioned at cursor */}
        {wikilinkSearch !== null && filteredNotes.length > 0 && (() => {
          let dropdownTop = 100
          let dropdownLeft = 16
          if (editor) {
            try {
              const { from } = editor.state.selection
              const coords = editor.view.coordsAtPos(from)
              const editorRect = editor.view.dom.getBoundingClientRect()
              const rawTop = coords.bottom - editorRect.top
              const rawLeft = coords.left - editorRect.left
              // Clamp so the 256px-wide dropdown stays within the editor area
              dropdownTop = Math.max(0, rawTop)
              dropdownLeft = Math.min(rawLeft, editorRect.width - 264)
            } catch {
              // coordsAtPos can throw if pos is out of range; fall back to defaults
            }
          }
          return (
          <div
            data-testid="wikilink-dropdown"
            className="absolute z-50 w-64 bg-popover border rounded-md shadow-lg py-1"
            style={{ top: `${dropdownTop}px`, left: `${dropdownLeft}px` }}
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
          )
        })()}
      </div>

      {/* Sync indicator */}
      <div className="flex items-center justify-end px-4 py-2 shrink-0 border-t" aria-live="polite">
        {syncState === 'synced' && (
          <span className="text-xs text-muted-foreground">✓ Saved</span>
        )}
        {syncState === 'syncing' && (
          <span className="flex items-center gap-1 text-muted-foreground text-xs">
            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Saving…
          </span>
        )}
        {syncState === 'error' && (
          <span className="text-xs text-destructive">⚠ Sync failed</span>
        )}
      </div>
    </div>
  )
}
