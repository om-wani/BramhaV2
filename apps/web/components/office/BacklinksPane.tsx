'use client'

import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { NoteSchema } from '@bramha/shared'
import type { Note } from '@bramha/shared'
import { api } from '@/lib/api-client'
import { Link2 } from 'lucide-react'

interface BacklinksPaneProps {
  projectId: string
  noteId: string
  onSelectNote: (id: string) => void
}

export function BacklinksPane({ projectId, noteId, onSelectNote }: BacklinksPaneProps) {
  const { data: backlinks = [], isLoading } = useQuery({
    queryKey: ['backlinks', projectId, noteId],
    queryFn: () => api.get(`/projects/${projectId}/notes/${noteId}/backlinks`, z.array(NoteSchema)),
    enabled: !!noteId,
  })

  if (!noteId) {
    return (
      <div className="px-4 py-6 text-xs text-muted-foreground text-center">
        Select a note to see backlinks
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="px-3 py-3 space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 rounded bg-muted animate-pulse" />
        ))}
      </div>
    )
  }

  if ((backlinks as Note[]).length === 0) {
    return (
      <div className="px-4 py-6 text-xs text-muted-foreground text-center">
        No backlinks yet
      </div>
    )
  }

  return (
    <div className="py-2">
      <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {(backlinks as Note[]).length} backlink{(backlinks as Note[]).length !== 1 ? 's' : ''}
      </div>
      {(backlinks as Note[]).map((note) => (
        <button
          key={note.id}
          onClick={() => onSelectNote(note.id)}
          className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-accent transition-colors rounded mx-1"
        >
          <Link2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-xs font-medium text-foreground truncate">{note.title}</div>
            <div className="text-xs text-muted-foreground truncate">{note.folderPath}</div>
          </div>
        </button>
      ))}
    </div>
  )
}
