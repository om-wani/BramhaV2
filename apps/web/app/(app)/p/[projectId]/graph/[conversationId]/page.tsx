'use client'

/**
 * Conversation graph route: /p/:projectId/graph/:conversationId
 *
 * Split into:
 *   ConversationGraphPage — async server component (awaits params)
 *   ConversationGraphLoader — client component (fetches roomId, renders graph)
 */

import { use, useEffect, useState } from 'react'
import { z } from 'zod'
import { api } from '@/lib/api-client'
import { ConversationGraph } from '@/components/graph/ConversationGraph'

// ── Room schema (subset we need) ───────────────────────────────────────────────

const RoomSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string().optional(),
})

const RoomsSchema = z.array(RoomSchema)

// ── Loader ─────────────────────────────────────────────────────────────────────

interface LoaderProps {
  projectId: string
  conversationId: string
}

function ConversationGraphLoader({ projectId, conversationId }: LoaderProps) {
  const [roomId, setRoomId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchRoom() {
      try {
        const rooms = await api.get(`/projects/${projectId}/rooms`, RoomsSchema)
        if (cancelled) return

        const firstRoom = rooms[0]
        if (!firstRoom) {
          setLoadError('No rooms found in this project.')
          return
        }

        // Prefer the conference room (kind === 'conference'), else use first room
        const conference = rooms.find((r) => r.kind === 'conference') ?? firstRoom
        setRoomId(conference.id)
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load room.')
        }
      }
    }

    void fetchRoom()
    return () => {
      cancelled = true
    }
  }, [projectId])

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p role="alert" className="text-sm text-destructive">
          {loadError}
        </p>
      </div>
    )
  }

  if (!roomId) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">Loading room…</p>
      </div>
    )
  }

  return (
    <div className="h-full">
      <ConversationGraph
        projectId={projectId}
        roomId={roomId}
        conversationId={conversationId}
      />
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

interface Props {
  params: Promise<{ projectId: string; conversationId: string }>
}

export default function ConversationGraphPage({ params }: Props) {
  const { projectId, conversationId } = use(params)

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-4 py-2">
        <h1 className="text-sm font-medium text-muted-foreground">
          Conversation DAG
        </h1>
      </header>
      <div className="min-h-0 flex-1">
        <ConversationGraphLoader projectId={projectId} conversationId={conversationId} />
      </div>
    </div>
  )
}
