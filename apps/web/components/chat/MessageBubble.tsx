'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { cn } from '@/lib/utils'
import type { ConversationNode } from '@/lib/stores/chat-store'

// ── Sanitize schema ────────────────────────────────────────────────────────────
//
// Extends the safe default schema.  The protocols map already blocks
// javascript: links; we override href/src to the minimal safe set and
// also block data: URIs in src attributes.

export const sanitizeSchema: typeof defaultSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
    src: ['http', 'https'],
  },
  // Strip ALL event-handler attributes (onerror, onclick, etc.)
  // defaultSchema already does not allow them, but we enumerate the
  // strip-list to make the invariant explicit and testable.
  strip: ['script', 'style'],
}

// ── Component ──────────────────────────────────────────────────────────────────

interface MessageBubbleProps {
  node: ConversationNode
  onBranch: (nodeId: string) => void
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function MessageBubble({ node, onBranch }: MessageBubbleProps) {
  const [hovered, setHovered] = useState(false)

  const text =
    typeof node.content === 'object' && node.content !== null
      ? ((node.content as { text?: string }).text ?? '')
      : String(node.content ?? '')

  const isSystem = node.type === 'system_event'
  const isUser = node.authorKind === 'user'

  // System events: centred subdued pill
  if (isSystem) {
    return (
      <div className="flex justify-center py-2 px-4" role="status" aria-label="System event">
        <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
          {text}
        </span>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'group relative flex items-start gap-2 px-4 py-2',
        isUser ? 'flex-row-reverse' : 'flex-row',
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Message bubble */}
      <div
        className={cn(
          'max-w-[72%] rounded-2xl px-4 py-2.5 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'border border-border bg-card text-card-foreground',
        )}
      >
        {/* Markdown body — rehype-sanitize enforces allowlist */}
        <div
          className={cn(
            'prose prose-sm max-w-none break-words',
            isUser ? 'prose-invert' : 'dark:prose-invert',
          )}
        >
          <ReactMarkdown
            rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
            components={{
              // Override <a> to force safe rel/target on all links
              a: ({ href, children, ...rest }) => (
                <a
                  {...rest}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {children}
                </a>
              ),
            }}
          >
            {text}
          </ReactMarkdown>
        </div>

        {/* Timestamp */}
        <div className="mt-1 text-right text-[10px] opacity-50">
          {formatTime(node.createdAt)}
        </div>
      </div>

      {/* Branch-from-here button — visible on hover */}
      <button
        aria-label="Branch conversation from this message"
        title="Branch from here"
        onClick={() => onBranch(node.id)}
        className={cn(
          'self-center rounded border border-border bg-card px-1.5 py-0.5 text-xs',
          'text-muted-foreground transition-opacity hover:text-foreground',
          hovered ? 'opacity-100' : 'opacity-0',
        )}
      >
        ⑂
      </button>
    </div>
  )
}
