import { cn } from '@/lib/utils'
import type { FileDto } from '@bramha/shared'
import { Skeleton } from '@/components/ui/skeleton'
import { FileText, Image, Video, Music, FileSpreadsheet, Archive, File } from 'lucide-react'

type FolderType = 'uploads' | 'quarantine'

interface FileGridProps {
  files: FileDto[]
  folder: FolderType
  searchQuery: string
  selectedFileId: string | null
  isLoading: boolean
  onSelectFile: (id: string) => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function getMimeIcon(mime: string) {
  if (mime.startsWith('image/')) return <Image className="h-8 w-8" aria-hidden="true" />
  if (mime.startsWith('video/')) return <Video className="h-8 w-8" aria-hidden="true" />
  if (mime.startsWith('audio/')) return <Music className="h-8 w-8" aria-hidden="true" />
  if (mime === 'application/pdf') return <FileText className="h-8 w-8" aria-hidden="true" />
  if (mime.includes('spreadsheet') || mime === 'text/csv') return <FileSpreadsheet className="h-8 w-8" aria-hidden="true" />
  if (mime === 'application/zip') return <Archive className="h-8 w-8" aria-hidden="true" />
  return <File className="h-8 w-8" aria-hidden="true" />
}

type ScanBadgeConfig = { label: string; className: string; pulse?: boolean }

function getScanBadgeConfig(status: FileDto['scanStatus']): ScanBadgeConfig {
  switch (status) {
    case 'scanning': return { label: 'Scanning', className: 'bg-amber-500/20 text-amber-400', pulse: true }
    case 'clean': return { label: 'Ready', className: 'bg-green-500/20 text-green-400' }
    case 'quarantined': return { label: 'Quarantined', className: 'bg-red-500/20 text-red-400' }
    case 'failed': return { label: 'Failed', className: 'bg-red-500/20 text-red-400' }
    default: return { label: 'Pending', className: 'bg-zinc-500/20 text-zinc-400' }
  }
}

function ScanBadge({ status }: { status: FileDto['scanStatus'] }) {
  const { label, className, pulse } = getScanBadgeConfig(status)
  return (
    <span
      role="status"
      aria-label={`Scan status: ${label}`}
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', className)}
    >
      {pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" aria-hidden="true" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />
        </span>
      )}
      {label}
    </span>
  )
}

export function FileGrid({ files, folder, searchQuery, selectedFileId, isLoading, onSelectFile }: FileGridProps) {
  if (isLoading) {
    return (
      <div className="p-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Loading files" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-lg" />
        ))}
      </div>
    )
  }

  // Filter by folder
  const folderFiles = folder === 'quarantine'
    ? files.filter(f => f.scanStatus === 'quarantined')
    : files.filter(f => f.scanStatus !== 'quarantined')

  // Filter by search
  const q = searchQuery.trim().toLowerCase()
  const filtered = q ? folderFiles.filter(f => f.name.toLowerCase().includes(q)) : folderFiles

  if (filtered.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            {q ? 'No files match your search' : folder === 'quarantine' ? 'No quarantined files' : 'No files yet'}
          </p>
          <p className="text-xs text-muted-foreground">
            {!q && folder === 'uploads' && 'Upload files using the Upload button above.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="p-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
      role="list"
      aria-label={`${folder === 'quarantine' ? 'Quarantined' : 'Uploaded'} files`}
    >
      {filtered.map((file) => {
        const isQuarantined = file.scanStatus === 'quarantined'
        const isSelected = file.id === selectedFileId
        return (
          <article
            key={file.id}
            role="listitem"
            aria-label={file.name}
          >
            <button
              type="button"
              onClick={() => onSelectFile(file.id)}
              aria-pressed={isSelected}
              className={cn(
                'w-full rounded-lg border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary',
                isSelected
                  ? 'border-primary bg-primary/5'
                  : isQuarantined
                    ? 'border-red-500/50 bg-red-500/5 hover:bg-red-500/10'
                    : 'border-border bg-card hover:bg-accent/30',
              )}
            >
              <div className="mb-2 text-muted-foreground">
                {getMimeIcon(file.declaredMime)}
              </div>
              <p className="truncate text-xs font-medium text-foreground" title={file.name}>
                {file.name}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{formatBytes(file.sizeBytes)}</p>

              {/* Origin room chip */}
              <p className="mt-0.5 text-xs text-muted-foreground truncate">
                {file.roomId ? (
                  <span className="rounded bg-muted px-1 py-0.5 text-xs" aria-label="Origin room">Room</span>
                ) : (
                  <span className="text-muted-foreground/60">Direct upload</span>
                )}
              </p>

              <div className="mt-2 flex items-center justify-between">
                <ScanBadge status={file.scanStatus} />
                <span className="text-xs text-muted-foreground">{formatRelative(file.createdAt)}</span>
              </div>
            </button>
          </article>
        )
      })}
    </div>
  )
}
