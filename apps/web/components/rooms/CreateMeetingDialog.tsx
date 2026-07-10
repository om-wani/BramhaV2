'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { HiredPersonaSchema, type HiredPersona } from '@bramha/shared'
import { api } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PersonaBioCard } from './PersonaBioCard'
import { cn } from '@/lib/utils'

// ── Schemas ────────────────────────────────────────────────────────────────────

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

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string
  open: boolean
  onClose: () => void
  onCreated: (room: Room) => void
}

// ── Component ──────────────────────────────────────────────────────────────────

export function CreateMeetingDialog({ projectId, open, onClose, onCreated }: Props) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [seedPrompt, setSeedPrompt] = useState('')
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setName('')
      setSeedPrompt('')
      setSelectedPersonaIds(new Set())
      setError(null)
    }
  }, [open])

  const { data: personas = [] } = useQuery({
    queryKey: ['hired-personas', projectId],
    queryFn: () => api.get(`/projects/${projectId}/agents`, z.array(HiredPersonaSchema)),
    enabled: open,
    staleTime: 60 * 1000,
  })

  function togglePersona(personaId: string) {
    setSelectedPersonaIds((prev) => {
      const next = new Set(prev)
      if (next.has(personaId)) {
        next.delete(personaId)
      } else {
        next.add(personaId)
      }
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError('Meeting name is required.')
      return
    }
    if (selectedPersonaIds.size === 0) {
      setError('Select at least one persona for the meeting.')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      // Create the meeting room
      const room = await api.post(`/projects/${projectId}/rooms`, RoomSchema, {
        type: 'meeting',
        name: name.trim(),
        ...(seedPrompt.trim() ? { seedPrompt: seedPrompt.trim() } : {}),
      })

      // Add each selected persona as a participant
      await Promise.all(
        Array.from(selectedPersonaIds).map((personaId) =>
          api.post(
            `/projects/${projectId}/rooms/${room.id}/participants`,
            z.unknown(),
            { participantKind: 'agent', personaId },
          ),
        ),
      )

      onCreated(room)
      onClose()
      router.push(`/p/${projectId}/meeting/${room.id}`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create meeting.'
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create Meeting"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md rounded-lg border bg-card shadow-xl">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-semibold">Create Meeting</h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-4">
          {/* Meeting name */}
          <div className="space-y-1">
            <Label htmlFor="meeting-name">Meeting Name</Label>
            <Input
              id="meeting-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="e.g. Pricing War-Room"
              required
            />
          </div>

          {/* Roster picker */}
          <div className="space-y-2">
            <Label>
              Participants{' '}
              <span className="text-xs text-muted-foreground">(select 1 or more)</span>
            </Label>
            {personas.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No personas hired. Hire personas in Settings first.
              </p>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-md border divide-y">
                {personas.map((p: HiredPersona) => (
                  <label
                    key={p.personaId}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 px-3 py-1 transition-colors hover:bg-accent/50',
                      selectedPersonaIds.has(p.personaId) && 'bg-accent/30',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border"
                      checked={selectedPersonaIds.has(p.personaId)}
                      onChange={() => togglePersona(p.personaId)}
                    />
                    <PersonaBioCard persona={p} size="sm" />
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Seed prompt */}
          <div className="space-y-1">
            <Label htmlFor="seed-prompt">
              Opening Prompt{' '}
              <span className="text-xs text-muted-foreground">(optional)</span>
            </Label>
            <textarea
              id="seed-prompt"
              value={seedPrompt}
              onChange={(e) => setSeedPrompt(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Optional opening prompt for this meeting..."
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || selectedPersonaIds.size === 0}>
              {submitting ? 'Creating…' : 'Create Meeting'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
