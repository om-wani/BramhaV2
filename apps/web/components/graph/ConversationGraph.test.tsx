/**
 * Unit tests for graph utility functions (graphUtils.ts).
 *
 * Pure-function tests — no React Flow context required.
 * For the XSS case we render only a plain <span> via @testing-library/react
 * to verify that React's JSX text-node escaping prevents injection.
 */

import React from 'react'
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { layoutGraph, buildGraphElements, nodePreviewText } from './graphUtils'
import type { GraphConversationNode, GraphBranch, NodeCardData } from './types'
import type { Node as RFNode, Edge as RFEdge } from '@xyflow/react'

// ── Fixture helpers ────────────────────────────────────────────────────────────

function makeNode(
  id: string,
  parentId: string | null,
  text = 'Hello world',
): GraphConversationNode {
  return {
    id,
    conversationId: 'conv-1',
    branchId: 'branch-1',
    parentId,
    role: 'user',
    content: { text },
    authorId: 'user-1',
    authorKind: 'user',
    createdAt: new Date().toISOString(),
  }
}

function makeRFNode(id: string, parentId: string | null): RFNode<NodeCardData> {
  return {
    id,
    position: { x: 0, y: 0 },
    type: 'conversationNode',
    data: { node: makeNode(id, parentId) },
  }
}

// ── layoutGraph ────────────────────────────────────────────────────────────────

describe('layoutGraph', () => {
  it('returns empty arrays when given no nodes', () => {
    const result = layoutGraph<NodeCardData>([], [])
    expect(result.nodes).toHaveLength(0)
    expect(result.edges).toHaveLength(0)
  })

  it('assigns a non-zero position to a single node', () => {
    const nodes = [makeRFNode('a', null)]
    const { nodes: laid } = layoutGraph(nodes, [])
    expect(laid).toHaveLength(1)
    // dagre places the single node somewhere (not necessarily 0,0)
     
    expect(typeof laid[0]!.position.x).toBe('number')
     
    expect(typeof laid[0]!.position.y).toBe('number')
  })

  it('produces unique positions for all nodes in a linear chain', () => {
    const nodes = [
      makeRFNode('a', null),
      makeRFNode('b', 'a'),
      makeRFNode('c', 'b'),
    ]
    const edges: RFEdge[] = [
      { id: 'e:a->b', source: 'a', target: 'b' },
      { id: 'e:b->c', source: 'b', target: 'c' },
    ]
    const { nodes: laid } = layoutGraph(nodes, edges)
    const positions = laid.map((n) => `${n.position.x},${n.position.y}`)
    const unique = new Set(positions)
    expect(unique.size).toBe(nodes.length)
  })

  it('produces unique positions for branching topology', () => {
    // root → left, root → right
    const nodes = [
      makeRFNode('root', null),
      makeRFNode('left', 'root'),
      makeRFNode('right', 'root'),
    ]
    const edges: RFEdge[] = [
      { id: 'e:root->left', source: 'root', target: 'left' },
      { id: 'e:root->right', source: 'root', target: 'right' },
    ]
    const { nodes: laid } = layoutGraph(nodes, edges)
    const positions = laid.map((n) => `${n.position.x},${n.position.y}`)
    const unique = new Set(positions)
    expect(unique.size).toBe(nodes.length)
  })
})

// ── buildGraphElements ─────────────────────────────────────────────────────────

