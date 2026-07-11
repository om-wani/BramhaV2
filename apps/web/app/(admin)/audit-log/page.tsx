'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

// ── Schemas ──────────────────────────────────────────────────────────────────

const AuditEntrySchema = z.object({
  id: z.string(),
  actorId: z.string().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  projectId: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()).catch({}),
  createdAt: z.string(),
})
const AuditLogSchema = z.array(AuditEntrySchema)
type AuditEntry = z.infer<typeof AuditEntrySchema>

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTs(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function actionBadgeVariant(action: string): 'destructive' | 'secondary' | 'outline' {
  if (action.includes('suspend') || action.includes('delete') || action.includes('reset'))
    return 'destructive'
  if (action.includes('update') || action.includes('upsert'))
    return 'secondary'
  return 'outline'
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AuditLogPage() {
  const [actorId, setActorId]   = useState('')
  const [action,  setAction]    = useState('')
  const [from,    setFrom]      = useState('')
  const [to,      setTo]        = useState('')
  const [submitted, setSubmitted] = useState(false)

  const params = new URLSearchParams()
  if (actorId.trim()) params.set('actorId', actorId.trim())
  if (action.trim())  params.set('action',  action.trim())
  if (from.trim())    params.set('from',    from.trim())
  if (to.trim())      params.set('to',      to.trim())

  const { data: entries, isLoading, refetch } = useQuery({
    queryKey: ['admin', 'audit-log', params.toString()],
    queryFn: () => api.get(`/admin/audit-log?${params}`, AuditLogSchema),
    enabled: submitted,
  })

  const handleSearch = () => {
    setSubmitted(true)
    refetch()
  }

  const handleClear = () => {
    setActorId('')
    setAction('')
    setFrom('')
    setTo('')
    setSubmitted(false)
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Audit Log</h1>

      {/* Search form */}
      <Card>
        <CardHeader>
          <CardTitle>Search</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="actor-id">Actor ID (UUID)</Label>
              <Input
                id="actor-id"
                type="text"
                value={actorId}
                onChange={(e) => setActorId(e.target.value)}
                placeholder="User UUID…"
                className="font-mono"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="action-filter">Action</Label>
              <Input
                id="action-filter"
                type="text"
                value={action}
                onChange={(e) => setAction(e.target.value)}
                placeholder="e.g. admin.user.suspend"
                className="font-mono"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="from-date">From</Label>
              <Input
                id="from-date"
                type="datetime-local"
                value={from}
                onChange={(e) => setFrom(e.target.value ? new Date(e.target.value).toISOString() : '')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="to-date">To</Label>
              <Input
                id="to-date"
                type="datetime-local"
                value={to}
                onChange={(e) => setTo(e.target.value ? new Date(e.target.value).toISOString() : '')}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleSearch} disabled={isLoading}>
              {isLoading ? 'Searching…' : 'Search'}
            </Button>
            <Button variant="outline" onClick={handleClear}>
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {submitted && (
        <Card>
          <CardHeader>
            <CardTitle>
              Results
              {entries && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {entries.length} entries
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-48 rounded-lg bg-muted animate-pulse" />
            ) : !entries?.length ? (
              <p className="text-sm text-muted-foreground">No audit entries match the filter.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30 text-left">
                      <th className="px-3 py-2 font-medium">Timestamp</th>
                      <th className="px-3 py-2 font-medium">Actor</th>
                      <th className="px-3 py-2 font-medium">Action</th>
                      <th className="px-3 py-2 font-medium">Target</th>
                      <th className="px-3 py-2 font-medium">Project</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {entries.map((e: AuditEntry) => (
                      <tr key={e.id} className="hover:bg-muted/20">
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                          {formatTs(e.createdAt)}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {e.actorId ? `${e.actorId.slice(0, 8)}…` : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={actionBadgeVariant(e.action)}>
                            {e.action}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-muted-foreground">{e.targetType}/</span>
                          <span className="font-mono text-xs">
                            {e.targetId.length > 8
                              ? `${e.targetId.slice(0, 8)}…`
                              : e.targetId}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          {e.projectId ? `${e.projectId.slice(0, 8)}…` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
