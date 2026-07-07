/**
 * Shared domain types for the graph view.
 * These mirror the API shapes from T2.1.2 (conversation service).
 */

export interface GraphConversationNode {
  id: string
  conversationId: string
  branchId: string
  parentId: string | null
  role: 'user' | 'assistant' | 'system'
  content: { text: string; meta?: Record<string, unknown> }
  authorId: string
  authorKind: 'user' | 'agent' | 'system'
  createdAt: string
}

export interface GraphBranch {
  id: string
  conversationId: string
  name: string
  headNodeId: string
  forkedFromNode: string | null
  createdAt: string
}

/**
 * Data payload stored on each React Flow node.
 *
 * Declared as a type alias + Record intersection so that it satisfies the
 * `T extends Record<string, unknown>` constraint on @xyflow/react's Node<T>.
 */
export type NodeCardData = {
  node: GraphConversationNode
  /** Set only when this node is the head of a branch. */
  branchHead?: GraphBranch
  /** True for nodes inserted via realtime events (triggers CSS fade-in). */
  isNew?: boolean
} & Record<string, unknown>

/** Realtime event payloads emitted by the server (T2.1.3). */
export interface NodeAppendedEvent {
  projectId: string
  roomId: string
  conversationId: string
  nodeId: string
  parentId: string | null
  branchId: string
  role: 'user' | 'assistant' | 'system'
  content: { text: string; meta?: Record<string, unknown> }
  authorId: string
  createdAt: string
}

export interface BranchForkedEvent {
  projectId: string
  roomId: string
  conversationId: string
  branchId: string
  name: string
  fromNodeId: string
}
