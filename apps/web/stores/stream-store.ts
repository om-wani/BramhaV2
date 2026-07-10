import { create } from 'zustand'

// ── Types ──────────────────────────────────────────────────────────────────────

export type AgentStatus =
  | 'invoking_subagent'
  | 'reading_database'
  | 'running_code'
  | 'generating_artifact'
  | 'waiting_for_approval'

export interface AgentStream {
  personaId: string
  name: string
  slug: string
  color: string
  status: AgentStatus | null
  thoughts: string
  /** Estimated token count for thoughts (Math.ceil(chars / 4)). */
  thoughtTokens: number
  content: string
  isStreaming: boolean
  /** Set when the turn completes; null while streaming. */
  nodeId: string | null
}

interface StreamStore {
  streams: Map<string, AgentStream>

  /** Begin a new stream for a persona. Replaces any existing stream entry. */
  startStream: (
    personaId: string,
    meta: Pick<AgentStream, 'name' | 'slug' | 'color'>,
  ) => void

  /** Append a thought delta and increment the estimated token count. */
  appendThought: (personaId: string, delta: string) => void

  /** Append a content delta. */
  appendContent: (personaId: string, delta: string) => void

  /** Update the active tool/operation status tag. */
  setStatus: (personaId: string, status: AgentStatus | null) => void

  /** Mark the stream as complete, record the final nodeId. */
  stopStream: (personaId: string, nodeId: string) => void

  /** Stop every active stream (e.g. global interrupt). */
  stopAllStreams: () => void

  /** Remove a stream entry entirely. */
  clearStream: (personaId: string) => void
}

// ── Store ──────────────────────────────────────────────────────────────────────

export const useStreamStore = create<StreamStore>((set) => ({
  streams: new Map(),

  startStream: (personaId, meta) =>
    set((state) => {
      const next = new Map(state.streams)
      next.set(personaId, {
        personaId,
        ...meta,
        status: null,
        thoughts: '',
        thoughtTokens: 0,
        content: '',
        isStreaming: true,
        nodeId: null,
      })
      return { streams: next }
    }),

  appendThought: (personaId, delta) =>
    set((state) => {
      const stream = state.streams.get(personaId)
      if (!stream) return state
      const next = new Map(state.streams)
      next.set(personaId, {
        ...stream,
        thoughts: stream.thoughts + delta,
        thoughtTokens: stream.thoughtTokens + Math.ceil(delta.length / 4),
      })
      return { streams: next }
    }),

  appendContent: (personaId, delta) =>
    set((state) => {
      const stream = state.streams.get(personaId)
      if (!stream) return state
      const next = new Map(state.streams)
      next.set(personaId, {
        ...stream,
        content: stream.content + delta,
      })
      return { streams: next }
    }),

  setStatus: (personaId, status) =>
    set((state) => {
      const stream = state.streams.get(personaId)
      if (!stream) return state
      const next = new Map(state.streams)
      next.set(personaId, { ...stream, status })
      return { streams: next }
    }),

  stopStream: (personaId, nodeId) =>
    set((state) => {
      const stream = state.streams.get(personaId)
      if (!stream) return state
      const next = new Map(state.streams)
      next.set(personaId, {
        ...stream,
        isStreaming: false,
        nodeId,
        status: null,
      })
      return { streams: next }
    }),

  stopAllStreams: () =>
    set((state) => {
      const next = new Map(state.streams)
      for (const [key, stream] of next) {
        next.set(key, { ...stream, isStreaming: false, status: null })
      }
      return { streams: next }
    }),

  clearStream: (personaId) =>
    set((state) => {
      const next = new Map(state.streams)
      next.delete(personaId)
      return { streams: next }
    }),
}))
