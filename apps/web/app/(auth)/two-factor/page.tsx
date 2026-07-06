'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthCard } from '../_components/auth-card'
import { api, ApiError } from '@/lib/api-client'

const ChallengeResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number(),
})

export default function TwoFactorPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const preAuthToken = searchParams.get('token') ?? ''

  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (!preAuthToken) {
    return (
      <AuthCard title="Two-factor authentication">
        <p className="text-sm text-muted-foreground text-center" role="alert">
          Your session has expired. Please{' '}
          <Link href="/login" className="text-primary hover:underline">sign in again</Link>.
        </p>
      </AuthCard>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim()) {
      setError('Please enter your authentication code.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await api.post('/auth/2fa/challenge', ChallengeResponseSchema, { preAuthToken, code })
      router.push('/dashboard')
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Too many attempts. Please wait before trying again.')
      } else {
        setError('Invalid code. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthCard
      title="Two-factor authentication"
      description="Enter the 6-digit code from your authenticator app."
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="code">Authentication code</Label>
          <Input
            id="code"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
            className="text-center tracking-widest text-lg"
          />
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? 'Verifying…' : 'Verify'}
        </Button>
      </form>
    </AuthCard>
  )
}
