'use client'

/**
 * ArtifactPane — slide-in side panel for viewing project artifacts.
 *
 * Renders alongside the conference room chat layout (slide from right, 200ms
 * CSS transition). Shows tabs for each artifact; active tab renders:
 *   - ArtifactFrame (iframe) for react / html / svg kinds
 *   - Syntax-highlighted <pre><code> block for code / markdown / mermaid / csv
 *
 * Data flow:
 *   1. Fetch artifact list via TanStack Query
 *   2. On artifact selection: fetch versions
 *   3. Fetch render-token → presigned URL (combined query)
 *   4. Build iframe src  OR  fetch raw content for code display
 */

import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import {
  Code,
  Layers,
  Globe,
  FileText,
  Image,
  Share2,
  Table,
  X,
  Copy,
  Download,
} from 'lucide-react'
import { api } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ArtifactFrame } from './ArtifactFrame'
import { VersionSwitcher } from './VersionSwitcher'
import type { ArtifactVersion } from './VersionSwitcher'

// ── Zod schemas ────────────────────────────────────────────────────────────────

const ArtifactKindSchema = z.enum([
  'code',
  'react',
  'html',
  'document',
  'markdown',
  'svg',
  'mermaid',
  'csv',
])
type ArtifactKind = z.infer<typeof ArtifactKindSchema>

const ArtifactSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  conversationId: z.string().nullable(),
  kind: ArtifactKindSchema,
  title: z.string(),
  currentVersion: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
type Artifact = z.infer<typeof ArtifactSchema>

const ArtifactVersionSchema = z.object({
  artifactId: z.string(),
  version: z.number(),
  contentKey: z.string(),
  contentSha256: z.string(),
  sizeBytes: z.number(),
  createdAt: z.string(),
})

const RenderTokenSchema = z.object({ token: z.string() })
const PresignedUrlSchema = z.object({ url: z.string() })

// ── Constants ──────────────────────────────────────────────────────────────────

/** Kinds rendered in an iframe (react/html/svg) vs displayed inline as text */
const FRAME_KINDS = new Set<ArtifactKind>(['react', 'html', 'svg'])

// Lucide icon per kind
const KIND_ICONS: Record<ArtifactKind, React.ElementType> = {
  code: Code,
  react: Layers,
  html: Globe,
  document: FileText,
  markdown: FileText,
  svg: Image,
  mermaid: Share2,
  csv: Table,
}

// ── Props ──────────────────────────────────────────────────────────────────────

export interface ArtifactPaneProps {
  projectId: string
  conversationId: string | null
  isOpen: boolean
  onClose: () => void
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function KindIcon({ kind, className }: { kind: ArtifactKind; className?: string }) {
  const Icon = KIND_ICONS[kind] ?? Code
  return <Icon className={cn('h-3.5 w-3.5', className)} aria-hidden />
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
      <Layers className="h-8 w-8 opacity-30" aria-hidden />
      <p>No artifacts yet.</p>
      <p className="text-xs opacity-70">AI-generated code, documents, and charts appear here.</p>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ArtifactPane({ projectId, conversationId, isOpen, onClose }: ArtifactPaneProps) {
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null)
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)

  // ── 1. Fetch artifact list ─────────────────────────────────────────────────

  const queryString = conversationId
    ? `?conversationId=${encodeURIComponent(conversationId)}`
    : ''

  const { data: artifacts = [], isLoading: artifactsLoading } = useQuery({
    queryKey: ['artifacts', projectId, conversationId],
    queryFn: () =>
      api.get(`/projects/${projectId}/artifacts${queryString}`, z.array(ArtifactSchema)),
    enabled: isOpen,
    staleTime: 30_000,
    select: (data) => {
      // Auto-select first artifact when list loads and nothing is selected
      return data
    },
  })

  // Derive active artifact (auto-select first on load)
  const activeId = activeArtifactId ?? artifacts[0]?.id ?? null
  const activeArtifact: Artifact | undefined = artifacts.find((a) => a.id === activeId)

  // ── 2. Fetch versions ──────────────────────────────────────────────────────

  const { data: versions = [] } = useQuery<ArtifactVersion[]>({
    queryKey: ['artifact-versions', projectId, activeId],
    queryFn: () =>
      api.get(
        `/projects/${projectId}/artifacts/${activeId}/versions`,
        z.array(ArtifactVersionSchema),
      ),
    enabled: !!activeId && isOpen,
    staleTime: 60_000,
  })

  // Derive selected version (auto-select currentVersion from artifact)
  const currentVersionNum = selectedVersion ?? activeArtifact?.currentVersion ?? null

  // ── 3. Fetch presigned URL (render-token → url) ───────────────────────────

  const { data: presignedUrl } = useQuery({
    queryKey: ['artifact-render-url', projectId, activeId, currentVersionNum],
    queryFn: async () => {
      const base = `/projects/${projectId}/artifacts/${activeId}/versions/${currentVersionNum}`
      const { token } = await api.get(`${base}/render-token`, RenderTokenSchema)
      const { url } = await api.get(`${base}/url?token=${encodeURIComponent(token)}`, PresignedUrlSchema)
      return url
    },
    enabled: !!activeId && currentVersionNum != null && isOpen,
    staleTime: 5 * 60_000, // presigned URLs last 15min; cache for 5
    gcTime: 6 * 60_000,
  })

  // ── 4. Fetch raw content (for code-kind inline display + copy/download) ───

