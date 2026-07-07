'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ArtifactVersion {
  artifactId: string
  version: number
  contentKey: string
  contentSha256: string
  sizeBytes: number
  createdAt: string
}

interface VersionSwitcherProps {
  versions: ArtifactVersion[]
  currentVersion: number
  onSwitch: (version: number) => void
}

// ── Component ──────────────────────────────────────────────────────────────────

export function VersionSwitcher({ versions, currentVersion, onSwitch }: VersionSwitcherProps) {
  const sorted = [...versions].sort((a, b) => a.version - b.version)
  const currentIndex = sorted.findIndex((v) => v.version === currentVersion)
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < sorted.length - 1

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Artifact version navigation">
      {/* ← prev */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={!hasPrev}
        onClick={() => {
          const prev = sorted[currentIndex - 1]
          if (hasPrev && prev) onSwitch(prev.version)
        }}
        aria-label="Previous version"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      {/* Dropdown showing all versions */}
      <select
        value={currentVersion}
        onChange={(e) => onSwitch(Number(e.target.value))}
        disabled={sorted.length <= 1}
        aria-label="Select version"
        className={cn(
          'h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground',
          'focus:outline-none focus:ring-2 focus:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        {sorted.map((v) => (
          <option key={v.version} value={v.version}>
            v{v.version}
          </option>
        ))}
      </select>

      {/* next → */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={!hasNext}
        onClick={() => {
          const next = sorted[currentIndex + 1]
          if (hasNext && next) onSwitch(next.version)
        }}
        aria-label="Next version"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}
