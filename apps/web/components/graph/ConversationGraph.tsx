'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Node as RFNode, NodeProps, Edge as RFEdge } from '@xyflow/react'
import { z } from 'zod'
import { api } from '@/lib/api-client'
import { getSocket } from '@/lib/socket'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { NodeDrawer } from './NodeDrawer'
import { buildGraphElements, layoutGraph, nodePreviewText } from './graphUtils'
import type {
  GraphConversationNode,
  GraphBranch,
  NodeCardData,
  NodeAppendedEvent,
  BranchForkedEvent,
} from './types'

// ── Zod schemas ───────────────────────────────────────────────────────────────

const ConversationNodeSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  branchId: z.string(),
  parentId: z.string().nullable(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.object({ text: z.string(), meta: z.record(z.string(), z.unknown()).optional() }),
  authorId: z.string(),
  authorKind: z.enum(['user', 'agent', 'system']),
  createdAt: z.string(),
})

const GraphPageSchema = z.object({
  nodes: z.array(ConversationNodeSchema),
  nextCursor: z.string().nullable(),
})

const BranchSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  name: z.string(),
  headNodeId: z.string(),
  forkedFromNode: z.string().nullable(),
  createdAt: z.string(),
})

const BranchesSchema = z.array(BranchSchema)

// ── NodeCard (custom node renderer) ──────────────────────────────────────────

const ROLE_ICON: Record<string, string> = {
  user: '👤',
  assistant: '🤖',
  system: '⚙',
}

const ROLE_COLOR: Record<string, string> = {
  user: 'text-blue-400',
  assistant: 'text-emerald-400',
  system: 'text-muted-foreground',
}

