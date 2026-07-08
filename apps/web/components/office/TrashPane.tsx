'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { NoteSchema } from '@bramha/shared'
import type { Note } from '@bramha/shared'
import { api } from '@/lib/api-client'
import { RotateCcw, Trash2, FileText } from 'lucide-react'

interface TrashPaneProps {
  projectId: string
  onSelectNote: (id: string) => void
}

export function TrashPane({ projectId, onSelectNote }: TrashPaneProps) {
  const queryClient = useQueryClient()

  const { data: deletedNotes = [], isLoading } = useQuery({
    queryKey: ['notes-deleted', projectId],
    queryFn: () => api.get(`/projects/${projectId}/notes/deleted`, z.array(NoteSchema)),
  })

  const restoreNote = useMutation({
    mutationFn: (noteId: string) =>
      api.post(`/projects/${projectId}/notes/${noteId}/restore`, NoteSchema, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes', projectId] })
      queryClient.invalidateQueries({ queryKey: ['notes-deleted', projectId] })
    },
  })

  if (isLoading) {
    return (
      <div className="px-3 py-3 space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 rounded bg-muted animate-pulse" />
        ))}
      </div>
    )
  }

  if ((deletedNotes as Note[]).length === 0) {
    return (
      <div className="px-4 py-6 text-xs text-muted-foreground text-center">
        Trash is empty
      </div>
    )
  }

  return (
    <div className="py-2 overflow-y-auto">
      {(deletedNotes as Note[]).map((note) => (
        <div
          key={note.id}
          className="flex items-start gap-2 px-3 py-2 hover:bg-accent/50 transition-colors rounded mx-1"
        >
          <FileText className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <button
              onClick={() => onSelectNote(note.id)}
              className="text-xs font-medium text-foreground truncate block w-full text-left"
            >
              {note.title}
            </button>
            <div className="text-xs text-muted-foreground truncate">{note.folderPath}</div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => restoreNote.mutate(note.id)}
              disabled={restoreNote.isPending}
              aria-label={`Restore ${note.title}`}
              title="Restore note"
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
            </button>
            <button
              disabled
              aria-label={`Permanently delete ${note.title}`}
              title="Coming in Phase 3"
              className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground opacity-40 cursor-not-allowed"
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
