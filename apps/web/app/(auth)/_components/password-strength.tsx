'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

type Score = 0 | 1 | 2 | 3 | 4

const LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const
const COLORS = [
  'bg-destructive',
  'bg-destructive',
  'bg-yellow-500',
  'bg-green-500',
  'bg-green-600',
] as const

interface PasswordStrengthProps {
  password: string
}

export function PasswordStrength({ password }: PasswordStrengthProps) {
  const [score, setScore] = useState<Score | null>(null)

  useEffect(() => {
    if (!password) {
      setScore(null)
      return
    }
    import('zxcvbn').then((mod) => {
      setScore(mod.default(password).score as Score)
    })
  }, [password])

  if (!password || score === null) return null

  return (
    <div className="space-y-1" aria-live="polite" aria-atomic="true">
      <div className="flex gap-1" role="img" aria-label={`Password strength: ${LABELS[score]}`}>
        {([0, 1, 2, 3] as const).map((i) => (
          <div
            key={i}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors',
              i <= score ? COLORS[score] : 'bg-muted'
            )}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{LABELS[score]}</p>
    </div>
  )
}
