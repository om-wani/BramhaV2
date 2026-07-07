'use client'

import { useRouter } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import { sanitizeSchema } from '@/components/chat/MessageBubble'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api-client'
import { z } from 'zod'
import type { GraphConversationNode, GraphBranch } from './types'

// ── Fork API response schema ───────────────────────────────────────────────────

const ForkResponseSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  name: z.string(),
  headNodeId: z.string(),
  forkedFromNode: z.string().nullable(),
  createdAt: z.string(),
})

// ── Role label helpers ─────────────────────────────────────────────────────────

function roleLabel(role: string): string {
  if (role === 'user') return 'User'
  if (role === 'assistant') return 'Assistant'
  return 'System'
}

function roleIcon(role: string): string {
  if (role === 'user') return '👤'
  if (role === 'assistant') return '🤖'
  return '⚙'
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

interface NodeDrawerProps {
  node: GraphConversationNode | null
  branchHead: GraphBranch | undefined
  branches: GraphBranch[]
  projectId: string
  roomId: string
  conversationId: string
  onClose: () => void
}

export function NodeDrawer({
  node,
  branchHead,
  branches,
  projectId,
  roomId,
  conversationId,
  onClose,
}: NodeDrawerProps) {
  const router = useRouter()

  const isOpen = node !== null

  const branchName =
    branchHead?.name ??
    branches.find((b) => b.id === node?.branchId)?.name ??
    'unknown'

  const text =
    node && typeof node.content === 'object' && node.content !== null
      ? (node.content.text ?? '')
      : ''

  function handleOpenInRoom() {
    if (!node) return
    router.push(
      `/p/${projectId}/conference?nodeId=${node.id}&branchId=${node.branchId}`,
    )
  }

  async function handleBranchFromHere() {
    if (!node) return
    try {
      const result = await api.post(
        `/projects/${projectId}/rooms/${roomId}/conversations/${conversationId}/fork`,
        ForkResponseSchema,
        { fromNodeId: node.id },
      )
      router.push(
        `/p/${projectId}/conference?nodeId=${node.id}&branchId=${result.id}`,
      )
    } catch (err) {
      // Surface error minimally — in prod this would use a toast
      console.error('[NodeDrawer] fork failed', err)
    }
  }

  return (
    <>
      {/* Backdrop — only rendered when open */}
      <div
        aria-hidden="true"
        className={cn(
          'fixed inset-0 z-30 bg-black/40 transition-opacity',
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
      />

      {/* Drawer panel */}
      <aside
        role="complementary"
        aria-label="Node detail drawer"
        className={cn(
          'fixed right-0 top-0 z-40 flex h-full w-[420px] max-w-full flex-col',
          'border-l border-border bg-card shadow-xl',
          'transition-transform duration-300 ease-in-out',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-lg">
              {node ? roleIcon(node.role) : ''}
            </span>
            <span className="text-sm font-medium">
              {node ? roleLabel(node.role) : 'Node detail'}
            </span>
            {branchHead && (
              <Badge variant="secondary" className="text-xs">
                branch head: {branchHead.name}
              </Badge>
            )}
          </div>
          <button
            aria-label="Close node drawer"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            ✕
          </button>
        </div>

        {/* Meta */}
        {node && (
          <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
            <span className="mr-4">Branch: {branchName}</span>
            <span>{formatTimestamp(node.createdAt)}</span>
          </div>
        )}

        {/* Full content */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {node && (
            <div className="prose prose-sm dark:prose-invert max-w-none break-words text-sm">
              <ReactMarkdown
                rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
                components={{
                  a: ({ href, children, ...rest }) => (
                    <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
                      {children}
                    </a>
                  ),
                }}
              >
                {text}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
          <Button
            variant="default"
            size="sm"
            className="w-full"
            onClick={handleOpenInRoom}
            disabled={!node}
          >
            Open in room at this node
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleBranchFromHere}
            disabled={!node}
          >
            Branch from here
          </Button>
        </div>
      </aside>
    </>
  )
}
