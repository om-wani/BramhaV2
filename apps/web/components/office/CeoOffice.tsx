'use client'

import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { NoteSchema } from '@bramha/shared'
import { api } from '@/lib/api-client'
import { NoteTree } from './NoteTree'
import { NoteEditor } from './NoteEditor'
import { BacklinksPane } from './BacklinksPane'
import { OutlinePane } from './OutlinePane'
import { GraphPane } from './GraphPane'
import type { Note } from '@bramha/shared'
import type { Editor } from '@tiptap/core'

type RightTab = 'backlinks' | 'outline' | 'graph'

interface CeoOfficeProps {
  projectId: string
}

export function CeoOffice({ projectId }: CeoOfficeProps) {
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [rightPaneTab, setRightPaneTab] = useState<RightTab>('backlinks')
  const [showTrash, setShowTrash] = useState(false)
  const [outlineHeadings, setOutlineHeadings] = useState<Array<{ level: number; text: string; id: string }>>([])
  const editorRef = useRef<Editor | null>(null)

  const { data: notes = [] } = useQuery({
    queryKey: ['notes', projectId],
    queryFn: () => api.get(`/projects/${projectId}/notes`, z.array(NoteSchema)),
  })

  const selectedNote = (notes as Note[]).find((n) => n.id === selectedNoteId) ?? null

  const tabs: { id: RightTab; label: string }[] = [
    { id: 'backlinks', label: 'Backlinks' },
    { id: 'outline', label: 'Outline' },
    { id: 'graph', label: 'Graph' },
  ]

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-3 border-b bg-card px-4 py-3">
        <h1 className="text-sm font-semibold text-foreground">CEO's Office</h1>
        {selectedNote && (
          <nav aria-label="Note breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
            <span aria-hidden="true">/</span>
            <span>{selectedNote.folderPath === '/' ? 'Root' : selectedNote.folderPath}</span>
            <span aria-hidden="true">/</span>
            <span>{selectedNote.title}</span>
          </nav>
        )}
      </header>

      {/* Three-panel body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: NoteTree (220px) */}
        <aside className="w-[220px] shrink-0 border-r overflow-y-auto">
          <NoteTree
            projectId={projectId}
            selectedNoteId={selectedNoteId}
            onSelectNote={setSelectedNoteId}
            showTrash={showTrash}
            onToggleTrash={() => setShowTrash((v) => !v)}
          />
        </aside>

        {/* Center: NoteEditor (flex-1) */}
        <main className="flex-1 overflow-hidden flex flex-col">
          {selectedNoteId ? (
            <NoteEditor
              projectId={projectId}
              noteId={selectedNoteId}
              onOutlineChange={setOutlineHeadings}
              editorRef={editorRef}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              Select a note to start writing
            </div>
          )}
        </main>

        {/* Right: Right pane (280px) */}
        <aside className="w-[280px] shrink-0 border-l overflow-y-auto flex flex-col">
          {/* Tab bar */}
          <div className="flex border-b shrink-0" role="tablist" aria-label="Note details">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={rightPaneTab === tab.id}
                onClick={() => setRightPaneTab(tab.id)}
                className={[
                  'flex-1 px-2 py-2 text-xs font-medium transition-colors',
                  rightPaneTab === tab.id
                    ? 'border-b-2 border-primary text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            {rightPaneTab === 'backlinks' && (
              <BacklinksPane
                projectId={projectId}
                noteId={selectedNoteId ?? ''}
                onSelectNote={setSelectedNoteId}
              />
            )}
            {rightPaneTab === 'outline' && (
              <OutlinePane
                headings={outlineHeadings}
                editorRef={editorRef}
              />
            )}
            {rightPaneTab === 'graph' && (
              <GraphPane
                projectId={projectId}
                noteId={selectedNoteId ?? ''}
                notes={notes as Note[]}
                onSelectNote={setSelectedNoteId}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
