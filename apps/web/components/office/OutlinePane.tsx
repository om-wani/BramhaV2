'use client'

import React from 'react'
import type { Editor } from '@tiptap/core'
import { List } from 'lucide-react'

interface OutlinePaneProps {
  headings: Array<{ level: number; text: string; id: string }>
  editorRef: React.RefObject<Editor | null>
}

const INDENT_MAP: Record<number, string> = {
  1: 'pl-0',
  2: 'pl-4',
  3: 'pl-8',
  4: 'pl-12',
  5: 'pl-16',
  6: 'pl-20',
}

export function OutlinePane({ headings, editorRef }: OutlinePaneProps) {
  const handleHeadingClick = () => {
    // Focus the editor — simple approach as described in spec
    if (editorRef.current) {
      editorRef.current.commands?.focus?.()
    }
  }

  if (headings.length === 0) {
    return (
      <div className="px-4 py-6 text-xs text-muted-foreground text-center">
        No headings in this note
      </div>
    )
  }

  return (
    <div className="py-2">
      <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <List className="h-3.5 w-3.5" aria-hidden="true" />
        Outline
      </div>
      <nav aria-label="Note outline">
        {headings.map((heading) => (
          <button
            key={heading.id}
            onClick={() => handleHeadingClick()}
            className={[
              'w-full text-left px-3 py-1 text-xs hover:bg-accent hover:text-accent-foreground transition-colors rounded mx-1',
              INDENT_MAP[heading.level] ?? 'pl-0',
            ].join(' ')}
          >
            <span className="text-muted-foreground mr-1.5 select-none">
              {'#'.repeat(heading.level)}
            </span>
            <span className="text-foreground">{heading.text}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
