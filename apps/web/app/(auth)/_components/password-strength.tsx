'use client'

import { useMemo } from 'react'
import zxcvbn from 'zxcvbn'
import { cn } from '@/lib/utils'

type Score = 0 | 1 | 2 | 3 | 4

const LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong']
const COLORS = [
  'bg-destructive',
  'bg-destructive',
  'bg-yellow-500',
  'bg-green-500',
  'bg-green-600',
]

function labelFor(score: Score): string {
  // eslint-disable-next-line security/detect-object-injection
  return LABELS[score] ?? 'Unknown'
}

function colorFor(score: Score): string {
  // eslint-disable-next-line security/detect-object-injection
  return COLORS[score] ?? 'bg-muted'
}

interface PasswordStrengthProps {
  password: string
}

export function PasswordStrength({ password }: PasswordStrengthProps) {
  const score = useMemo<Score | null>(
    () => (password ? (zxcvbn(password).score as Score) : null),
    [password]
  )

  if (!password || score === null) return null

  return (
    <div className="space-y-1" aria-live="polite" aria-atomic="true">
      <div
        className="flex gap-1"
        role="img"
        aria-label={`Password strength: ${labelFor(score)}`}
      >
        {([0, 1, 2, 3] as Score[]).map((i) => (
          <div
            key={i}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors',
              i <= score ? colorFor(score) : 'bg-muted'
            )}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{labelFor(score)}</p>
    </div>
  )
}
