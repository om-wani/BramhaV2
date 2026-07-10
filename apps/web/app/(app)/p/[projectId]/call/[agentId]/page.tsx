'use client'

import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from '@/lib/api-client'
import { ChatRoom } from '@/components/chat/ChatRoom'
import { PersonaBioCard } from '@/components/rooms/PersonaBioCard'

const RoomSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  type: z.string(),
  name: z.string(),
  seedPrompt: z.string().nullable().optional(),
  createdBy: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const HiredPersonaSchema = z.object({
  personaId: z.string(),
  name: z.string(),
  slug: z.string(),
  role: z.string().nullable(),
  accentColor: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  hiredAt: z.string(),
})

/**
 * 1:1 Call Room page.
 * Looks up or creates the call room for (user, agentId) then renders ChatRoom.
 * Shows the persona bio card in a header above the chat.
 */
export default function CallRoomPage() {
  const params = useParams<{ projectId: string; agentId: string }>()
  const { projectId, agentId } = params

  // Get or create the 1:1 call room
  const { data: room, isLoading: roomLoading } = useQuery({
    queryKey: ['call-room', projectId, agentId],
    queryFn: () =>
      api.get(`/projects/${projectId}/agents/${agentId}/call-room`, RoomSchema),
    staleTime: 5 * 60 * 1000,
  })

  // Fetch persona details for the bio card
  const { data: persona } = useQuery({
    queryKey: ['hired-persona', projectId, agentId],
    queryFn: async () => {
      const all = await api.get(
        `/projects/${projectId}/agents`,
        z.array(HiredPersonaSchema),
      )
      return all.find((p) => p.personaId === agentId) ?? null
    },
    staleTime: 5 * 60 * 1000,
  })

  if (roomLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading 1:1 room…</span>
      </div>
    )
  }

  if (!room) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Could not open 1:1 room. Make sure this persona is hired.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Persona bio header */}
      {persona ? (
        <div className="flex items-center gap-2 border-b bg-card/80 px-4 py-2 backdrop-blur-sm">
          <PersonaBioCard persona={persona} size="sm" />
          <div className="ml-auto text-xs text-muted-foreground">1:1 Call</div>
        </div>
      ) : null}

      <div className="flex-1 overflow-hidden">
        <ChatRoom
          projectId={projectId}
          roomId={room.id}
          roomType="call"
        />
      </div>
    </div>
  )
}
