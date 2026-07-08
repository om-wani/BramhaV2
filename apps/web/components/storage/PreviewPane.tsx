'use client'

import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { api } from '@/lib/api-client'
import type { FileDto } from '@bramha/shared'
import { X, Download, ExternalLink, AlertTriangle, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'

const DownloadUrlSchema = z.object({ url: z.string() })

const MAX_TEXT_DISPLAY = 50 * 1024 // 50KB
const MAX_CSV_ROWS = 10000
const MAX_PREVIEW_BYTES = 1024 * 1024 // 1MB — enough for ~10k typical CSV rows

interface PreviewPaneProps {
  file: FileDto
  projectId: string
  onClose: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function parseCsvRow(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ } // escaped quote
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      cells.push(current); current = ''
    } else {
      current += ch
    }
  }
  cells.push(current)
  return cells
}

function CsvTable({ text }: { text: string }) {
  const rows = text.split('\n').slice(0, MAX_CSV_ROWS).filter(Boolean)
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">Empty CSV</p>
  const parsed = rows.map(r => parseCsvRow(r))
  const [header, ...body] = parsed
  return (
    <div className="overflow-auto max-h-96">
      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-0 bg-card">
          <tr>
            {header?.map((h, i) => (
              <th key={i} className="border border-border px-2 py-1 text-left font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri} className="odd:bg-muted/20">
              {row.map((cell, ci) => (
                <td key={ci} className="border border-border px-2 py-1">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TextPreview({ url, isMd }: { url: string; isMd: boolean }) {
  const [content, setContent] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [fetchError, setFetchError] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(url)
      .then(r => r.text())
      .then(text => {
        if (cancelled) return
        if (text.length > MAX_TEXT_DISPLAY) {
          setContent(text.slice(0, MAX_TEXT_DISPLAY))
          setTruncated(true)
        } else {
          setContent(text)
        }
      })
      .catch(() => {
        if (!cancelled) setFetchError(true)
      })
    return () => { cancelled = true }
  }, [url])

  if (fetchError) return <p className="text-xs text-muted-foreground">Failed to load text preview</p>
  if (content === null) return <p className="text-xs text-muted-foreground">Loading…</p>

  return (
    <div>
      {truncated && (
        <p className="mb-2 text-xs text-amber-400">Showing first 50 KB only</p>
      )}
      {isMd ? (
        <div className="prose prose-sm prose-invert max-w-none">
          <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{content}</ReactMarkdown>
        </div>
      ) : (
        <pre className="overflow-auto max-h-96 text-xs text-foreground whitespace-pre-wrap break-words">{content}</pre>
      )}
    </div>
  )
}

function CsvPreview({ url }: { url: string }) {
  const [content, setContent] = useState<string | null>(null)
  const [fetchError, setFetchError] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(url, { headers: { Range: `bytes=0-${MAX_PREVIEW_BYTES - 1}` } })
      .then(r => {
        if (!r.ok && r.status !== 206) throw new Error('fetch failed')
        return r.text()
      })
      .then(text => {
        if (!cancelled) setContent(text)
      })
      .catch(() => {
        if (!cancelled) setFetchError(true)
      })
    return () => { cancelled = true }
  }, [url])

  if (fetchError) return <p className="text-xs text-muted-foreground">Failed to load CSV preview</p>
  if (content === null) return <p className="text-xs text-muted-foreground">Loading CSV…</p>
  return <CsvTable text={content} />
}

function FilePreview({ file, url }: { file: FileDto; url: string }) {
  const mime = file.detectedMime ?? file.declaredMime
  const isMd = file.name.endsWith('.md') || mime === 'text/markdown'
  const isCsv = mime === 'text/csv'
  const isXlsx = mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

  if (mime === 'application/pdf') {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">PDF Preview</p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            aria-label="Open PDF in new tab"
          >
            Open <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
        <iframe
          src={url}
          title={`PDF preview: ${file.name}`}
          sandbox="allow-same-origin"
          className="w-full h-96 rounded border border-border"
        />
      </div>
    )
  }

  if (mime.startsWith('image/')) {
    return (
      <img
        src={url}
        alt={file.name}
        className="max-h-96 w-full object-contain rounded border border-border"
      />
    )
  }

  if (mime.startsWith('video/')) {
    return (
      <video controls src={url} className="w-full max-h-64 rounded border border-border" />
    )
  }

  if (mime.startsWith('audio/')) {
    return (
      <audio controls src={url} className="w-full" />
    )
  }

  if (isCsv) {
    return <CsvPreview url={url} />
  }

  if (isXlsx) {
    return (
      <p className="text-xs text-muted-foreground">Preview not available for Excel files. Download to view.</p>
    )
  }

  if (mime.startsWith('text/') || isMd) {
    return <TextPreview url={url} isMd={isMd} />
  }

  return (
    <p className="text-xs text-muted-foreground">Preview not available for this file type. Download to view.</p>
  )
}

export function PreviewPane({ file, projectId, onClose }: PreviewPaneProps) {
  const isQuarantined = file.scanStatus === 'quarantined'
  const isClean = file.scanStatus === 'clean'

  const { data: downloadUrlData } = useQuery({
    queryKey: ['download-url', projectId, file.id],
    queryFn: () => api.get(`/projects/${projectId}/files/${file.id}/download-url`, DownloadUrlSchema),
    enabled: isClean,
    staleTime: 10 * 60 * 1000, // 10 min (URL is 15 min TTL)
    gcTime: 15 * 60 * 1000,
  })

  const downloadUrl = downloadUrlData?.url ?? null

  return (
    <div className="flex flex-col h-full">
      {/* Pane header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-medium text-foreground truncate flex-1 mr-2" title={file.name}>
          {file.name}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="rounded p-1 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Quarantine alert — shown instead of preview */}
        {isQuarantined && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-red-500/50 bg-red-500/10 p-3"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-red-400">File quarantined</p>
              <p className="text-xs text-red-400/80 mt-0.5">
                This file was quarantined and cannot be previewed or downloaded.
              </p>
            </div>
          </div>
        )}

        {/* File preview (only for clean files) */}
        {isClean && downloadUrl && (
          <section aria-label="File preview">
            <FilePreview file={file} url={downloadUrl} />
          </section>
        )}

        {/* Metadata */}
        <section aria-label="File metadata">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Details</h3>
          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Type</dt>
              <dd className="text-foreground font-mono">{file.detectedMime ?? file.declaredMime}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Size</dt>
              <dd className="text-foreground">{formatBytes(file.sizeBytes)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Uploaded</dt>
              <dd className="text-foreground">{formatDate(file.createdAt)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Origin</dt>
              <dd className="text-foreground">{file.roomId ? 'From room' : 'Direct upload'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Status</dt>
              <dd className={cn(
                'font-medium',
                file.scanStatus === 'clean' ? 'text-green-400' :
                file.scanStatus === 'quarantined' ? 'text-red-400' :
                file.scanStatus === 'scanning' ? 'text-amber-400' :
                'text-muted-foreground'
              )}>
                {file.scanStatus === 'clean' ? 'Indexed' : file.scanStatus.charAt(0).toUpperCase() + file.scanStatus.slice(1)}
              </dd>
            </div>
          </dl>
        </section>

        {/* Actions */}
        {!isQuarantined && (
          <section aria-label="File actions" className="space-y-2">
            {isClean && downloadUrl && (
              <a
                href={downloadUrl}
                download={file.name}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                aria-label={`Download ${file.name}`}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Download
              </a>
            )}
            <a
              href={`/p/${projectId}/conference?fileRef=${file.id}`}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
              aria-label="Ask about this file in conference"
            >
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
              Ask about this file
            </a>
          </section>
        )}
      </div>
    </div>
  )
}