// In @xyflow/react v12 NodeProps takes the full Node type (not the data type).
// NodeProps<RFNode<NodeCardData>> → data: NodeCardData (via NodeType['data'])
function NodeCard({ data, selected }: NodeProps<RFNode<NodeCardData>>) {
  const { node, branchHead, isNew } = data as NodeCardData
  const preview = nodePreviewText(node, 80)

  return (
    <div
      data-new={isNew ? 'true' : undefined}
      className={cn(
        'relative w-[220px] rounded-xl border bg-card px-3 py-2 shadow-sm',
        'transition-all duration-300',
        'data-[new=true]:animate-[fadeIn_0.4s_ease]',
        selected ? 'border-primary ring-1 ring-primary' : 'border-border',
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />

      <div className="flex items-center gap-1.5">
        <span aria-hidden="true" className="text-base">
          {ROLE_ICON[node.role] ?? '⚙'}
        </span>
        <span className={cn('text-xs font-semibold capitalize', ROLE_COLOR[node.role])}>
          {node.role}
        </span>
        {branchHead && (
          <Badge variant="secondary" className="ml-auto text-[9px]">
            {branchHead.name}
          </Badge>
        )}
      </div>

      <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
        {preview || <span className="italic opacity-50">(empty)</span>}
      </p>

      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  )
}

const nodeTypes = { conversationNode: NodeCard }

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_LIMIT = 100
const MAX_NODES = 500

// ── ConversationGraph ─────────────────────────────────────────────────────────

export interface ConversationGraphProps {
  projectId: string
  roomId: string
  conversationId: string
}

export function ConversationGraph({
  projectId,
  roomId,
  conversationId,
}: ConversationGraphProps) {
  // v12: pass the full Node type (not just data type) to useNodesState
  const [rfNodes, setRFNodes, onNodesChange] = useNodesState<RFNode<NodeCardData>>([])
  // v12: explicit Edge type to avoid never[] inference from empty initial array
  const [rfEdges, setRFEdges, onEdgesChange] = useEdgesState<RFEdge>([])

  const [branches, setBranches] = useState<GraphBranch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [remaining, setRemaining] = useState(0)

  // Selected node for the drawer
  const [selectedNode, setSelectedNode] = useState<GraphConversationNode | null>(null)
  const [selectedBranchHead, setSelectedBranchHead] = useState<GraphBranch | undefined>(
    undefined,
  )

  // Mutable ref to the API nodes map (avoids stale closures in socket callbacks)
  const apiNodesRef = useRef<Map<string, GraphConversationNode>>(new Map())
  const branchesRef = useRef<GraphBranch[]>([])

  // ── Initial data load ─────────────────────────────────────────────────────

  const base = `/projects/${projectId}/rooms/${roomId}/conversations/${conversationId}`

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      try {
        // Fetch branches and first page in parallel
        const [branchResult, firstPage] = await Promise.all([
          api.get(`${base}/branches`, BranchesSchema),
          api.get(`${base}/graph?limit=${PAGE_LIMIT}`, GraphPageSchema),
        ])

        if (cancelled) return

        // Cast needed: Zod v4 .optional() includes `undefined` in the inferred
        // type, which conflicts with exactOptionalPropertyTypes. The Zod schema
        // validates the shape at runtime so the cast is safe.
        const allNodes = [...firstPage.nodes] as GraphConversationNode[]
        let cursor = firstPage.nextCursor

        // Fetch remaining pages up to MAX_NODES (parallel where possible)
        while (cursor && allNodes.length < MAX_NODES) {
          const remaining = MAX_NODES - allNodes.length
          const limit = Math.min(PAGE_LIMIT, remaining)
          const page = await api.get(
            `${base}/graph?cursor=${encodeURIComponent(cursor)}&limit=${limit}`,
            GraphPageSchema,
          )
          if (cancelled) return
          allNodes.push(...(page.nodes as GraphConversationNode[]))
          cursor = page.nextCursor
          if (allNodes.length >= MAX_NODES) break
        }

        if (cancelled) return

        // Store in mutable ref
        apiNodesRef.current = new Map(allNodes.map((n) => [n.id, n]))
        branchesRef.current = branchResult

        setBranches(branchResult)
        setNextCursor(cursor)
        if (cursor) {
          // Count is unknown — show a conservative remaining estimate
          setRemaining(MAX_NODES)
        }

        // Build and layout the graph
        const { rfNodes: rn, rfEdges: re } = buildGraphElements(allNodes, branchResult)
        const laid = layoutGraph(rn, re)
        setRFNodes(laid.nodes)
        setRFEdges(laid.edges)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load graph')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [projectId, roomId, conversationId])

  // ── Realtime ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    function onNodeAppended(evt: NodeAppendedEvent) {
      if (evt.conversationId !== conversationId) return

      const newNode: GraphConversationNode = {
        id: evt.nodeId,
        conversationId: evt.conversationId,
        branchId: evt.branchId,
        parentId: evt.parentId,
        role: evt.role,
        content: evt.content,
        authorId: evt.authorId,
        authorKind: 'user',
        createdAt: evt.createdAt,
      }

      apiNodesRef.current.set(newNode.id, newNode)
      const allNodes = Array.from(apiNodesRef.current.values())
      const { rfNodes: rn, rfEdges: re } = buildGraphElements(allNodes, branchesRef.current)
      const laid = layoutGraph(rn, re)
      // Mark the newly inserted node so CSS can fade it in
      const withNew = laid.nodes.map((n) =>
        n.id === newNode.id ? { ...n, data: { ...n.data, isNew: true } } : n,
      )
      setRFNodes(withNew)
      setRFEdges(laid.edges)
    }

    function onBranchForked(evt: BranchForkedEvent) {
      if (evt.conversationId !== conversationId) return

      const newBranch: GraphBranch = {
        id: evt.branchId,
        conversationId: evt.conversationId,
        name: evt.name,
        headNodeId: evt.fromNodeId,
        forkedFromNode: evt.fromNodeId,
        createdAt: new Date().toISOString(),
      }

      branchesRef.current = [...branchesRef.current, newBranch]
      setBranches(branchesRef.current)

      // Rebuild to apply branch-head badge and fork edge
      const allNodes = Array.from(apiNodesRef.current.values())
      const { rfNodes: rn, rfEdges: re } = buildGraphElements(
        allNodes,
        branchesRef.current,
      )
      const laid = layoutGraph(rn, re)
      setRFNodes(laid.nodes)
      setRFEdges(laid.edges)
    }

    socket.on('conv.node.appended', onNodeAppended)
    socket.on('conv.branch.forked', onBranchForked)

    return () => {
      socket.off('conv.node.appended', onNodeAppended)
      socket.off('conv.branch.forked', onBranchForked)
    }
  }, [conversationId, setRFEdges, setRFNodes])

  // ── Load more ─────────────────────────────────────────────────────────────

  async function handleLoadMore() {
    if (!nextCursor) return
    try {
      const page = await api.get(
        `${base}/graph?cursor=${encodeURIComponent(nextCursor)}&limit=${PAGE_LIMIT}`,
        GraphPageSchema,
      )

      for (const n of page.nodes as GraphConversationNode[]) {
        apiNodesRef.current.set(n.id, n)
      }

      setNextCursor(page.nextCursor)
      if (!page.nextCursor) setRemaining(0)

      const allNodes = Array.from(apiNodesRef.current.values())
      const { rfNodes: rn, rfEdges: re } = buildGraphElements(allNodes, branchesRef.current)
      const laid = layoutGraph(rn, re)
      setRFNodes(laid.nodes)
      setRFEdges(laid.edges)
    } catch (e) {
      console.error('[ConversationGraph] load more failed', e)
    }
  }

  // ── Node click ────────────────────────────────────────────────────────────

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, rfNode: RFNode) => {
      const apiNode = apiNodesRef.current.get(rfNode.id)
      if (!apiNode) return
      setSelectedNode(apiNode)
      const head = branchesRef.current.find((b) => b.headNodeId === apiNode.id)
      setSelectedBranchHead(head)
    },
    [],
  )

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-full flex-col gap-3 p-4" aria-busy="true" aria-label="Loading graph">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      </div>
    )
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* Load-more banner (subtree pagination) */}
      {nextCursor && (
        <div className="flex items-center justify-center border-b border-border bg-card py-2">
          <button
            onClick={handleLoadMore}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            Load more nodes…
          </button>
          {remaining > 0 && (
            <span className="ml-2 text-xs text-muted-foreground">
              (showing first {rfNodes.length})
            </span>
          )}
        </div>
      )}

      {/* React Flow canvas */}
      <div className="flex-1" aria-label="Conversation graph canvas">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          onNodeClick={handleNodeClick}
          fitView
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="hsl(var(--muted-foreground) / 0.3)" />
          <Controls />
          <MiniMap
            nodeColor={(n) => {
              const role = (n.data as NodeCardData).node?.role
              if (role === 'user') return '#60a5fa'
              if (role === 'assistant') return '#34d399'
              return 'hsl(var(--muted-foreground))'
            }}
          />
        </ReactFlow>
      </div>

      {/* Node detail drawer */}
      <NodeDrawer
        node={selectedNode}
        branchHead={selectedBranchHead}
        branches={branches}
        projectId={projectId}
        roomId={roomId}
        conversationId={conversationId}
        onClose={() => setSelectedNode(null)}
      />
    </div>
  )
}
