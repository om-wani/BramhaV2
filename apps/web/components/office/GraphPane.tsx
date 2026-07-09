'use client'

import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { NoteSchema } from '@bramha/shared'
import type { Note } from '@bramha/shared'
import { api } from '@/lib/api-client'
import { ReactFlow, Node, Edge, Background, Controls } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useMemo } from 'react'

interface GraphPaneProps {
  projectId: string
  noteId: string
  notes: Note[]
  onSelectNote: (id: string) => void
}

function extractWikilinks(contentMd: string): string[] {
  return [...contentMd.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]!)
}

export function GraphPane({ projectId, noteId, notes, onSelectNote }: GraphPaneProps) {
  const { data: backlinks = [] } = useQuery({
    queryKey: ['backlinks', projectId, noteId],
    queryFn: () => api.get(`/projects/${projectId}/notes/${noteId}/backlinks`, z.array(NoteSchema)),
    enabled: !!noteId,
  })

  const { nodes, edges } = useMemo(() => {
    if (!noteId) return { nodes: [], edges: [] }

    const currentNote = notes.find((n) => n.id === noteId)
    if (!currentNote) return { nodes: [], edges: [] }

    // Build title → id map for forward links
    const titleToId = new Map<string, string>()
    for (const n of notes) {
      titleToId.set(n.title.toLowerCase(), n.id)
    }

    // Forward links from current note
    const forwardLinkTitles = extractWikilinks(currentNote.contentMd ?? '')
    const forwardLinkIds = forwardLinkTitles
      .map((t) => titleToId.get(t.toLowerCase()))
      .filter((id): id is string => !!id && id !== noteId)

    // Backlink ids
    const backlinkIds = (backlinks as Note[]).map((n) => n.id).filter((id) => id !== noteId)

    // All connected note ids (deduped)
    const connectedIds = Array.from(new Set([...forwardLinkIds, ...backlinkIds]))

    // Build nodes
    const graphNodes: Node[] = [
      {
        id: noteId,
        position: { x: 200, y: 200 },
        data: { label: currentNote.title },
        style: {
          background: 'var(--accent)',
          color: 'var(--accent-foreground)',
          border: '2px solid var(--primary)',
          borderRadius: '8px',
          padding: '8px 12px',
          fontSize: '12px',
          fontWeight: 600,
        },
      },
    ]

    const angleStep = connectedIds.length > 0 ? (2 * Math.PI) / connectedIds.length : 0
    connectedIds.forEach((id, i) => {
      const connectedNote = notes.find((n) => n.id === id)
      if (!connectedNote) return
      const angle = i * angleStep
      const radius = 160
      graphNodes.push({
        id,
        position: {
          x: 200 + radius * Math.cos(angle),
          y: 200 + radius * Math.sin(angle),
        },
        data: { label: connectedNote.title },
        style: {
          background: 'var(--card)',
          color: 'var(--card-foreground)',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          padding: '6px 10px',
          fontSize: '11px',
        },
      })
    })

    // Build edges
    const graphEdges: Edge[] = []
    for (const id of forwardLinkIds) {
      graphEdges.push({
        id: `forward-${noteId}-${id}`,
        source: noteId,
        target: id,
        animated: false,
        style: { stroke: 'var(--primary)' },
      })
    }
    for (const id of backlinkIds) {
      if (!forwardLinkIds.includes(id)) {
        graphEdges.push({
          id: `back-${id}-${noteId}`,
          source: id,
          target: noteId,
          animated: false,
          style: { stroke: 'var(--muted-foreground)', strokeDasharray: '4 2' },
        })
      }
    }

    return { nodes: graphNodes, edges: graphEdges }
  }, [noteId, notes, backlinks])

  if (!noteId) {
    return (
      <div className="px-4 py-6 text-xs text-muted-foreground text-center">
        Select a note to see its graph
      </div>
    )
  }

  return (
    <div className="h-full w-full" style={{ minHeight: '300px' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        onNodeClick={(_event, node) => onSelectNote(node.id)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
