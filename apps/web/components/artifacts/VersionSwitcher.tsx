'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
  const latestVersion = sorted[sorted.length - 1]?.version ?? currentVersion

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Artifact version navigation">
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

      <span className="min-w-[72px] text-center text-xs text-muted-foreground" aria-live="polite">
        v{currentVersion} / v{latestVersion}
      </span>

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
