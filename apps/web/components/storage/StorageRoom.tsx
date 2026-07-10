'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { FileSchema, SourceResponseSchema } from '@bramha/shared'
import type { FileDto, SourceResponse } from '@bramha/shared'
import { api } from '@/lib/api-client'
import { FileTree } from './FileTree'
import { FileGrid } from './FileGrid'
import { PreviewPane } from './PreviewPane'
import { ConnectSourceDialog } from './ConnectSourceDialog'
import { SourceList } from './SourceList'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Upload, PlugZap, Search } from 'lucide-react'

type Folder = 'uploads' | 'quarantine' | 'sources'

export function StorageRoom({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient()
  const [selectedFolder, setSelectedFolder] = useState<Folder>('uploads')
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [connectOpen, setConnectOpen] = useState(false)
  const [connectInitialTab, setConnectInitialTab] = useState<'upload' | 'github'>('upload')

  const { data: files = [], isLoading } = useQuery({
    queryKey: ['files', projectId],
    queryFn: () => api.get(`/projects/${projectId}/files`, z.array(FileSchema)),
    refetchInterval: (query) => {
      const data = query.state.data
      if (Array.isArray(data) && data.some((f: FileDto) => f.scanStatus === 'scanning')) return 5000
      return false
    },
  })

  const { data: sources = [] } = useQuery({
    queryKey: ['sources', projectId],
    queryFn: () => api.get(`/projects/${projectId}/sources`, z.array(SourceResponseSchema)),
    refetchInterval: (query) => {
      const data = query.state.data
      if (Array.isArray(data) && data.some((s: SourceResponse) => s.lastSyncStatus === 'running')) return 5000
      return false
    },
  })

  const selectedFile = files.find((f) => f.id === selectedFileId) ?? null

  const handleFolderChange = (folder: Folder) => {
    setSelectedFolder(folder)
    if (folder === 'sources') {
      setSelectedFileId(null)
      return
    }
    if (selectedFile) {
      const isQuarantined = selectedFile.scanStatus === 'quarantined'
      if (folder === 'quarantine' && !isQuarantined) setSelectedFileId(null)
      if (folder === 'uploads' && isQuarantined) setSelectedFileId(null)
    }
  }

  const uploadsCount = files.filter(f => f.scanStatus !== 'quarantined').length
  const quarantineCount = files.filter(f => f.scanStatus === 'quarantined').length

  const folderLabel =
    selectedFolder === 'uploads' ? 'Uploads' :
    selectedFolder === 'quarantine' ? 'Quarantine' :
    'Connected Sources'

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <header className="flex items-center gap-3 border-b bg-card px-4 py-3">
        <h1 className="text-sm font-semibold text-foreground">Storage Room</h1>
        <nav aria-label="Storage breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
          <span aria-hidden="true">/</span>
          <span>{folderLabel}</span>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {selectedFolder !== 'sources' && (
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search files…"
                className="h-8 pl-7 text-xs w-48"
                aria-label="Search files"
              />
            </div>
          )}
          <Button size="sm" onClick={() => { setConnectInitialTab('upload'); setConnectOpen(true) }} variant="default" className="h-8 gap-1.5 text-xs">
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            Upload
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => { setConnectInitialTab('github'); setConnectOpen(true) }} aria-label="Connect source">
            <PlugZap className="h-3.5 w-3.5" aria-hidden="true" />
            Connect
          </Button>
        </div>
      </header>

      {/* Three-panel body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: FileTree */}
        <aside className="w-60 shrink-0 border-r overflow-y-auto">
          <FileTree
            selectedFolder={selectedFolder}
            onSelectFolder={handleFolderChange}
            uploadsCount={uploadsCount}
            quarantineCount={quarantineCount}
            sourcesCount={sources.length}
          />
        </aside>

        {/* Center: FileGrid or SourceList */}
        <main className="flex-1 overflow-y-auto">
          {selectedFolder === 'sources' ? (
            <div className="p-4">
              <h2 className="sr-only">Connected Sources</h2>
              <SourceList projectId={projectId} />
            </div>
          ) : (
            <FileGrid
              files={files}
              folder={selectedFolder}
              searchQuery={searchQuery}
              selectedFileId={selectedFileId}
              isLoading={isLoading}
              onSelectFile={setSelectedFileId}
            />
          )}
        </main>

        {/* Right: PreviewPane (only when file selected and not in sources view) */}
        {selectedFileId && selectedFile && selectedFolder !== 'sources' && (
          <aside className="w-80 shrink-0 border-l overflow-y-auto">
            <PreviewPane
              file={selectedFile}
              projectId={projectId}
              onClose={() => setSelectedFileId(null)}
            />
          </aside>
        )}
      </div>

      <ConnectSourceDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        projectId={projectId}
        initialTab={connectInitialTab}
        onSourceConnected={() => {
          void queryClient.invalidateQueries({ queryKey: ['sources', projectId] })
        }}
      />
    </div>
  )
}
