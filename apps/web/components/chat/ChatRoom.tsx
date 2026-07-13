'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { api, ApiError } from '@/lib/api-client'
import { createSocket, getSocket, destroySocket } from '@/lib/socket'
import { useChatStore } from '@/lib/stores/chat-store'
import type { ConversationNode, Branch } from '@/lib/stores/chat-store'
import { MessageList } from './MessageList'
import { Composer } from './Composer'
import { RoomHeader } from './RoomHeader'
import { useAgentStream } from '@/hooks/useAgentStream'
import { useActivityEvents } from '@/hooks/useActivityEvents'
import { ActivityPane } from '@/components/activity/ActivityPane'
import { ArtifactPane } from '@/components/artifacts/ArtifactPane'

// ── Zod schemas ────────────────────────────────────────────────────────────────

const RoomSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  type: z.string(),
  name: z.string(),
  createdBy: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const BranchSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  projectId: z.string(),
  name: z.string(),
  headNodeId: z.string(),
  forkedFromNode: z.string().nullable(),
  createdByKind: z.string(),
  createdById: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const ConversationSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  projectId: z.string(),
  title: z.string().nullable(),
  defaultBranchId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  branches: z.array(BranchSchema),
})

const NodeContentSchema = z.object({
  text: z.string(),
  mentions: z.array(z.string()).optional().default([]),
  attachments: z
    .array(z.object({ fileId: z.string(), name: z.string() }))
    .optional()
    .default([]),
  meta: z.record(z.string(), z.unknown()).optional().default({}),
}).passthrough()

const NodeSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  projectId: z.string(),
  parentId: z.string().nullable(),
  depth: z.number(),
  path: z.string(),
  type: z.string(),
  authorKind: z.string(),
  authorUserId: z.string().nullable(),
  authorPersonaId: z.string().nullable(),
  content: NodeContentSchema,
  tokenUsage: z.unknown(),
  createdAt: z.string(),
})

const SliceSchema = z.object({
  nodes: z.array(NodeSchema),
  truncated: z.boolean(),
})

const AccessTokenSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number(),
})

const CurrentUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
})

// ── SessionStorage helpers ─────────────────────────────────────────────────────

function getStoredConvId(projectId: string, roomId: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem(`bramha:conv:${projectId}:${roomId}`)
  } catch {
    return null
  }
}

