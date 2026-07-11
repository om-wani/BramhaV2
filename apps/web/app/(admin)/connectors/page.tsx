'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from '@/lib/api-client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

// ── Schemas ──────────────────────────────────────────────────────────────────

const PersonaSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  tier: z.string(),
})
const PersonasSchema = z.array(PersonaSchema)

const ConnectorSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  projectId: z.string().nullable(),
  enabled: z.boolean(),
  manifest: z.record(z.string(), z.unknown()).catch({}),
})
const ConnectorsSchema = z.array(ConnectorSchema)

const GrantSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  personaId: z.string(),
  connectorId: z.string(),
  allowedScopes: z.array(z.string()),
  requiresApproval: z.boolean(),
})
const GrantsSchema = z.array(GrantSchema)
type Grant = z.infer<typeof GrantSchema>

const UpsertGrantResponseSchema = GrantSchema

const DeleteSchema = z.object({ success: z.boolean() })

// ── Helpers ───────────────────────────────────────────────────────────────────

function grantsKey(personaId: string, connectorId: string, grants: Grant[]) {
  return grants.find(
    (g) => g.personaId === personaId && g.connectorId === connectorId,
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ConnectorsPage() {
  const qc = useQueryClient()
  const [projectId, setProjectId] = useState('')

  const { data: personas } = useQuery({
    queryKey: ['admin', 'personas'],
    queryFn: () => api.get('/admin/personas', PersonasSchema),
  })

  const { data: connectors } = useQuery({
    queryKey: ['admin', 'mcp', 'connectors'],
    queryFn: () => api.get('/admin/mcp/connectors', ConnectorsSchema),
  })

  const { data: grants } = useQuery({
    queryKey: ['admin', 'mcp', 'grants'],
    queryFn: () => api.get('/admin/mcp/grants', GrantsSchema),
  })

  const upsert = useMutation({
    mutationFn: (body: {
      projectId: string
      personaId: string
      connectorId: string
      allowedScopes: string[]
      requiresApproval: boolean
    }) => api.post('/admin/mcp/grants', UpsertGrantResponseSchema, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'mcp', 'grants'] }),
  })

  const remove = useMutation({
    mutationFn: (grantId: string) =>
      api.delete(`/admin/mcp/grants/${grantId}`, DeleteSchema),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'mcp', 'grants'] }),
  })

  const isLoading = !personas || !connectors || !grants

  function toggleGrant(personaId: string, connectorId: string, hasGrant: Grant | undefined) {
    if (!projectId.trim()) {
      alert('Enter a project ID first to create/remove grants.')
      return
    }
    if (hasGrant) {
      remove.mutate(hasGrant.id)
    } else {
      upsert.mutate({
        projectId: projectId.trim(),
        personaId,
        connectorId,
        allowedScopes: ['read'],
        requiresApproval: false,
      })
    }
  }

  function toggleApproval(grant: Grant) {
    upsert.mutate({
      projectId: grant.projectId,
      personaId: grant.personaId,
      connectorId: grant.connectorId,
      allowedScopes: grant.allowedScopes,
      requiresApproval: !grant.requiresApproval,
    })
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Connector Grant Matrix</h1>

      <Card>
        <CardHeader>
          <CardTitle>Project Context</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <input
              type="text"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm font-mono w-80 focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Project UUID for new grants…"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Required when creating new grants.
            </p>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="h-48 rounded-lg bg-muted animate-pulse" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              Persona &times; Connector Matrix ({connectors.length} connectors)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!connectors.length ? (
              <p className="text-sm text-muted-foreground">
                No connectors registered. Register MCP connectors first.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30 text-left">
                      <th className="px-3 py-2 font-medium">Persona</th>
                      {connectors.map((c) => (
                        <th key={c.id} className="px-3 py-2 font-medium text-center">
                          <div>{c.name}</div>
                          <Badge variant="outline" className="text-xs">{c.slug}</Badge>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {personas
                      ?.filter((p) => p.tier === 'csuite' || p.tier === 'specialist')
                      .map((persona) => (
                        <tr key={persona.id} className="hover:bg-muted/20">
                          <td className="px-3 py-2">
                            <div className="font-medium">{persona.name}</div>
                            <div className="text-xs text-muted-foreground">{persona.slug}</div>
                          </td>
                          {connectors.map((connector) => {
                            const grant = grantsKey(persona.id, connector.id, grants ?? [])
                            return (
                              <td key={connector.id} className="px-3 py-2 text-center">
                                <div className="flex flex-col items-center gap-2">
                                  {/* Access toggle */}
                                  <Switch
                                    checked={!!grant}
                                    onCheckedChange={() =>
                                      toggleGrant(persona.id, connector.id, grant)
                                    }
                                    aria-label={`Toggle ${persona.name} access to ${connector.name}`}
                                  />
                                  {/* Requires approval toggle */}
                                  {grant && (
                                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                                      <Switch
                                        checked={grant.requiresApproval}
                                        onCheckedChange={() => toggleApproval(grant)}
                                        aria-label={`Toggle approval requirement for ${persona.name} on ${connector.name}`}
                                      />
                                      <span>approval</span>
                                    </div>
                                  )}
                                </div>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Existing grants flat list */}
      {grants && grants.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>All Grants ({grants.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-left">
                    <th className="px-3 py-2 font-medium">Project</th>
                    <th className="px-3 py-2 font-medium">Persona</th>
                    <th className="px-3 py-2 font-medium">Connector</th>
                    <th className="px-3 py-2 font-medium">Scopes</th>
                    <th className="px-3 py-2 font-medium">Approval</th>
                    <th className="px-3 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {grants.map((g) => (
                    <tr key={g.id} className="hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono text-xs">{g.projectId.slice(0, 8)}&hellip;</td>
                      <td className="px-3 py-2 font-mono text-xs">{g.personaId.slice(0, 8)}&hellip;</td>
                      <td className="px-3 py-2 font-mono text-xs">{g.connectorId.slice(0, 8)}&hellip;</td>
                      <td className="px-3 py-2">
                        {g.allowedScopes.map((s) => (
                          <Badge key={s} variant="outline" className="mr-1">{s}</Badge>
                        ))}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={g.requiresApproval ? 'secondary' : 'outline'}>
                          {g.requiresApproval ? 'required' : 'auto'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(g.id)}
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
