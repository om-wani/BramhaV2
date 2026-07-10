'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { FileDropzone } from '@/components/chat/FileDropzone'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api-client'
import { SourceResponseSchema } from '@bramha/shared'

type Tab = 'upload' | 'github' | 'gitlab' | 'sql' | 'url'

const TABS: { id: Tab; label: string }[] = [
  { id: 'upload', label: 'Manual Upload' },
  { id: 'github', label: 'GitHub' },
  { id: 'gitlab', label: 'GitLab' },
  { id: 'sql', label: 'SQL Database' },
  { id: 'url', label: 'URL' },
]

// ── Source connector forms ─────────────────────────────────────────────────────

interface GitFormData {
  repoUrl: string
  branch: string
  credential: string
}

function GitHubForm({
  projectId,
  isGitLab,
  onSuccess,
}: {
  projectId: string
  isGitLab: boolean
  onSuccess: () => void
}) {
  const [form, setForm] = useState<GitFormData>({ repoUrl: '', branch: 'main', credential: '' })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function update(key: keyof GitFormData, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await api.post(`/projects/${projectId}/sources`, SourceResponseSchema, {
        type: isGitLab ? 'gitlab_repo' : 'github_repo',
        config: { repoUrl: form.repoUrl, branch: form.branch || 'main' },
        credential: form.credential || undefined,
      })
      // Clear credential from state immediately after submission
      setForm({ repoUrl: '', branch: 'main', credential: '' })
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect source')
    } finally {
      setSubmitting(false)
    }
  }

  const urlPlaceholder = isGitLab ? 'https://gitlab.com/org/repo' : 'https://github.com/org/repo'
  const tokenPlaceholder = isGitLab ? 'glpat-…' : 'ghp_…'
  const tokenLabel = isGitLab ? 'Access Token' : 'Personal Access Token'

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1">
        <label htmlFor="repoUrl" className="text-xs font-medium text-muted-foreground">
          Repository URL <span aria-hidden="true" className="text-destructive">*</span>
        </label>
        <input
          id="repoUrl"
          type="url"
          required
          placeholder={urlPlaceholder}
          value={form.repoUrl}
          onChange={(e) => update('repoUrl', e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="branch" className="text-xs font-medium text-muted-foreground">Branch</label>
        <input
          id="branch"
          type="text"
          placeholder="main"
          value={form.branch}
          onChange={(e) => update('branch', e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="credential" className="text-xs font-medium text-muted-foreground">
          {tokenLabel} <span className="text-muted-foreground/60">(optional for public repos)</span>
        </label>
        <input
          id="credential"
          type="password"
          placeholder={tokenPlaceholder}
          value={form.credential}
          autoComplete="new-password"
          onChange={(e) => update('credential', e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <button
        type="submit"
        disabled={submitting || !form.repoUrl}
        className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'Connecting…' : 'Connect Repository'}
      </button>
    </form>
  )
}

interface SqlFormData {
  host: string
  port: string
  database: string
  username: string
  credential: string
}

function SqlForm({ projectId, onSuccess }: { projectId: string; onSuccess: () => void }) {
  const [form, setForm] = useState<SqlFormData>({ host: '', port: '5432', database: '', username: '', credential: '' })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function update(key: keyof SqlFormData, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await api.post(`/projects/${projectId}/sources`, SourceResponseSchema, {
        type: 'sql_database',
        config: {
          host: form.host,
          port: form.port ? parseInt(form.port, 10) : undefined,
          database: form.database,
          username: form.username,
        },
        credential: form.credential || undefined,
      })
      setForm({ host: '', port: '5432', database: '', username: '', credential: '' })
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect database')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2 space-y-1">
          <label htmlFor="sqlHost" className="text-xs font-medium text-muted-foreground">
            Host <span aria-hidden="true" className="text-destructive">*</span>
          </label>
          <input
            id="sqlHost"
            type="text"
            required
            placeholder="db.example.com"
            value={form.host}
            onChange={(e) => update('host', e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="sqlPort" className="text-xs font-medium text-muted-foreground">Port</label>
          <input
            id="sqlPort"
            type="number"
            placeholder="5432"
            value={form.port}
            onChange={(e) => update('port', e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor="sqlDatabase" className="text-xs font-medium text-muted-foreground">
          Database <span aria-hidden="true" className="text-destructive">*</span>
        </label>
        <input
          id="sqlDatabase"
          type="text"
          required
          placeholder="mydb"
          value={form.database}
          onChange={(e) => update('database', e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="sqlUsername" className="text-xs font-medium text-muted-foreground">
          Username <span aria-hidden="true" className="text-destructive">*</span>
        </label>
        <input
          id="sqlUsername"
          type="text"
          required
          placeholder="readonly_user"
          value={form.username}
          autoComplete="username"
          onChange={(e) => update('username', e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="sqlPassword" className="text-xs font-medium text-muted-foreground">Password</label>
        <input
          id="sqlPassword"
          type="password"
          placeholder="••••••••"
          value={form.credential}
          autoComplete="new-password"
          onChange={(e) => update('credential', e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <button
        type="submit"
        disabled={submitting || !form.host || !form.database || !form.username}
        className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'Connecting…' : 'Connect Database'}
      </button>
    </form>
  )
}

interface UrlFormData {
  rootUrl: string
  maxDepth: string
  maxPages: string
}

function UrlForm({ projectId, onSuccess }: { projectId: string; onSuccess: () => void }) {
  const [form, setForm] = useState<UrlFormData>({ rootUrl: '', maxDepth: '2', maxPages: '50' })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function update(key: keyof UrlFormData, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await api.post(`/projects/${projectId}/sources`, SourceResponseSchema, {
        type: 'url',
        config: {
          rootUrl: form.rootUrl,
          maxDepth: form.maxDepth ? parseInt(form.maxDepth, 10) : 2,
          maxPages: form.maxPages ? parseInt(form.maxPages, 10) : 50,
        },
      })
      setForm({ rootUrl: '', maxDepth: '2', maxPages: '50' })
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect URL')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1">
        <label htmlFor="rootUrl" className="text-xs font-medium text-muted-foreground">
          Root URL <span aria-hidden="true" className="text-destructive">*</span>
        </label>
        <input
          id="rootUrl"
          type="url"
          required
          placeholder="https://docs.example.com"
          value={form.rootUrl}
          onChange={(e) => update('rootUrl', e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label htmlFor="maxDepth" className="text-xs font-medium text-muted-foreground">Max depth (1–3)</label>
          <input
            id="maxDepth"
            type="number"
            min={1}
            max={3}
            value={form.maxDepth}
            onChange={(e) => update('maxDepth', e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="maxPages" className="text-xs font-medium text-muted-foreground">Max pages (1–200)</label>
          <input
            id="maxPages"
            type="number"
            min={1}
            max={200}
            value={form.maxPages}
            onChange={(e) => update('maxPages', e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <button
        type="submit"
        disabled={submitting || !form.rootUrl}
        className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'Connecting…' : 'Connect URL'}
      </button>
    </form>
  )
}

// ── Dialog ─────────────────────────────────────────────────────────────────────

interface ConnectSourceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  initialTab?: Tab
  onSourceConnected?: () => void
}

export function ConnectSourceDialog({
  open,
  onOpenChange,
  projectId,
  initialTab,
  onSourceConnected,
}: ConnectSourceDialogProps) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? 'upload')
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Reset to initialTab whenever the dialog opens
  useEffect(() => {
    if (open) {
      setActiveTab(initialTab ?? 'upload')
      setSuccessMsg(null)
    }
  }, [open, initialTab])

  function handleSuccess() {
    setSuccessMsg('Source connected! Sync started in the background.')
    onSourceConnected?.()
    setTimeout(() => onOpenChange(false), 1500)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card shadow-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b px-6 py-4">
            <Dialog.Title className="text-sm font-semibold text-foreground">
              Add Files or Connect a Source
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close dialog"
                className="rounded p-1 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          {/* Tab bar */}
          <div className="flex border-b px-6" role="tablist" aria-label="Source type">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                type="button"
                aria-selected={activeTab === tab.id}
                aria-controls={`panel-${tab.id}`}
                onClick={() => { setActiveTab(tab.id); setSuccessMsg(null) }}
                className={cn(
                  'border-b-2 px-3 py-3 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary',
                  activeTab === tab.id
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab panels */}
          <div className="p-6" id={`panel-${activeTab}`} role="tabpanel" aria-label={`${activeTab} panel`}>
            {successMsg && (
              <div role="status" className="mb-4 rounded-md bg-primary/10 px-4 py-2 text-sm text-primary">
                {successMsg}
              </div>
            )}
            {activeTab === 'upload' && <FileDropzone projectId={projectId} />}
            {activeTab === 'github' && (
              <GitHubForm projectId={projectId} isGitLab={false} onSuccess={handleSuccess} />
            )}
            {activeTab === 'gitlab' && (
              <GitHubForm projectId={projectId} isGitLab={true} onSuccess={handleSuccess} />
            )}
            {activeTab === 'sql' && (
              <SqlForm projectId={projectId} onSuccess={handleSuccess} />
            )}
            {activeTab === 'url' && (
              <UrlForm projectId={projectId} onSuccess={handleSuccess} />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
