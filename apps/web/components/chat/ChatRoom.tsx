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
  /** Room type used to locate the room within the project. */
  roomType?: string
}

export function ChatRoom({ projectId, roomType = 'conference' }: ChatRoomProps) {
  const [isTransitioning, setIsTransitioning] = useState(false)

  const {
    setConversation,
    setNodes,
    addNode,
    addBranch,
    updateBranch,
    setActiveBranch,
    setConnected,
    activeBranchId,
    conversationId,
    reset,
  } = useChatStore()

  // Track refs to avoid stale closures in socket listeners
  const convIdRef = useRef<string | null>(null)
  convIdRef.current = conversationId

  // ── Step 1: Get WS access token via refresh ──────────────────────────────────

  const { data: tokenData } = useQuery({
    queryKey: ['ws-token'],
    queryFn: () => api.post('/auth/refresh', AccessTokenSchema, {}),
    staleTime: 4 * 60 * 1000, // refresh before typical 5 min expiry
    gcTime: 5 * 60 * 1000,
  })
  const wsToken = tokenData?.accessToken ?? null

  // ── Step 2: Fetch rooms, find the target room ────────────────────────────────

  const { data: rooms } = useQuery({
    queryKey: ['rooms', projectId],
    queryFn: () => api.get(`/projects/${projectId}/rooms`, z.array(RoomSchema)),
    staleTime: 5 * 60 * 1000,
  })

  const room = rooms?.find((r) => r.type === roomType) ?? null

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

  // Join room + subscribe to events
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

    sock.on('conv.node.appended', onNodeAppended)
    sock.on('conv.branch.forked', onBranchForked)
    sock.on('conv.branch.updated', onBranchUpdated)

    return () => {
      sock.emit('room.leave', { roomId: room.id })
      sock.off('conv.node.appended', onNodeAppended)
      sock.off('conv.branch.forked', onBranchForked)
      sock.off('conv.branch.updated', onBranchUpdated)
    }
  }, [conversation?.id, room?.id])

  // Reset store on unmount
  useEffect(() => {
    return () => { reset() }
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
        const slice = await api.get(
          `/projects/${projectId}/rooms/${room.id}/conversations/${conversation.id}/slice?branchId=${branchId}`,
          SliceSchema,
        )
        setNodes(slice.nodes as ConversationNode[])
      } finally {
        setIsTransitioning(false)
      }
    },
      [conversation?.id, room?.id, projectId],
  )

  // ── Render ──────────────────────────────────────────────────────────────────

  const isLoading = convLoading || nodesLoading

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <RoomHeader room={room} onSwitchBranch={handleSwitchBranch} />
      <MessageList
        isLoading={isLoading}
        isTransitioning={isTransitioning}
        onBranch={handleBranchFrom}
        onSwitchBranch={handleSwitchBranch}
      />
      <Composer onSend={handleSend} />
    </div>
  )
}
