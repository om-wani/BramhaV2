'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/lib/stores/chat-store'
import { cn } from '@/lib/utils'
import { MentionMenu } from './MentionMenu'
import type { AgentOption } from './MentionMenu'

interface ComposerProps {
  onSend: (text: string) => Promise<void>
  /** Called (throttled, once per second) when the user is actively typing. */
  onTyping?: () => void
  /** Agent list for @mention autocomplete. */
  agents?: AgentOption[]
}

/**
 * Extract the @mention query from the text before a cursor position.
 * Returns the word after the last `@` if there is no whitespace between
 * the `@` and the cursor, otherwise returns null (no active mention).
 */
function extractMentionQuery(value: string, cursorPos: number): string | null {
  const textBeforeCursor = value.slice(0, cursorPos)
  const match = textBeforeCursor.match(/@(\w*)$/)
  return match ? (match[1] ?? null) : null
}

/**
 * Message input area.
 * - Enter submits; Shift+Enter inserts a newline.
 * - Textarea auto-resizes up to 200 px.
 * - Shows the active branch name when not on 'main'.
 * - Shows typing indicator for other users when typingUsers is non-empty.
 * - Typing `@` opens the agent mention autocomplete.
 */
export function Composer({ onSend, onTyping, agents = [] }: ComposerProps) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lastTypingEmit = useRef(0)

  const { activeBranchId, branches, conversationId, typingUsers } = useChatStore()

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
    // Dismiss mention menu on Escape
    if (e.key === 'Escape' && mentionQuery !== null) {
      e.preventDefault()
      setMentionQuery(null)
      return
    }
    // While mention menu is open, let it handle Enter/ArrowDown/ArrowUp
    if (mentionQuery !== null && (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value
    setText(value)
    // Auto-resize
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
    // Update mention query based on cursor position
    const cursorPos = el.selectionStart ?? value.length
    setMentionQuery(extractMentionQuery(value, cursorPos))
    // Throttled typing notification (at most once per second)
    if (onTyping) {
      const now = Date.now()
      if (now - lastTypingEmit.current > 1000) {
        lastTypingEmit.current = now
        onTyping()
      }
    }
  }

  function handleAgentSelect(agent: AgentOption) {
    const textarea = textareaRef.current
    const cursorPos = textarea?.selectionStart ?? text.length
    const textBefore = text.slice(0, cursorPos)
    const textAfter = text.slice(cursorPos)
    // Replace @{query} at the end of textBefore with @{slug} + space
    const newTextBefore = textBefore.replace(/@\w*$/, `@${agent.slug} `)
    const newText = newTextBefore + textAfter
    setText(newText)
    setMentionQuery(null)
    // Restore focus and move cursor after the inserted mention
    setTimeout(() => {
      if (textarea) {
        textarea.focus()
        const newCursor = newTextBefore.length
        textarea.setSelectionRange(newCursor, newCursor)
      }
    }, 0)
  }

  // Derive display names from the userId→displayName map for rendering
  const typingNames = Array.from(typingUsers.values())
  const typingText =
    typingNames.length === 1
      ? `${typingNames[0]} is typing…`
      : typingNames.length === 2
        ? `${typingNames[0]} and ${typingNames[1]} are typing…`
        : typingNames.length > 2
          ? `${typingNames.length} people are typing…`
          : null

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

      {/* Typing indicator */}
      {typingText && (
        <div
          className="mb-1 px-1 text-xs text-muted-foreground"
          aria-live="polite"
          aria-atomic="true"
        >
          {typingText}
        </div>
      )}

      {/* Relative wrapper so MentionMenu can use absolute bottom-full */}
      <div className="relative">
        {/* @mention autocomplete above the textarea */}
        {mentionQuery !== null && (
          <MentionMenu
            query={mentionQuery}
            agents={agents}
            onSelect={handleAgentSelect}
            onDismiss={() => setMentionQuery(null)}
          />
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
    </div>
  )
}
