'use client'

import React, { useMemo } from 'react'
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
  // Derive headings with ProseMirror positions from editor state.
  // `headings` (from props) acts as the reactivity trigger: it updates whenever
  // the doc changes, causing this memo to recompute fresh positions.
  const headingsWithPos = useMemo(() => {
    const editor = editorRef.current
    if (!editor) {
      return headings.map((h) => ({ ...h, pos: 0 }))
    }
    const result: Array<{ level: number; text: string; id: string; pos: number }> = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        const level = node.attrs.level as number
        const text = node.textContent
        const id = `heading-${level}-${text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`
        result.push({ level, text, id, pos })
      }
    })
    return result
  // `headings` is the reactivity proxy: it changes when the doc changes, triggering
  // a re-render that recomputes positions from editorRef.current (mutable ref).
  }, [headings])

  const handleHeadingClick = (pos: number) => {
    const editor = editorRef.current
    if (!editor) return
    editor.chain().focus().setTextSelection(pos).scrollIntoView().run()
  }

  if (headingsWithPos.length === 0) {
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
        {headingsWithPos.map((heading) => (
          <button
            key={heading.id}
            onClick={() => handleHeadingClick(heading.pos)}
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
