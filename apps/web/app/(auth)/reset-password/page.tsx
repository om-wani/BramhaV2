'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthCard } from '../_components/auth-card'
import { PasswordStrength } from '../_components/password-strength'
import { api, ApiError } from '@/lib/api-client'

const ResetSchema = z.object({
  password: z.string().min(8),
})
const OkSchema = z.object({}).passthrough()

export default function ResetPasswordPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = ResetSchema.safeParse({ password })
    if (!parsed.success) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (!token) {
      setError('Invalid or expired reset link.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await api.post('/auth/reset-password', OkSchema, { token, password })
      router.push('/login?reset=1')
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError('This reset link is invalid or has expired.')
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthCard title="Set new password">
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
          />
          <PasswordStrength password={password} />
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={loading || !token}>
          {loading ? 'Saving…' : 'Set new password'}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          <Link href="/login" className="text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </form>
    </AuthCard>
  )
}