  const isCodeKind =
    activeArtifact != null && !FRAME_KINDS.has(activeArtifact.kind)

  const { data: rawContent } = useQuery({
    queryKey: ['artifact-content', presignedUrl],
    queryFn: () => fetch(presignedUrl!).then((r) => r.text()),
    enabled: !!presignedUrl && isCodeKind,
    staleTime: 5 * 60_000,
    gcTime: 6 * 60_000,
  })

  // ── Build iframe src ───────────────────────────────────────────────────────

  const artifactOrigin = process.env.NEXT_PUBLIC_ARTIFACT_ORIGIN ?? ''
  const frameSrc =
    presignedUrl && activeArtifact
      ? `${artifactOrigin}/artifact-frame?url=${encodeURIComponent(presignedUrl)}&kind=${activeArtifact.kind}`
      : null

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleVersionSwitch = useCallback(
    (v: number) => {
      setSelectedVersion(v)
    },
    [],
  )

  const handleArtifactTab = useCallback((id: string) => {
    setActiveArtifactId(id)
    setSelectedVersion(null) // reset to currentVersion of new artifact
  }, [])

  const handleCopy = useCallback(async () => {
    const text =
      rawContent ??
      (presignedUrl ? await fetch(presignedUrl).then((r) => r.text()) : null)
    if (text != null) {
      await navigator.clipboard.writeText(text).catch(() => undefined)
    }
  }, [rawContent, presignedUrl])

  const handleDownload = useCallback(async () => {
    const text =
      rawContent ??
      (presignedUrl ? await fetch(presignedUrl).then((r) => r.text()) : null)
    if (text == null || !activeArtifact) return
    const blob = new Blob([text], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${activeArtifact.title ?? 'artifact'}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  }, [rawContent, presignedUrl, activeArtifact])

  // ── Render ─────────────────────────────────────────────────────────────────

  // Visible tabs: max 5
  const visibleArtifacts = artifacts.slice(0, 5)

  return (
    <aside
      className={cn(
        // Layout: fixed side panel, full viewport height
        'fixed inset-y-0 right-0 z-40 flex w-[600px] max-w-[90vw] flex-col',
        'border-l border-border bg-card shadow-xl',
        // Slide-in transition
        'transform transition-transform duration-200 ease-in-out',
        isOpen ? 'translate-x-0' : 'translate-x-full',
      )}
      aria-label="Artifact viewer"
      aria-hidden={!isOpen}
      // Prevent keyboard focus when closed (boolean attr — presence means inert)
       
      // @ts-expect-error React types inert as boolean; empty string is the HTML idiom
      inert={!isOpen ? '' : undefined}
    >
      {/* ── Header ── */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <h2 className="text-sm font-semibold">Artifacts</h2>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onClose}
          aria-label="Close artifact pane"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      {/* ── Tab strip ── */}
      {artifacts.length > 0 && (
        <div
          role="tablist"
          aria-label="Artifact tabs"
          className="flex shrink-0 overflow-x-auto border-b border-border scrollbar-none"
        >
          {visibleArtifacts.map((artifact) => (
            <button
              key={artifact.id}
              role="tab"
              aria-selected={artifact.id === activeId}
              aria-controls={`artifact-panel-${artifact.id}`}
              onClick={() => handleArtifactTab(artifact.id)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs transition-colors',
                'whitespace-nowrap border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                artifact.id === activeId
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <KindIcon kind={artifact.kind} />
              <span className="max-w-[120px] truncate">{artifact.title}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {artifactsLoading ? (
          // Loading skeleton
          <div className="flex flex-1 items-center justify-center">
            <div
              className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
              role="status"
              aria-label="Loading artifacts"
            />
          </div>
        ) : artifacts.length === 0 ? (
          <EmptyState />
        ) : activeArtifact ? (
          <div
            id={`artifact-panel-${activeArtifact.id}`}
            role="tabpanel"
            aria-label={activeArtifact.title}
            className="flex flex-1 flex-col overflow-y-auto"
          >
            {/* ── Toolbar ── */}
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
              <VersionSwitcher
                versions={versions}
                currentVersion={currentVersionNum ?? activeArtifact.currentVersion}
                onSwitch={handleVersionSwitch}
              />
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleCopy}
                  aria-label="Copy content"
                  disabled={!presignedUrl}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleDownload}
                  aria-label="Download artifact"
                  disabled={!presignedUrl}
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* ── Content area ── */}
            <div className="flex-1 p-4">
              {!presignedUrl ? (
                // Loading presigned URL
                <div className="flex h-32 items-center justify-center">
                  <div
                    className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
                    role="status"
                    aria-label="Loading artifact content"
                  />
                </div>
              ) : FRAME_KINDS.has(activeArtifact.kind) ? (
                // ── iframe renderer (react / html / svg) ──
                <ArtifactFrame
                  src={frameSrc!}
                  title={activeArtifact.title}
                  className="min-h-[200px]"
                />
              ) : (
                // ── Inline code renderer ──
                <div className="overflow-hidden rounded-md border border-border">
                  {rawContent == null ? (
                    <div className="flex h-32 items-center justify-center bg-muted/30">
                      <div
                        className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
                        role="status"
                        aria-label="Loading content"
                      />
                    </div>
                  ) : (
                    <pre
                      className="overflow-x-auto bg-[#0f172a] p-4 font-mono text-[13px] leading-relaxed text-slate-200"
                      aria-label={`${activeArtifact.kind} content`}
                    >
                      <code>{rawContent}</code>
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
