'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api-client'

const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  archivedAt: z.string().nullable().optional(),
})

const MemberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  role: z.enum(['owner', 'editor', 'viewer']),
  displayName: z.string().optional(),
})
const MembersListSchema = z.array(MemberSchema)

const RoomSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  isConfidential: z.boolean(),
  archivedAt: z.string().nullable().optional(),
})
const RoomsListSchema = z.array(RoomSchema)
type Room = z.infer<typeof RoomSchema>

export default function ProjectSettingsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [confirmName, setConfirmName] = useState('')
  const [updateRoomError, setUpdateRoomError] = useState<string | null>(null)

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get(`/projects/${projectId}`, ProjectSchema),
  })

  const { data: members } = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => api.get(`/projects/${projectId}/members`, MembersListSchema),
  })

  const { data: rooms } = useQuery({
    queryKey: ['project-rooms', projectId],
    queryFn: () => api.get(`/projects/${projectId}/rooms`, RoomsListSchema),
  })

  const updateRoom = useMutation({
    mutationFn: ({ roomId, isConfidential }: { roomId: string; isConfidential: boolean }) =>
      api.patch(`/projects/${projectId}/rooms/${roomId}`, RoomSchema, { isConfidential }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-rooms', projectId] })
      setUpdateRoomError(null)
    },
    onError: () => {
      setUpdateRoomError('Failed to update room confidentiality. Please try again.')
    },
  })

  const archive = useMutation({
    mutationFn: () =>
      api.patch(`/projects/${projectId}`, ProjectSchema, {
        archivedAt: new Date().toISOString(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      router.push('/dashboard')
    },
  })

  if (isLoading || !project) {
    return <div className="h-48 rounded-lg bg-muted animate-pulse" />
  }

  const canArchive = confirmName === project.name

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold">{project.name} — Settings</h1>

      {/* Members */}
      <Card>
        <CardHeader><CardTitle>Members</CardTitle></CardHeader>
        <CardContent>
          {!members?.length ? (
            <p className="text-sm text-muted-foreground">No members found.</p>
          ) : (
            <ul className="divide-y">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between py-3">
                  <span className="text-sm">{m.displayName ?? m.userId}</span>
                  <Badge variant="secondary">{m.role}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Context Routing */}
      <Card>
        <CardHeader><CardTitle>Context Routing</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <section aria-labelledby="context-routing-heading">
            <h2 id="context-routing-heading" className="sr-only">Context Routing Matrix</h2>
            <p className="text-sm text-muted-foreground mb-3">
              Controls which context crosses room boundaries for each agent turn.
            </p>
            <div className="rounded-md border text-sm overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-3 py-2 text-left font-medium">Context type</th>
                    <th className="px-3 py-2 text-left font-medium">Routing rule</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="px-3 py-2">Knowledge chunks (RAG)</td>
                    <td className="px-3 py-2 text-muted-foreground">All rooms, always</td>
                  </tr>
                  <tr className="border-b">
                    <td className="px-3 py-2">Rolling summary</td>
                    <td className="px-3 py-2 text-muted-foreground">Same room only</td>
                  </tr>
                  <tr className="border-b">
                    <td className="px-3 py-2">Working-memory facts</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      Agent-global, except confidential 1:1s
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2">Open loops</td>
                    <td className="px-3 py-2 text-muted-foreground">Current conversation only</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Per-room confidentiality toggles (call rooms only) */}
          {rooms && rooms.filter((r: Room) => r.type === 'call').length > 0 && (
            <section aria-labelledby="confidential-rooms-heading">
              <h2 id="confidential-rooms-heading" className="text-sm font-semibold mb-2 mt-4">
                1:1 Room Confidentiality
              </h2>
              <p className="text-sm text-muted-foreground mb-3">
                When enabled, facts learned in a 1:1 room are excluded from all other rooms
                until you debrief the agent (disable this toggle).
              </p>
              <ul className="space-y-2">
                {rooms
                  .filter((r: Room) => r.type === 'call')
                  .map((room: Room) => (
                    <li
                      key={room.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <span className="text-sm">{room.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {room.isConfidential ? 'Confidential' : 'Shared'}
                        </span>
                        <Switch
                          checked={room.isConfidential}
                          disabled={updateRoom.isPending}
                          onCheckedChange={(checked) =>
                            updateRoom.mutate({ roomId: room.id, isConfidential: checked })
                          }
                          aria-label={`Toggle confidentiality for ${room.name}`}
                        />
                      </div>
                    </li>
                  ))}
              </ul>
              {updateRoomError && (
                <p role="alert" className="text-xs text-destructive mt-2">
                  {updateRoomError}
                </p>
              )}
            </section>
          )}
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Archiving a project hides it from the dashboard. Type the project name to confirm.
          </p>
          <div className="space-y-2">
            <Label htmlFor="confirm-name">
              Type <strong>{project.name}</strong> to confirm
            </Label>
            <Input
              id="confirm-name"
              type="text"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={project.name}
            />
          </div>
          <Button
            variant="destructive"
            disabled={!canArchive || archive.isPending}
            onClick={() => archive.mutate()}
          >
            {archive.isPending ? 'Archiving…' : 'Archive project'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
