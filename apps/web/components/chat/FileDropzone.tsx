'use client'

import { useCallback, useRef, useState, useEffect } from 'react'

// ── Allowlists (mirror API) ───────────────────────────────────────────────────

const ALLOWED_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/webp',
  'audio/mpeg',
  'video/mp4',
  'application/zip',
])

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.docx', '.md', '.txt', '.csv', '.xlsx',
  '.png', '.jpg', '.jpeg', '.webp', '.mp3', '.mp4', '.zip',
])

const MAX_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB

// ── Types ─────────────────────────────────────────────────────────────────────

type FileStatus = 'preparing' | 'uploading' | 'scanning' | 'clean' | 'quarantined' | 'failed' | 'error'

interface FileEntry {
  localId: string
  fileId?: string
  file: File
  status: FileStatus
  progress: number
  error?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getExtension(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx === -1) return ''
  return name.slice(idx).toLowerCase()
}

function getFileIcon(mime: string): string {
  if (mime.startsWith('image/')) return '🖼️'
  if (mime.startsWith('video/')) return '🎬'
  if (mime.startsWith('audio/')) return '🎵'
  if (mime === 'application/pdf') return '📄'
  if (mime.includes('spreadsheet') || mime === 'text/csv') return '📊'
  if (mime.includes('wordprocessing')) return '📝'
  if (mime === 'application/zip') return '🗜️'
  return '📎'
}

// ── FileCard ──────────────────────────────────────────────────────────────────

interface FileCardProps {
  entry: FileEntry
  onRemove: (localId: string) => void
}

