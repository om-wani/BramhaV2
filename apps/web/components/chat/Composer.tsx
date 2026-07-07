'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/lib/stores/chat-store'
import { cn } from '@/lib/utils'

interface ComposerProps {
  onSend: (text: string) => Promise<void>
}

/**
 * Message input area.
 * - Enter submits; Shift+Enter inserts a newline.
 * - Textarea auto-resizes up to 200 px.
 * - Shows the active branch name when not on 'main'.
 */
export function Composer({ onSend }: ComposerProps) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { activeBranchId, branches, conversationId } = useChatStore()

  const activeBranch = branches.find((b) => b.id === activeBranchId)
  const isNonMainBranch = activeBranch && activeBranch.name !== 'main'
  const canSend = text.trim().length > 0 && !!conversationId && !sending

  async function submit() {
    if (!canSend) return
    const message = text.trim()
    setSending(true)
    setText('')
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    try {
      await onSend(message)
    } catch {
      // Restore text on error so the user doesn't lose their message
      setText(message)
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setText(e.target.value)
    // Auto-resize
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  return (
    <div className="border-t border-border bg-background px-4 py-3">
      {isNonMainBranch && (
        <div className="mb-2 flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Branch:</span>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {activeBranch.name}
          </span>
        </div>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); void submit() }}
        className="flex items-end gap-2"
      >
        <label htmlFor="composer-input" className="sr-only">
          Message
        </label>
        <textarea
          id="composer-input"
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            conversationId
              ? 'Type a message… (Shift+Enter for newline)'
              : 'Loading conversation…'
          }
          disabled={!conversationId || sending}
          rows={1}
          className={cn(
            'flex-1 resize-none rounded-xl border border-input bg-card px-4 py-2.5',
            'text-sm placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'min-h-[44px] max-h-[200px] overflow-y-auto',
          )}
        />
        <Button
          type="submit"
          size="icon"
          disabled={!canSend}
          aria-label="Send message"
          className="h-11 w-11 shrink-0 rounded-xl"
        >
          <span aria-hidden="true" className="text-base leading-none">↑</span>
        </Button>
      </form>
    </div>
  )
}
