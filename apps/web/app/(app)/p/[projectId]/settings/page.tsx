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

export default function ProjectSettingsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [confirmName, setConfirmName] = useState('')

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get(`/projects/${projectId}`, ProjectSchema),
  })

  const { data: members } = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => api.get(`/projects/${projectId}/members`, MembersListSchema),
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
