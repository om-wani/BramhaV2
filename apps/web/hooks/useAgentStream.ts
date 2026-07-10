'use client'

import { useEffect } from 'react'
import { useStreamStore } from '@/stores/stream-store'
import type { AgentStatus, AgentStream } from '@/stores/stream-store'
import { getSocket } from '@/lib/socket'

// ── Event payload shapes (runtime-safe casting, not Zod, for hot paths) ────────

interface ThoughtDeltaPayload {
  conversationId?: string
  personaId: string
  delta: string
  name?: string
  slug?: string
  color?: string
}

interface ContentDeltaPayload {
  conversationId?: string
  personaId: string
  delta: string
  name?: string
  slug?: string
  color?: string
}

interface AgentStatusPayload {
  conversationId?: string
  personaId: string
  status: AgentStatus | null
}

interface TurnCompletePayload {
  conversationId?: string
  personaId: string
  nodeId: string
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Subscribe to live agent stream events for `conversationId` via the existing
 * Socket.IO singleton.  Returns the live streams map plus imperative controls.
 *
 * Event naming convention mirrors existing socket usage in ChatRoom.tsx:
 *   `conv.stream.thought_delta`   — thought fragment from an agent
 *   `conv.stream.content_delta`   — response content fragment
 *   `conv.stream.agent_status`    — tool/operation status update
 *   `conv.stream.agent_turn_complete` — turn finished, final nodeId provided
 *
 * All events carry `conversationId` in the payload for multi-room filtering.
 */
export function useAgentStream(conversationId: string): {
  streams: Map<string, AgentStream>
  stopAgent: (personaId: string) => void
  stopAll: () => void
} {
  const { startStream, appendThought, appendContent, setStatus, stopStream } =
    useStreamStore()

  const streams = useStreamStore((s) => s.streams)

  useEffect(() => {
    const sock = getSocket()
    if (!sock) return

    // ── Handlers ──────────────────────────────────────────────────────────────

    const onThoughtDelta = (payload: unknown) => {
      const p = payload as ThoughtDeltaPayload
      if (!p?.personaId) return
      if (p.conversationId && p.conversationId !== conversationId) return

      // Auto-start stream if first event for this persona
      if (!useStreamStore.getState().streams.has(p.personaId)) {
        startStream(p.personaId, {
          name: p.name ?? p.personaId,
          slug: p.slug ?? p.personaId,
          color: p.color ?? '#6366f1',
        })
      }
      appendThought(p.personaId, p.delta)
    }

    const onContentDelta = (payload: unknown) => {
      const p = payload as ContentDeltaPayload
      if (!p?.personaId) return
      if (p.conversationId && p.conversationId !== conversationId) return

      if (!useStreamStore.getState().streams.has(p.personaId)) {
        startStream(p.personaId, {
          name: p.name ?? p.personaId,
          slug: p.slug ?? p.personaId,
          color: p.color ?? '#6366f1',
        })
      }
      appendContent(p.personaId, p.delta)
    }

    const onAgentStatus = (payload: unknown) => {
      const p = payload as AgentStatusPayload
      if (!p?.personaId) return
      if (p.conversationId && p.conversationId !== conversationId) return
      setStatus(p.personaId, p.status)
    }

    const onTurnComplete = (payload: unknown) => {
      const p = payload as TurnCompletePayload
      if (!p?.personaId) return
      if (p.conversationId && p.conversationId !== conversationId) return
      stopStream(p.personaId, p.nodeId ?? '')
    }

    // ── Subscribe ─────────────────────────────────────────────────────────────

    sock.on('conv.stream.thought_delta', onThoughtDelta)
    sock.on('conv.stream.content_delta', onContentDelta)
    sock.on('conv.stream.agent_status', onAgentStatus)
    sock.on('conv.stream.agent_turn_complete', onTurnComplete)

    return () => {
      sock.off('conv.stream.thought_delta', onThoughtDelta)
      sock.off('conv.stream.content_delta', onContentDelta)
      sock.off('conv.stream.agent_status', onAgentStatus)
      sock.off('conv.stream.agent_turn_complete', onTurnComplete)
    }
  }, [conversationId, startStream, appendThought, appendContent, setStatus, stopStream])

  // ── Imperative controls ────────────────────────────────────────────────────

  /** Interrupt a single agent stream and emit the stop signal. */
  const stopAgent = (personaId: string) => {
    const sock = getSocket()
    if (sock?.connected) {
      sock.emit('interrupt.raise', { reason: 'stop', personaId })
    }
    // Mark locally as stopped immediately for responsive UI
    useStreamStore.getState().stopStream(personaId, '')
  }

  /** Interrupt all active streams. */
  const stopAll = () => {
    const sock = getSocket()
    if (sock?.connected) {
      sock.emit('interrupt.raise', { reason: 'stop', personaId: null })
    }
    useStreamStore.getState().stopAllStreams()
  }

  return { streams, stopAgent, stopAll }
}