function FileCard({ entry, onRemove }: FileCardProps) {
  const { localId, file, status, progress, error } = entry

  const badgeClass: Record<FileStatus, string> = {
    preparing: 'bg-blue-500/20 text-blue-400',
    uploading: 'bg-blue-500/20 text-blue-400',
    scanning: 'bg-yellow-500/20 text-yellow-400',
    clean: 'bg-green-500/20 text-green-400',
    quarantined: 'bg-red-500/20 text-red-400',
    failed: 'bg-red-500/20 text-red-400',
    error: 'bg-red-500/20 text-red-400',
  }

  const badgeLabel: Record<FileStatus, string> = {
    preparing: 'Preparing',
    uploading: `Uploading ${progress}%`,
    scanning: 'Scanning',
    clean: 'Ready',
    quarantined: 'Quarantined',
    failed: 'Failed',
    error: error ?? 'Error',
  }

  const canRemove = status !== 'uploading'

  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
      <span className="text-xl leading-none" aria-hidden="true">
        {getFileIcon(file.type || '')}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground" title={file.name}>
          {file.name}
        </p>
        <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
        {status === 'uploading' && (
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass[status]}`}
      >
        {badgeLabel[status]}
      </span>

      {canRemove && (
        <button
          type="button"
          aria-label={`Remove ${file.name}`}
          onClick={() => onRemove(localId)}
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  )
}

// ── FileDropzone ───────────────────────────────────────────────────────────────

interface FileDropzoneProps {
  projectId: string
  roomId?: string
  onFileReady?: (fileId: string) => void
}

export function FileDropzone({ projectId, roomId, onFileReady }: FileDropzoneProps) {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const pollTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Cleanup all polling timers on unmount
  useEffect(() => {
    const timers = pollTimersRef.current
    return () => {
      timers.forEach((timer) => clearTimeout(timer))
    }
  }, [])

  const updateEntry = useCallback((localId: string, patch: Partial<FileEntry>) => {
    setEntries((prev) =>
      prev.map((e) => (e.localId === localId ? { ...e, ...patch } : e)),
    )
  }, [])

  const startPolling = useCallback(
    (localId: string, fileId: string) => {
      const poll = async () => {
        try {
          const res = await fetch(`/api/projects/${projectId}/files/${fileId}`)
          if (!res.ok) {
            updateEntry(localId, { status: 'error', error: 'Poll failed' })
            return
          }
          const data = (await res.json()) as { scanStatus: string }
          const scanStatus = data.scanStatus as FileStatus

          if (scanStatus === 'clean' || scanStatus === 'quarantined' || scanStatus === 'failed') {
            updateEntry(localId, { status: scanStatus })
            pollTimersRef.current.delete(localId)
            if (scanStatus === 'clean') {
              onFileReady?.(fileId)
            }
          } else {
            // Still pending or scanning — poll again after 3s
            const timer = setTimeout(poll, 3000)
            pollTimersRef.current.set(localId, timer)
          }
        } catch {
          updateEntry(localId, { status: 'error', error: 'Network error during scan poll' })
        }
      }

      const timer = setTimeout(poll, 3000)
      pollTimersRef.current.set(localId, timer)
    },
    [projectId, onFileReady, updateEntry],
  )

  const uploadFile = useCallback(
    async (file: File, localId: string) => {
      // 1. POST /api/projects/:projectId/files/initiate
      let fileId: string
      let uploadUrl: string
      try {
        const initRes = await fetch(`/api/projects/${projectId}/files/initiate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: file.name,
            declaredMime: file.type || 'application/octet-stream',
            sizeBytes: file.size,
            ...(roomId ? { roomId } : {}),
          }),
        })
        if (!initRes.ok) {
          const err = (await initRes.json().catch(() => ({}))) as { code?: string }
          updateEntry(localId, {
            status: 'error',
            error: err.code ?? `Initiate failed (${initRes.status})`,
          })
          return
        }
        const data = (await initRes.json()) as { fileId: string; uploadUrl: string }
        fileId = data.fileId
        uploadUrl = data.uploadUrl
      } catch {
        updateEntry(localId, { status: 'error', error: 'Network error during initiate' })
        return
      }

      // Update entry with fileId
      updateEntry(localId, { fileId, status: 'uploading', progress: 0 })

      // 2. PUT to presigned URL with XHR for progress
      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 100)
              updateEntry(localId, { progress: pct })
            }
          })
          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve()
            else reject(new Error(`Upload failed: ${xhr.status}`))
          })
          xhr.addEventListener('error', () => reject(new Error('Network error')))
          xhr.open('PUT', uploadUrl)
          xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
          xhr.send(file)
        })
      } catch (err) {
        updateEntry(localId, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Upload failed',
        })
        return
      }

      // 3. POST confirm
      try {
        const confirmRes = await fetch(
          `/api/projects/${projectId}/files/${fileId}/confirm`,
          { method: 'POST' },
        )
        if (!confirmRes.ok) {
          updateEntry(localId, { status: 'error', error: `Confirm failed (${confirmRes.status})` })
          return
        }
      } catch {
        updateEntry(localId, { status: 'error', error: 'Network error during confirm' })
        return
      }

      // 4. Poll for scan status
      updateEntry(localId, { status: 'scanning', progress: 100 })
      startPolling(localId, fileId)
    },
    [projectId, roomId, updateEntry, startPolling],
  )

  const handleFiles = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList)
      for (const file of files) {
        // Client-side validation
        const ext = getExtension(file.name)
        const mime = file.type || 'application/octet-stream'

        if (!ALLOWED_MIMES.has(mime)) {
          const localId = crypto.randomUUID()
          setEntries((prev) => [
            ...prev,
            { localId, file, status: 'error', progress: 0, error: `MIME type not allowed: ${mime}` },
          ])
          continue
        }
        if (!ALLOWED_EXTENSIONS.has(ext)) {
          const localId = crypto.randomUUID()
          setEntries((prev) => [
            ...prev,
            { localId, file, status: 'error', progress: 0, error: `Extension not allowed: ${ext || 'none'}` },
          ])
          continue
        }
        if (file.size > MAX_SIZE_BYTES) {
          const localId = crypto.randomUUID()
          setEntries((prev) => [
            ...prev,
            { localId, file, status: 'error', progress: 0, error: 'File exceeds 50 MB limit' },
          ])
          continue
        }

        const localId = crypto.randomUUID()
        setEntries((prev) => [
          ...prev,
          { localId, file, status: 'preparing', progress: 0 },
        ])
        void uploadFile(file, localId)
      }
    },
    [uploadFile],
  )

  const handleRemove = useCallback((localId: string) => {
    // Cancel any pending poll timer
    const timer = pollTimersRef.current.get(localId)
    if (timer !== undefined) {
      clearTimeout(timer)
      pollTimersRef.current.delete(localId)
    }
    setEntries((prev) => prev.filter((e) => e.localId !== localId))
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragOver(false)
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files)
      }
    },
    [handleFiles],
  )

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleClick = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFiles(e.target.files)
        // Reset input so the same file can be re-selected
        e.target.value = ''
      }
    },
    [handleFiles],
  )

  return (
    <div className="flex flex-col gap-2">
      {/* Dropzone area */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload files — click or drag and drop"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleClick()
          }
        }}
        className={[
          'border-2 border-dashed rounded-xl p-4 cursor-pointer transition-colors',
          'flex flex-col items-center justify-center gap-1 text-center select-none',
          'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1',
          isDragOver
            ? 'border-primary/70 bg-primary/5 text-primary'
            : 'border-border/50 text-muted-foreground hover:border-primary/50 hover:text-foreground',
        ].join(' ')}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <p className="text-sm font-medium">
          {isDragOver ? 'Drop files here' : 'Click or drag files to upload'}
        </p>
        <p className="text-xs opacity-70">
          PDF, DOCX, MD, TXT, CSV, XLSX, PNG, JPG, MP3, MP4, ZIP — up to 50 MB
        </p>
      </div>

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={Array.from(ALLOWED_EXTENSIONS).join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleInputChange}
      />

      {/* File cards */}
      {entries.length > 0 && (
        <div className="flex flex-col gap-2" role="list" aria-label="Uploaded files">
          {entries.map((entry) => (
            <div key={entry.localId} role="listitem">
              <FileCard entry={entry} onRemove={handleRemove} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