function storeConvId(projectId: string, roomId: string, convId: string): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(`bramha:conv:${projectId}:${roomId}`, convId)
  } catch {
    // ignore
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

interface ChatRoomProps {
  projectId: string
  /** Room type used to locate the room within the project (ignored when roomId is set). */
  roomType?: string
  /** When provided, fetch this specific room directly instead of searching by type. */
  roomId?: string
}

export function ChatRoom({ projectId, roomType = 'conference', roomId: specificRoomId }: ChatRoomProps) {
  const [isTransitioning, setIsTransitioning] = useState(false)

  const {
    setConversation,
    setNodes,
    addNode,
    addBranch,
    updateBranch,
    setActiveBranch,
    setConnected,
    setTyping,
    activeBranchId,
    conversationId,
    reset,
  } = useChatStore()

  // Track refs to avoid stale closures in socket listeners
  const convIdRef = useRef<string | null>(null)
  convIdRef.current = conversationId

  // Per-user typing-indicator timeout handles
  const typingTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // ── Step 1: Get WS access token via refresh ──────────────────────────────────

  const { data: tokenData } = useQuery({
    queryKey: ['ws-token'],
    queryFn: () => api.post('/auth/refresh', AccessTokenSchema, {}),
    staleTime: 4 * 60 * 1000, // refresh before typical 5 min expiry
    gcTime: 5 * 60 * 1000,
  })
  const wsToken = tokenData?.accessToken ?? null

  // ── Step 1b: Current user (for typing emit) ──────────────────────────────────

  const { data: currentUser } = useQuery({
    queryKey: ['current-user'],
    queryFn: () => api.get('/auth/me', CurrentUserSchema),
    staleTime: Infinity,
  })
  const currentUserId = currentUser?.id ?? null

  // ── Step 2: Fetch room(s) — by specific ID or by type ───────────────────────

  // Path A: specific room ID provided → fetch that room directly
  const { data: specificRoom } = useQuery({
    queryKey: ['room', projectId, specificRoomId],
    queryFn: () => api.get(`/projects/${projectId}/rooms/${specificRoomId}`, RoomSchema),
    enabled: !!specificRoomId,
    staleTime: 5 * 60 * 1000,
  })

  // Path B: no specific ID → fetch all rooms and find by type
  const { data: rooms } = useQuery({
    queryKey: ['rooms', projectId],
    queryFn: () => api.get(`/projects/${projectId}/rooms`, z.array(RoomSchema)),
    enabled: !specificRoomId,
    staleTime: 5 * 60 * 1000,
  })

  const room = specificRoomId
    ? (specificRoom ?? null)
    : (rooms?.find((r) => r.type === roomType) ?? null)

  // ── Step 3: Get-or-create conversation ─────────────────────────────────────

  const { data: conversation, isLoading: convLoading } = useQuery({
    queryKey: ['conversation', projectId, room?.id],
    queryFn: async () => {
      if (!room) throw new Error('room not ready')

      const stored = getStoredConvId(projectId, room.id)

      if (stored) {
        try {
          const conv = await api.get(
            `/projects/${projectId}/rooms/${room.id}/conversations/${stored}`,
            ConversationSchema,
          )
          return conv
        } catch (err) {
          // 404 → conversation was deleted; fall through to create
          if (!(err instanceof ApiError) || err.status !== 404) throw err
        }
      }

      const conv = await api.post(
        `/projects/${projectId}/rooms/${room.id}/conversations`,
        ConversationSchema,
        {},
      )
      storeConvId(projectId, room.id, conv.id)
      return conv
    },
    enabled: !!room,
    staleTime: Infinity, // conversation identity is stable
  })

  // Sync conversation into the store
  useEffect(() => {
    if (!conversation) return
    setConversation(conversation.id, conversation.branches as Branch[])
    storeConvId(projectId, room!.id, conversation.id)
  }, [conversation?.id])

  // ── Step 4: Load initial nodes (slice) ──────────────────────────────────────

  const { isLoading: nodesLoading, data: slice } = useQuery({
    queryKey: ['slice', conversation?.id, activeBranchId],
    queryFn: () =>
      api.get(
        `/projects/${projectId}/rooms/${room!.id}/conversations/${conversation!.id}/slice?branchId=${activeBranchId!}`,
        SliceSchema,
      ),
    enabled: !!conversation && !!activeBranchId && !!room,
    staleTime: 30 * 1000,
  })

  // Push slice nodes into the store
  useEffect(() => {
    if (slice) setNodes(slice.nodes as ConversationNode[])
  }, [slice])

  // ── Step 5: Socket.IO ───────────────────────────────────────────────────────

  // Create / destroy socket lifecycle
  useEffect(() => {
    if (!wsToken) return

    const sock = createSocket(wsToken)

    const onConnect = () => setConnected(true)
    const onDisconnect = () => setConnected(false)

    sock.on('connect', onConnect)
    sock.on('disconnect', onDisconnect)
    if (sock.connected) setConnected(true)

    return () => {
      sock.off('connect', onConnect)
      sock.off('disconnect', onDisconnect)
      destroySocket()
      setConnected(false)
    }
  // wsToken changes → recreate socket with fresh JWT
  }, [wsToken])

  // Join room + subscribe to conversation events + typing events
  useEffect(() => {
    if (!conversation || !room) return

    const sock = getSocket()
    if (!sock) return

    sock.emit('room.join', { roomId: room.id, projectId })

    const onNodeAppended = (payload: unknown) => {
      const p = payload as { conversationId: string; node: unknown }
      if (p.conversationId !== convIdRef.current) return
      const parsed = NodeSchema.safeParse(p.node)
      if (parsed.success) addNode(parsed.data as ConversationNode)
    }

    const onBranchForked = (payload: unknown) => {
      const p = payload as { conversationId: string; branch: unknown }
      if (p.conversationId !== convIdRef.current) return
      const parsed = BranchSchema.safeParse(p.branch)
      if (parsed.success) addBranch(parsed.data as Branch)
    }

    const onBranchUpdated = (payload: unknown) => {
      const p = payload as { conversationId: string; branch: unknown }
      if (p.conversationId !== convIdRef.current) return
      const parsed = BranchSchema.safeParse(p.branch)
      if (parsed.success) updateBranch(parsed.data as Branch)
    }

    const onUserTyping = (payload: unknown) => {
      const p = payload as { userId?: string; displayName?: string }
      const userId = p.userId
      if (!userId || userId === currentUserId) return // don't show self

      const displayName = p.displayName ?? userId
      // Key on userId — displayName is only for rendering
      setTyping(userId, displayName, true)

      // Clear any existing auto-remove timeout for this user
      const existing = typingTimeouts.current.get(userId)
      if (existing) clearTimeout(existing)

      // Auto-remove after 3 seconds of silence
      const timeout = setTimeout(() => {
        setTyping(userId, displayName, false)
        typingTimeouts.current.delete(userId)
      }, 3000)
      typingTimeouts.current.set(userId, timeout)
    }

    sock.on('conv.node.appended', onNodeAppended)
    sock.on('conv.branch.forked', onBranchForked)
    sock.on('conv.branch.updated', onBranchUpdated)
    sock.on('room.typing', onUserTyping)

    return () => {
      sock.emit('room.leave', { roomId: room.id })
      sock.off('conv.node.appended', onNodeAppended)
      sock.off('conv.branch.forked', onBranchForked)
      sock.off('conv.branch.updated', onBranchUpdated)
      sock.off('room.typing', onUserTyping)
    }
  }, [conversation?.id, room?.id])

  // Clear all typing timeouts on unmount
  useEffect(() => {
    const timeouts = typingTimeouts.current
    return () => {
      timeouts.forEach(clearTimeout)
      timeouts.clear()
      reset()
    }
  }, [])

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleSend = useCallback(
    async (text: string) => {
      if (!conversation || !room || !activeBranchId) return
      await api.post(
        `/projects/${projectId}/rooms/${room.id}/conversations/${conversation.id}/nodes`,
        NodeSchema,
        {
          branchId: activeBranchId,
          type: 'user_message',
          authorKind: 'user',
          content: { text, mentions: [], attachments: [], meta: {} },
          idempotencyKey: crypto.randomUUID(),
        },
      )
    },
    [conversation?.id, room?.id, activeBranchId, projectId],
  )

  const handleBranchFrom = useCallback(
    async (nodeId: string) => {
      if (!conversation || !room) return
      const branchName = `branch-${Date.now()}`
      const newBranch = await api.post(
        `/projects/${projectId}/rooms/${room.id}/conversations/${conversation.id}/fork`,
        BranchSchema,
        { fromNodeId: nodeId, name: branchName },
      )
      addBranch(newBranch as Branch)
      setActiveBranch(newBranch.id)
    },
    [conversation?.id, room?.id, projectId],
  )

  const handleSwitchBranch = useCallback(
    async (branchId: string) => {
      if (!conversation || !room) return
      setIsTransitioning(true)
      setActiveBranch(branchId)
      // Fetch new slice
      try {
        const newSlice = await api.get(
          `/projects/${projectId}/rooms/${room.id}/conversations/${conversation.id}/slice?branchId=${branchId}`,
          SliceSchema,
        )
        setNodes(newSlice.nodes as ConversationNode[])
      } finally {
        setIsTransitioning(false)
      }
    },
    [conversation?.id, room?.id, projectId],
  )

  /** Throttled typing emit — called by Composer when user types. */
  const handleTyping = useCallback(() => {
    if (!room || !currentUserId) return
    const sock = getSocket()
    if (!sock?.connected) return
    sock.emit('room.typing', {
      roomId: room.id,
      userId: currentUserId,
      displayName: currentUser?.displayName ?? currentUserId,
    })
  }, [room?.id, currentUserId, currentUser?.displayName])

  // ── Activity events (background delegation feed) ────────────────────────────
  useActivityEvents(projectId)

  // ── Agent stream controls ────────────────────────────────────────────────────
  const { stopAgent } = useAgentStream(conversationId ?? '')

  // ── Artifacts pane ────────────────────────────────────────────────────────────
  const [artifactsOpen, setArtifactsOpen] = useState(false)

  // ── Render ──────────────────────────────────────────────────────────────────

  const isLoading = convLoading || nodesLoading

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <RoomHeader
        room={room}
        onSwitchBranch={handleSwitchBranch}
        artifactsOpen={artifactsOpen}
        onToggleArtifacts={() => setArtifactsOpen((v) => !v)}
      />
      <MessageList
        isLoading={isLoading}
        isTransitioning={isTransitioning}
        onBranch={handleBranchFrom}
        onSwitchBranch={handleSwitchBranch}
        onStopAgent={stopAgent}
      />
      <Composer onSend={handleSend} onTyping={handleTyping} />
      <ActivityPane projectId={projectId} />
      <ArtifactPane
        projectId={projectId}
        conversationId={conversationId}
        isOpen={artifactsOpen}
        onClose={() => setArtifactsOpen(false)}
      />
    </div>
  )
}
