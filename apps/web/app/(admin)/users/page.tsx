'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from '@/lib/api-client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

const AdminUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  isAdmin: z.boolean(),
  isSuspended: z.boolean(),
  totpEnabled: z.boolean(),
  createdAt: z.string(),
})
const AdminUsersSchema = z.array(AdminUserSchema)
type AdminUser = z.infer<typeof AdminUserSchema>

const OkSchema = z.object({}).passthrough()

export default function AdminUsersPage() {
  const qc = useQueryClient()

  const { data: users, isLoading, error } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api.get('/admin/users', AdminUsersSchema),
  })

  const suspend = useMutation({
    mutationFn: (userId: string) =>
      api.post(`/admin/users/${userId}/suspend`, OkSchema, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })

  const unsuspend = useMutation({
    mutationFn: (userId: string) =>
      api.post(`/admin/users/${userId}/unsuspend`, OkSchema, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })

  const reset2fa = useMutation({
    mutationFn: (userId: string) =>
      api.post(`/admin/users/${userId}/reset-2fa`, OkSchema, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })

  if (isLoading) {
    return <div className="h-48 rounded-lg bg-muted animate-pulse" />
  }

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Failed to load users. Check that you have admin access.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Users</h1>

      <Card>
        <CardHeader>
          <CardTitle>All Users ({users?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {!users?.length ? (
            <p className="text-sm text-muted-foreground">No users found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-left">
                    <th className="px-3 py-2 font-medium">Email</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Roles</th>
                    <th className="px-3 py-2 font-medium">2FA</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {users.map((u: AdminUser) => (
                    <tr key={u.id} className="hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono text-xs">{u.email}</td>
                      <td className="px-3 py-2">{u.displayName}</td>
                      <td className="px-3 py-2">
                        {u.isAdmin && <Badge variant="secondary">admin</Badge>}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={u.totpEnabled ? 'secondary' : 'outline'}>
                          {u.totpEnabled ? 'enabled' : 'off'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={u.isSuspended ? 'destructive' : 'outline'}>
                          {u.isSuspended ? 'suspended' : 'active'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          {u.isSuspended ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={unsuspend.isPending}
                              onClick={() => unsuspend.mutate(u.id)}
                            >
                              Unsuspend
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={suspend.isPending}
                              onClick={() => suspend.mutate(u.id)}
                            >
                              Suspend
                            </Button>
                          )}
                          {u.totpEnabled && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={reset2fa.isPending}
                              onClick={() => reset2fa.mutate(u.id)}
                            >
                              Reset 2FA
                            </Button>
                          )}
                        </div>
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