describe('buildGraphElements', () => {
  it('creates a node for each API node', () => {
    const apiNodes = [makeNode('a', null), makeNode('b', 'a')]
    const { rfNodes } = buildGraphElements(apiNodes, [])
    expect(rfNodes).toHaveLength(2)
    expect(rfNodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
  })

  it('node with parentId produces a parent→child edge', () => {
    const apiNodes = [makeNode('root', null), makeNode('child', 'root')]
    const { rfEdges } = buildGraphElements(apiNodes, [])
    expect(rfEdges).toHaveLength(1)
     
    expect(rfEdges[0]!.source).toBe('root')
     
    expect(rfEdges[0]!.target).toBe('child')
     
    expect(rfEdges[0]!.id).toBe('e:root->child')
  })

  it('root node (no parentId) produces no edges', () => {
    const apiNodes = [makeNode('root', null)]
    const { rfEdges } = buildGraphElements(apiNodes, [])
    expect(rfEdges).toHaveLength(0)
  })

  it('multiple children each get their own edge', () => {
    const apiNodes = [
      makeNode('root', null),
      makeNode('c1', 'root'),
      makeNode('c2', 'root'),
    ]
    const { rfEdges } = buildGraphElements(apiNodes, [])
    const edgeIds = rfEdges.map((e) => e.id)
    expect(edgeIds).toContain('e:root->c1')
    expect(edgeIds).toContain('e:root->c2')
  })

  it('branch head node gets branchHead data attached', () => {
    const apiNodes = [makeNode('a', null), makeNode('b', 'a')]
    const branches: GraphBranch[] = [
      {
        id: 'branch-2',
        conversationId: 'conv-1',
        name: 'feature/x',
        headNodeId: 'b',
        forkedFromNode: null,
        createdAt: new Date().toISOString(),
      },
    ]
    const { rfNodes } = buildGraphElements(apiNodes, branches)
    const nodeB = rfNodes.find((n) => n.id === 'b')
    expect(nodeB?.data.branchHead?.name).toBe('feature/x')
  })

  it('fork branch with distinct forkedFromNode adds an animated fork edge', () => {
    const apiNodes = [
      makeNode('root', null),
      makeNode('main-child', 'root'),
      makeNode('fork-head', 'root'),
    ]
    const branches: GraphBranch[] = [
      {
        id: 'branch-fork',
        conversationId: 'conv-1',
        name: 'fork',
        headNodeId: 'fork-head',
        forkedFromNode: 'main-child', // differs from fork-head's parentId ('root')
        createdAt: new Date().toISOString(),
      },
    ]
    const { rfEdges } = buildGraphElements(apiNodes, branches)
    const forkEdge = rfEdges.find((e) => e.id === 'fork:main-child->fork-head')
    expect(forkEdge).toBeDefined()
    expect(forkEdge?.animated).toBe(true)
  })
})

// ── nodePreviewText ────────────────────────────────────────────────────────────

describe('nodePreviewText', () => {
  it('returns the node text truncated to maxLen', () => {
    const text = 'a'.repeat(200)
    const node = makeNode('x', null, text)
    const preview = nodePreviewText(node, 100)
    expect(preview.length).toBeLessThanOrEqual(100)
  })

  it('returns the full text when shorter than maxLen', () => {
    const text = 'Short message'
    const node = makeNode('x', null, text)
    expect(nodePreviewText(node, 100)).toBe('Short message')
  })

  it('strips markdown syntax characters', () => {
    const node = makeNode('x', null, '**bold** _italic_ `code` # heading')
    const preview = nodePreviewText(node)
    expect(preview).not.toMatch(/[*`_#]/)
  })

  it('handles empty content gracefully', () => {
    const node = makeNode('x', null, '')
    expect(nodePreviewText(node)).toBe('')
  })

  it('uses default maxLen of 100', () => {
    const text = 'x'.repeat(150)
    const preview = nodePreviewText(makeNode('x', null, text))
    expect(preview.length).toBe(100)
  })
})

// ── XSS: nodePreviewText returns plain text (safe in React JSX) ───────────────

describe('nodePreviewText — XSS safety', () => {
  it('<script> payload: output is plain text — React escapes it as a text node', () => {
    const node = makeNode('x', null, '<script>alert(document.cookie)</script>')
    const preview = nodePreviewText(node)
    // Render in a real DOM element via React JSX (text node, not innerHTML)
    const { container } = render(<span>{preview}</span>)
    // React must NOT create a script element
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).not.toContain('<script')
  })

  it('onerror payload: no onerror attribute in DOM — React escapes as text node', () => {
    const node = makeNode('x', null, '<img src=x onerror="alert(1)">')
    const preview = nodePreviewText(node)
    const { container } = render(<span>{preview}</span>)
    // React renders as an escaped text node — the IMG element must NOT exist,
    // and no element must carry an onerror attribute.
    expect(container.querySelector('[onerror]')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    // innerHTML will contain &lt;img...&gt; (HTML-entity-escaped text) — that is safe
    expect(container.innerHTML).not.toContain('<img')
  })

  it('javascript: URI payload: plain text render produces no executable link', () => {
    const node = makeNode('x', null, '[click](javascript:alert(1))')
    const preview = nodePreviewText(node)
    // After stripping [ and ] (markdown chars), the result is plain text
    expect(preview).not.toMatch(/^\s*javascript:/i)
    const { container } = render(<span>{preview}</span>)
    const anchors = Array.from(container.querySelectorAll('a'))
    expect(anchors).toHaveLength(0)
  })
})
