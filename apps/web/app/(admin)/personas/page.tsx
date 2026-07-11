'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from '@/lib/api-client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

const PersonaSchema = z.object({
  id: z.string(),
  scope: z.string(),
  tier: z.string(),
  slug: z.string(),
  name: z.string(),
  title: z.string().nullable(),
  color: z.string().nullable(),
  enabled: z.boolean(),
})
const PersonasSchema = z.array(PersonaSchema)
type Persona = z.infer<typeof PersonaSchema>

export default function AdminPersonasPage() {
  const { data: personas, isLoading, error } = useQuery({
    queryKey: ['admin', 'personas'],
    queryFn: () => api.get('/admin/personas', PersonasSchema),
  })

  if (isLoading) {
    return <div className="h-48 rounded-lg bg-muted animate-pulse" />
  }

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Failed to load personas.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Personas</h1>

      <Card>
        <CardHeader>
          <CardTitle>All Personas ({personas?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {!personas?.length ? (
            <p className="text-sm text-muted-foreground">No personas found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-left">
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Slug</th>
                    <th className="px-3 py-2 font-medium">Tier</th>
                    <th className="px-3 py-2 font-medium">Scope</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {personas.map((p: Persona) => (
                    <tr key={p.id} className="hover:bg-muted/20">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {p.color && (
                            <span
                              className="inline-block h-3 w-3 rounded-full flex-shrink-0"
                              style={{ backgroundColor: p.color }}
                            />
                          )}
                          <span className="font-medium">{p.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {p.slug}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="secondary">{p.tier}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline">{p.scope}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={p.enabled ? 'secondary' : 'destructive'}>
                          {p.enabled ? 'enabled' : 'disabled'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/admin/personas/${p.id}`}>Edit</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
