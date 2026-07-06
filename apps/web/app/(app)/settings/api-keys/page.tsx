'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { api } from '@/lib/api-client'

const ApiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  scopes: z.array(z.string()),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
})
const ApiKeysListSchema = z.array(ApiKeySchema)
const CreatedKeySchema = ApiKeySchema.extend({ raw: z.string() })

export default function ApiKeysPage() {
  const queryClient = useQueryClient()
  const [newKeyName, setNewKeyName] = useState('')
  const [createdRaw, setCreatedRaw] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const { data: keys, isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api.get('/users/me/api-keys', ApiKeysListSchema),
  })

  const create = useMutation({
    mutationFn: (name: string) =>
      api.post('/users/me/api-keys', CreatedKeySchema, { name, scopes: ['read', 'write'] }),
    onSuccess: (data) => {
      setCreatedRaw(data.raw)
      setNewKeyName('')
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    },
  })

  const revoke = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/users/me/api-keys/${id}`, z.object({}).passthrough()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
  })

  async function handleCopy() {
    if (!createdRaw) return
    await navigator.clipboard.writeText(createdRaw)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      {createdRaw && (
        <div
          className="rounded-lg border border-yellow-500 bg-yellow-500/10 p-4"
          role="alert"
        >
          <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
            Copy your API key now — it won&apos;t be shown again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 rounded bg-muted px-2 py-1 text-xs break-all">
              {createdRaw}
            </code>
            <Button size="sm" variant="outline" onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() => setCreatedRaw(null)}
          >
            I&apos;ve saved it
          </Button>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>API keys</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (newKeyName.trim()) create.mutate(newKeyName.trim())
            }}
            className="flex gap-2"
          >
            <div className="flex-1">
              <Label htmlFor="key-name" className="sr-only">Key name</Label>
              <Input
                id="key-name"
                type="text"
                placeholder="Key name (e.g. CI deploy)"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={create.isPending || !newKeyName.trim()}>
              {create.isPending ? 'Creating…' : 'Create key'}
            </Button>
          </form>

          {isLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-10 rounded bg-muted animate-pulse" />
              ))}
            </div>
          ) : !keys?.length ? (
            <p className="text-sm text-muted-foreground">No API keys yet.</p>
          ) : (
            <ul className="divide-y">
              {keys.map((key) => (
                <li key={key.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium">{key.name}</p>
                    <div className="mt-1 flex gap-1">
                      {key.scopes.map((s) => (
                        <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {key.lastUsedAt
                        ? `Last used ${new Date(key.lastUsedAt).toLocaleDateString()}`
                        : 'Never used'}
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => revoke.mutate(key.id)}
                    disabled={revoke.isPending}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
