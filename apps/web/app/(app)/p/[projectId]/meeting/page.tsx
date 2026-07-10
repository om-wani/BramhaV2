'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { CreateMeetingDialog } from '@/components/rooms/CreateMeetingDialog'
import { cn } from '@/lib/utils'

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

type Room = z.infer<typeof RoomSchema>

export default function MeetingsPage() {
  const params = useParams<{ projectId: string }>()
  const projectId = params.projectId
  const [dialogOpen, setDialogOpen] = useState(false)

  const { data: rooms = [], refetch } = useQuery({
    queryKey: ['rooms', projectId, 'meeting'],
    queryFn: () =>
      api.get(`/projects/${projectId}/rooms?type=meeting`, z.array(RoomSchema)),
    staleTime: 30 * 1000,
  })

  const activeRooms = rooms.filter((r: Room) => !r.archivedAt)
  const archivedRooms = rooms.filter((r: Room) => !!r.archivedAt)

  return (
    <div className="flex h-full flex-col overflow-auto p-6">
      <h1 className="text-2xl font-bold mb-1">Meetings</h1>
      <p className="text-muted-foreground text-sm mb-6">
        Focused rooms with a subset of hired personas.
      </p>

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Active
        </h2>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          + New Meeting
        </Button>
      </div>

      {activeRooms.length === 0 ? (
        <p className="text-sm text-muted-foreground mb-8">
          No active meetings yet.{' '}
          <button
            className="underline hover:text-foreground"
            onClick={() => setDialogOpen(true)}
          >
            Create one
          </button>
          .
        </p>
      ) : (
        <ul className="space-y-2 mb-8" role="list">
          {activeRooms.map((room: Room) => (
            <li key={room.id}>
              <Link
                href={`/p/${projectId}/meeting/${room.id}`}
                className={cn(
                  'flex items-center gap-3 rounded-md border px-4 py-3 text-sm',
                  'hover:bg-accent/50 transition-colors',
                )}
              >
                <span className="text-base" aria-hidden="true">
                  🗣
                </span>
                <span className="flex-1 font-medium">{room.name}</span>
                {room.seedPrompt ? (
                  <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                    {room.seedPrompt}
                  </span>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {new Date(room.createdAt).toLocaleDateString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {archivedRooms.length > 0 ? (
        <>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Archived
          </h2>
          <ul className="space-y-2 opacity-60" role="list">
            {archivedRooms.map((room: Room) => (
              <li key={room.id}>
                <Link
                  href={`/p/${projectId}/meeting/${room.id}`}
                  className="flex items-center gap-3 rounded-md border px-4 py-3 text-sm hover:bg-accent/50 transition-colors"
                >
                  <span className="text-base" aria-hidden="true">
                    🗄
                  </span>
                  <span className="flex-1 font-medium line-through">{room.name}</span>
                  <span className="text-xs text-muted-foreground">Archived</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <CreateMeetingDialog
        projectId={projectId}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={() => refetch()}
      />
    </div>
  )
}
