'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { NoteSchema } from '@bramha/shared'
import type { Note } from '@bramha/shared'
import { api } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Trash2, FileText, FolderOpen, Plus, CalendarDays } from 'lucide-react'
import { TrashPane } from './TrashPane'

interface NoteTreeProps {
  projectId: string
  selectedNoteId: string | null
  onSelectNote: (noteId: string) => void
  showTrash: boolean
  onToggleTrash: () => void
}

export function NoteTree({
  projectId,
  selectedNoteId,
  onSelectNote,
  showTrash,
  onToggleTrash,
}: NoteTreeProps) {
  const queryClient = useQueryClient()

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ['notes', projectId],
    queryFn: () => api.get(`/projects/${projectId}/notes`, z.array(NoteSchema)),
  })

  const { data: deletedNotes = [] } = useQuery({
    queryKey: ['notes-deleted', projectId],
    queryFn: () => api.get(`/projects/${projectId}/notes/deleted`, z.array(NoteSchema)),
  })

  const createNote = useMutation({
    mutationFn: (input: { title: string; folderPath: string; contentMd: string; isDaily?: boolean }) =>
      api.post(`/projects/${projectId}/notes`, NoteSchema, input),
    onSuccess: (newNote) => {
      queryClient.invalidateQueries({ queryKey: ['notes', projectId] })
      onSelectNote(newNote.id)
    },
  })

  const deleteNote = useMutation({
    mutationFn: (noteId: string) =>
      api.delete(`/projects/${projectId}/notes/${noteId}`, z.unknown()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes', projectId] })
    },
  })

  const handleNewNote = () => {
    createNote.mutate({ title: 'Untitled', folderPath: '/', contentMd: '' })
  }

  const handleDailyNote = () => {
    const today = new Date().toISOString().split('T')[0] ?? new Date().toISOString().slice(0, 10)
    createNote.mutate({ title: today, isDaily: true, folderPath: '/', contentMd: '' })
  }

  const handleDeleteNote = (e: React.MouseEvent, noteId: string) => {
    e.stopPropagation()
    deleteNote.mutate(noteId)
  }

  if (showTrash) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Trash</span>
          <button
            onClick={onToggleTrash}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back
          </button>
        </div>
        <TrashPane projectId={projectId} onSelectNote={onSelectNote} />
      </div>
    )
  }

  // Group notes by folder
  const grouped = new Map<string, Note[]>()
  for (const note of notes as Note[]) {
    const folder = note.folderPath ?? '/'
    if (!grouped.has(folder)) grouped.set(folder, [])
    grouped.get(folder)!.push(note)
  }

  // Sort folders: root first, then alphabetical
  const folders = Array.from(grouped.keys()).sort((a, b) => {
    if (a === '/') return -1
    if (b === '/') return 1
    return a.localeCompare(b)
  })

  return (
    <div className="flex flex-col h-full">
      {/* Action buttons */}
      <div className="flex flex-col gap-1 p-2 border-b shrink-0">
        <Button
          size="sm"
          variant="default"
          className="h-7 gap-1.5 text-xs w-full justify-start"
          onClick={handleNewNote}
          disabled={createNote.isPending}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          New Note
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs w-full justify-start"
          onClick={handleDailyNote}
          disabled={createNote.isPending}
        >
          <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
          Daily Note
        </Button>
      </div>

      {/* Notes list */}
      <div className="flex-1 overflow-y-auto py-1">
        {isLoading ? (
          <div className="px-3 py-2 space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-5 rounded bg-muted animate-pulse" />
            ))}
          </div>
        ) : (notes as Note[]).length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">
            No notes yet. Create one above.
          </div>
        ) : (
          folders.map((folder) => (
            <div key={folder}>
              {/* Folder header (only show if not root or multiple folders) */}
              {(folder !== '/' || folders.length > 1) && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{folder === '/' ? 'Root' : folder}</span>
                </div>
              )}
              {grouped.get(folder)?.map((note) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  isSelected={note.id === selectedNoteId}
                  onSelect={() => onSelectNote(note.id)}
                  onDelete={(e) => handleDeleteNote(e, note.id)}
                />
              ))}
            </div>
          ))
        )}
      </div>

      {/* Trash toggle */}
      <div className="border-t p-2 shrink-0">
        <button
          onClick={onToggleTrash}
          className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          Trash
          {(deletedNotes as Note[]).length > 0 && (
            <span className="ml-1 rounded-full bg-muted px-1.5 text-xs">
              {(deletedNotes as Note[]).length}
            </span>
          )}
        </button>
      </div>
    </div>
  )
}

interface NoteRowProps {
  note: Note
  isSelected: boolean
  onSelect: () => void
  onDelete: (e: React.MouseEvent) => void
}

function NoteRow({ note, isSelected, onSelect, onDelete }: NoteRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      className={[
        'group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer text-xs rounded mx-1 transition-colors',
        isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50 text-foreground',
      ].join(' ')}
    >
      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="flex-1 truncate">{note.title || 'Untitled'}</span>
      <button
        onClick={onDelete}
        aria-label={`Delete ${note.title}`}
        className="hidden group-hover:flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-destructive transition-colors"
      >
        <Trash2 className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  )
}
