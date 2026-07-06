'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api-client'
import { ProjectCard } from './_components/project-card'
import { NewProjectDialog } from './_components/new-project-dialog'

const OrgSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
})

const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  memberCount: z.number().optional().default(0),
  createdAt: z.string(),
})

const OrgsListSchema = z.array(OrgSchema)
const ProjectsListSchema = z.array(ProjectSchema)

export default function DashboardPage() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)

  const { data: orgs, isLoading: orgsLoading } = useQuery({
    queryKey: ['orgs'],
    queryFn: () => api.get('/orgs', OrgsListSchema),
  })

  const firstOrgId = orgs?.[0]?.id

  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects', firstOrgId],
    queryFn: () => api.get(`/orgs/${firstOrgId}/projects`, ProjectsListSchema),
    enabled: !!firstOrgId,
  })

  const loading = orgsLoading || (!!firstOrgId && projectsLoading)

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        {firstOrgId && (
          <Button onClick={() => setDialogOpen(true)}>New project</Button>
        )}
      </div>

      <div className="mt-8">
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-48 rounded-lg" />
            ))}
          </div>
        ) : !projects?.length ? (
          <div className="rounded-lg border border-dashed p-12 text-center">
            <p className="text-muted-foreground">No projects yet.</p>
            {firstOrgId && (
              <Button className="mt-4" onClick={() => setDialogOpen(true)}>
                Create your first project
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>

      {firstOrgId && (
        <NewProjectDialog
          orgId={firstOrgId}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onCreated={() => {
            setDialogOpen(false)
            queryClient.invalidateQueries({ queryKey: ['projects', firstOrgId] })
          }}
        />
      )}
    </div>
  )
}
