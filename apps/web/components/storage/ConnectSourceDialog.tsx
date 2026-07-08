'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { FileDropzone } from '@/components/chat/FileDropzone'
import { cn } from '@/lib/utils'

type Tab = 'upload' | 'github' | 'gitlab' | 'sql' | 'url'

const TABS: { id: Tab; label: string }[] = [
  { id: 'upload', label: 'Manual Upload' },
  { id: 'github', label: 'GitHub' },
  { id: 'gitlab', label: 'GitLab' },
  { id: 'sql', label: 'SQL Database' },
  { id: 'url', label: 'URL' },
]

const PHASE3_MESSAGE = "Source connectors available in Phase 3. Use the 'Manual Upload' tab to add files now."

function Phase3Placeholder({ type }: { type: string }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-dashed border-border p-4 text-center">
        <p className="text-sm text-muted-foreground">{PHASE3_MESSAGE}</p>
      </div>
      <fieldset disabled aria-label={`${type} connector (disabled — coming in Phase 3)`} className="space-y-3 opacity-40 cursor-not-allowed">
        {type === 'github' && (
          <>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Repository URL</label>
              <input type="text" placeholder="https://github.com/org/repo" className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" readOnly />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Branch</label>
              <input type="text" placeholder="main" className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" readOnly />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Personal Access Token</label>
              <input type="password" placeholder="ghp_…" className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" readOnly />
            </div>
          </>
        )}
        {type === 'gitlab' && (
          <>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">GitLab URL</label>
              <input type="text" placeholder="https://gitlab.com/org/repo" className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" readOnly />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Access Token</label>
              <input type="password" placeholder="glpat-…" className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" readOnly />
            </div>
          </>
        )}
        {type === 'sql' && (
          <>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Connection String</label>
              <input type="text" placeholder="postgresql://…" className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" readOnly />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Tables to sync</label>
              <input type="text" placeholder="users, orders, products" className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" readOnly />
            </div>
          </>
        )}
        {type === 'url' && (
          <>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">URL to crawl</label>
              <input type="url" placeholder="https://docs.example.com" className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" readOnly />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Crawl depth</label>
              <input type="number" placeholder="2" className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm" readOnly />
            </div>
          </>
        )}
      </fieldset>
    </div>
  )
}

interface ConnectSourceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  initialTab?: Tab
}

export function ConnectSourceDialog({ open, onOpenChange, projectId, initialTab }: ConnectSourceDialogProps) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? 'upload')

  // Reset to initialTab whenever the dialog opens
  useEffect(() => {
    if (open) setActiveTab(initialTab ?? 'upload')
  }, [open, initialTab])

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
            {TABS.map((tab) => {
              const isExternal = tab.id !== 'upload'
              return (
                <button
                  key={tab.id}
                  role="tab"
                  type="button"
                  aria-selected={activeTab === tab.id}
                  aria-controls={`panel-${tab.id}`}
                  disabled={isExternal}
                  aria-disabled={isExternal ? 'true' : undefined}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'border-b-2 px-3 py-3 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary',
                    isExternal && 'opacity-50 cursor-not-allowed',
                    activeTab === tab.id
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          {/* Tab panels */}
          <div className="p-6" id={`panel-${activeTab}`} role="tabpanel" aria-label={`${activeTab} panel`}>
            {activeTab === 'upload' ? (
              <FileDropzone projectId={projectId} />
            ) : (
              <Phase3Placeholder type={activeTab} />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
