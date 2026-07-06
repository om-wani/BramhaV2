'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, ApiError } from '@/lib/api-client'
import { z } from 'zod'

const CreateProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
})

interface NewProjectDialogProps {
  orgId: string
  open: boolean
  onClose: () => void
  onCreated: () => void
}

export function NewProjectDialog({ orgId, open, onClose, onCreated }: NewProjectDialogProps) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (!open) return null

  function handleNameChange(value: string) {
    setName(value)
    setSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError('Project name is required.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const project = await api.post(`/orgs/${orgId}/projects`, CreateProjectSchema, {
        name: name.trim(),
        slug: slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      })
      onCreated()
      router.push(`/p/${project.id}`)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('A project with that name already exists.')
      } else {
        setError('Failed to create project. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-project-title"
    >
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-xl">
        <h2 id="new-project-title" className="text-xl font-semibold">New project</h2>
        <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              type="text"
              required
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="My project"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-slug">Slug</Label>
            <Input
              id="project-slug"
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="my-project"
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating…' : 'Create project'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
