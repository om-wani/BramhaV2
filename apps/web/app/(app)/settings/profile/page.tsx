'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { api } from '@/lib/api-client'

const UserSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string(),
})

export default function ProfilePage() {
  const queryClient = useQueryClient()
  const { data: user, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get('/auth/me', UserSchema),
  })

  const [displayName, setDisplayName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [nameSaved, setNameSaved] = useState(false)

  const updateName = useMutation({
    mutationFn: (name: string) =>
      api.patch('/users/me', UserSchema, { displayName: name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] })
      setNameSaved(true)
      setTimeout(() => setNameSaved(false), 2000)
    },
    onError: () => setNameError('Failed to update name.'),
  })

  if (isLoading || !user) {
    return <div className="h-48 rounded-lg bg-muted animate-pulse" />
  }

  const initials = user.displayName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarFallback className="text-lg">{initials}</AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-medium">{user.displayName}</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
              <p className="mt-1 text-xs text-muted-foreground">Avatar upload coming soon.</p>
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!displayName.trim()) {
                setNameError('Name is required.')
                return
              }
              setNameError(null)
              updateName.mutate(displayName.trim())
            }}
            noValidate
            className="space-y-3"
          >
            <div className="space-y-2">
              <Label htmlFor="display-name">Display name</Label>
              <Input
                id="display-name"
                type="text"
                defaultValue={user.displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            {nameError && (
              <p className="text-sm text-destructive" role="alert">{nameError}</p>
            )}
            <Button type="submit" size="sm" disabled={updateName.isPending}>
              {nameSaved ? 'Saved!' : updateName.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
