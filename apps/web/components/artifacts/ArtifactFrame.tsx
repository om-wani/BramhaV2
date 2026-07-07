'use client'

/**
 * ArtifactFrame — sandboxed iframe wrapper for artifact rendering
 *
 * Security invariants (enforced here):
 *  - sandbox="allow-scripts" ONLY: no allow-same-origin → artifact JS cannot
 *    read parent document.cookie or navigate top.location
 *  - postMessage origin is validated against NEXT_PUBLIC_ARTIFACT_ORIGIN
 *    (or window.location.origin in dev); messages from any other origin are
 *    silently ignored
 *  - Malformed/erroring content surfaces as an error overlay — never a blank pane
 */

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

type BridgeMessage =
  | { type: 'resize'; height: number }
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'console'; level: string; args: string[] }

export interface ArtifactFrameProps {
  /** Full URL for the /artifact-frame route, including url= and kind= params */
  src: string
  title?: string
  className?: string
  /** Called when the frame emits a console message */
  onConsole?: (level: string, args: string[]) => void
}

// Fallback height before the first resize message arrives
const INITIAL_HEIGHT = 240
// If no ready/resize message arrives within this window, show a timeout error
const READY_TIMEOUT_MS = 15_000

// ── Component ──────────────────────────────────────────────────────────────────

export function ArtifactFrame({ src, title = 'Artifact', className, onConsole }: ArtifactFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const onConsoleRef = useRef(onConsole)
  onConsoleRef.current = onConsole
  const [height, setHeight] = useState(INITIAL_HEIGHT)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Resolve expected origin once per mount.
    // NEXT_PUBLIC_ARTIFACT_ORIGIN is set to the separate artifact-serving domain
    // in production (e.g. https://artifacts.bramhav2.com). Falls back to the
    // current origin in development.
    const expectedOrigin =
      process.env.NEXT_PUBLIC_ARTIFACT_ORIGIN ?? window.location.origin

    const handleMessage = (event: MessageEvent) => {
      // ── Origin guard — the critical security check ────────────────────────
      if (event.origin !== expectedOrigin) return

      const data = event.data as BridgeMessage
      if (!data || typeof data.type !== 'string') return

      switch (data.type) {
        case 'resize':
          if (typeof data.height === 'number' && data.height > 0) {
            setHeight(data.height)
          }
          setIsLoading(false)
          break
        case 'ready':
          setIsLoading(false)
          break
        case 'error':
          if (typeof data.message === 'string') {
            setError(data.message)
          }
          setIsLoading(false)
          break
        case 'console':
          onConsoleRef.current?.(data.level, data.args ?? [])
          break
      }
    }

    window.addEventListener('message', handleMessage)

    // Safety timeout — surface an error if the frame never responds
    const timer = setTimeout(() => {
      setIsLoading((prev) => {
        if (prev) {
          setError('Artifact took too long to load.')
        }
        return false
      })
    }, READY_TIMEOUT_MS)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('message', handleMessage)
    }
  }, [src])

  // Reset state when src changes (new artifact / new version)
  useEffect(() => {
    setIsLoading(true)
    setError(null)
    setHeight(INITIAL_HEIGHT)
  }, [src])

  return (
    <div
      className={cn('relative w-full overflow-hidden rounded-md border border-border', className)}
      role="region"
      aria-label={title}
    >
      {/* Loading spinner */}
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-card">
          <div
            className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
            role="status"
            aria-label="Loading artifact"
          />
        </div>
      )}

      {/* Error overlay — shown instead of blank pane */}
      {error && !isLoading && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
        >
          <span className="font-semibold">Error:</span>
          <span className="font-mono">{error}</span>
        </div>
      )}

      {/* Sandboxed iframe — allow-scripts ONLY (no allow-same-origin) */}
      <iframe
        ref={iframeRef}
        src={src}
        title={title}
        // CRITICAL: sandbox must remain "allow-scripts" with NO other tokens.
        // Adding allow-same-origin would grant the frame access to parent cookies.
        sandbox="allow-scripts"
        style={{
          width: '100%',
          height: `${height}px`,
          border: 'none',
          display: error ? 'none' : 'block',
        }}
        aria-hidden={!!error}
      />
    </div>
  )
}
