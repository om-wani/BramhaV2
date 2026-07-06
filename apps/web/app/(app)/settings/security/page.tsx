'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { api } from '@/lib/api-client'

const SessionSchema = z.object({
  id: z.string(),
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  isCurrent: z.boolean().optional(),
})
const SessionsListSchema = z.array(SessionSchema)

export default function SecurityPage() {
  const queryClient = useQueryClient()

  const { data: sessions, isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get('/auth/sessions', SessionsListSchema),
  })

  const revoke = useMutation({
    mutationFn: (sessionId: string) =>
      api.delete(`/auth/sessions/${sessionId}`, z.object({}).passthrough()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  })

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Active sessions</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-12 rounded bg-muted animate-pulse" />
              ))}
            </div>
          ) : !sessions?.length ? (
            <p className="text-sm text-muted-foreground">No active sessions.</p>
          ) : (
            <ul className="divide-y">
              {sessions.map((session) => (
                <li key={session.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium">
                      {session.userAgent ?? 'Unknown device'}
                      {session.isCurrent && (
                        <Badge variant="secondary" className="ml-2 text-xs">Current</Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {session.ipAddress ?? 'Unknown IP'} &middot;{' '}
                      {session.lastUsedAt
                        ? new Date(session.lastUsedAt).toLocaleDateString()
                        : 'Never'}
                    </p>
                  </div>
                  {!session.isCurrent && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => revoke.mutate(session.id)}
                      disabled={revoke.isPending}
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
