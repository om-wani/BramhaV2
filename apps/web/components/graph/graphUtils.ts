/**
 * Pure data-transformation utilities for the conversation graph view.
 * No React or React Flow imports — fully unit-testable in isolation.
 */
import dagre from 'dagre'
import type { Node as RFNode, Edge as RFEdge } from '@xyflow/react'
import type { GraphConversationNode, GraphBranch, NodeCardData } from './types'

export type { GraphConversationNode, GraphBranch, NodeCardData }

// ── Node dimensions used for dagre ────────────────────────────────────────────

const NODE_WIDTH = 220
const NODE_HEIGHT = 88

// ── Build React Flow elements from API data ───────────────────────────────────

/**
 * Convert API nodes and branches into React Flow nodes and edges.
 * Branch-head connections use a dashed stroke to distinguish them from
 * normal parent→child edges.
 */
export function buildGraphElements(
  apiNodes: GraphConversationNode[],
  branches: GraphBranch[],
): { rfNodes: RFNode<NodeCardData>[]; rfEdges: RFEdge[] } {
  // Map branchId → branch for head-node badge lookups
  const branchByHead = new Map<string, GraphBranch>()
  for (const b of branches) {
    branchByHead.set(b.headNodeId, b)
  }

  const rfNodes: RFNode<NodeCardData>[] = apiNodes.map((n) => {
    const branchHead = branchByHead.get(n.id)
    return {
      id: n.id,
      position: { x: 0, y: 0 }, // will be overwritten by layoutGraph
      type: 'conversationNode',
      data: {
        node: n,
        // Conditional spread: do not set branchHead to undefined (exactOptionalPropertyTypes)
        ...(branchHead !== undefined ? { branchHead } : {}),
      },
    }
  })

  const rfEdges: RFEdge[] = []

  // Parent→child edges
  for (const n of apiNodes) {
    if (n.parentId) {
      rfEdges.push({
        id: `e:${n.parentId}->${n.id}`,
        source: n.parentId,
        target: n.id,
        style: { stroke: 'hsl(var(--muted-foreground))' },
      })
    }
  }

  // Branch fork edges: forkedFromNode → branch head
  // Only if forkedFromNode differs from parentId (avoids duplicate edges)
  for (const b of branches) {
    if (b.forkedFromNode && b.forkedFromNode !== findParentId(apiNodes, b.headNodeId)) {
      rfEdges.push({
        id: `fork:${b.forkedFromNode}->${b.headNodeId}`,
        source: b.forkedFromNode,
        target: b.headNodeId,
        animated: true,
        style: { stroke: 'hsl(var(--primary))', strokeDasharray: '4 2' },
      })
    }
  }

  return { rfNodes, rfEdges }
}

function findParentId(nodes: GraphConversationNode[], nodeId: string): string | null {
  return nodes.find((n) => n.id === nodeId)?.parentId ?? null
}

// ── Dagre layout ──────────────────────────────────────────────────────────────

/**
 * Compute dagre top-to-bottom layout and return positioned React Flow nodes.
 * Edges are returned unchanged (React Flow uses source/target, not positions).
 */
export function layoutGraph<T extends NodeCardData>(
  nodes: RFNode<T>[],
  edges: RFEdge[],
): { nodes: RFNode<T>[]; edges: RFEdge[] } {
  if (nodes.length === 0) return { nodes, edges }

  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', ranksep: 80, nodesep: 40 })

  nodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }))
  // Only add edges whose source and target are both in the node set
  const nodeIds = new Set(nodes.map((n) => n.id))
  edges.forEach((e) => {
    if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
      g.setEdge(e.source, e.target)
    }
  })

  dagre.layout(g)

  return {
    nodes: nodes.map((n) => {
      const { x, y } = g.node(n.id)
      return { ...n, position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 } }
    }),
    edges,
  }
}

// ── Text preview helper ───────────────────────────────────────────────────────

/**
 * Extract a plain-text preview from node content.
 * Deliberately plain text (no HTML) — safe in NodeCard without sanitization.
 */
export function nodePreviewText(node: GraphConversationNode, maxLen = 100): string {
  const raw =
    typeof node.content === 'object' && node.content !== null
      ? (node.content as { text?: string }).text ?? ''
      : String(node.content ?? '')
  // Strip markdown syntax characters from preview to keep it visually clean
  return raw.replace(/[#*`_~[\]]/g, '').slice(0, maxLen)
}
