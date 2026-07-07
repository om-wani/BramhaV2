import { create } from 'zustand'

// ── Domain types ───────────────────────────────────────────────────────────────

export interface NodeContent {
  text: string
  mentions?: string[]
  attachments?: Array<{ fileId: string; name: string }>
  meta?: Record<string, unknown>
}

export interface ConversationNode {
  id: string
  conversationId: string
  projectId: string
  parentId: string | null
  depth: number
  path: string
  type: string
  authorKind: string
  authorUserId: string | null
  authorPersonaId: string | null
  content: NodeContent
  tokenUsage: unknown
  createdAt: string
}

export interface Branch {
  id: string
  conversationId: string
  projectId: string
  name: string
  headNodeId: string
  forkedFromNode: string | null
  createdByKind: string
  createdById: string | null
  status: string
  createdAt: string
  updatedAt: string
}

// ── SessionStorage helpers ─────────────────────────────────────────────────────

function getStoredBranchId(conversationId: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem(`bramha:branch:${conversationId}`)
  } catch {
    return null
  }
}

function storeActiveBranchId(conversationId: string, branchId: string): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(`bramha:branch:${conversationId}`, branchId)
  } catch {
    // Quota exceeded or private-browsing — ignore
  }
}

// ── Store interface ────────────────────────────────────────────────────────────

interface ChatState {
  /** Flat map of all loaded nodes keyed by id. */
  nodes: Map<string, ConversationNode>
  /** Ordered list of node ids for the currently active branch. */
  nodeOrder: string[]
  branches: Branch[]
  activeBranchId: string | null
  conversationId: string | null
  isConnected: boolean
  /**
   * Map of currently-typing users: userId → displayName.
   * Using a Map keyed on userId ensures a user's entry is always
   * updated/removed by a stable identity, even if their displayName changes.
   */
  typingUsers: Map<string, string>

  // Actions
  setConversation: (conversationId: string, branches: Branch[]) => void
  addNode: (node: ConversationNode) => void
  setNodes: (nodes: ConversationNode[]) => void
  setBranches: (branches: Branch[]) => void
  setActiveBranch: (branchId: string) => void
  addBranch: (branch: Branch) => void
  updateBranch: (branch: Branch) => void
  setConnected: (connected: boolean) => void
  /**
   * Add or remove a user from the typing indicator map.
   * Key is always userId; displayName is stored for rendering.
   * `active: true` upserts the entry; `active: false` removes it.
   */
  setTyping: (userId: string, displayName: string, active: boolean) => void
  reset: () => void
}

// ── Store ──────────────────────────────────────────────────────────────────────

const emptyState = {
  nodes: new Map<string, ConversationNode>(),
  nodeOrder: [] as string[],
  branches: [] as Branch[],
  activeBranchId: null as string | null,
  conversationId: null as string | null,
  isConnected: false,
  typingUsers: new Map<string, string>(),
}

export const useChatStore = create<ChatState>((set, get) => ({
  ...emptyState,

  /**
   * Initialise the store for a conversation.  Restores the active branch from
   * sessionStorage when available; falls back to the 'main' branch.
   */
  setConversation: (conversationId, branches) => {
    const stored = getStoredBranchId(conversationId)
    const mainBranch = branches.find((b) => b.name === 'main') ?? branches[0]
    const activeBranchId =
      stored && branches.some((b) => b.id === stored) ? stored : (mainBranch?.id ?? null)
    set({
      conversationId,
      branches,
      activeBranchId,
      nodes: new Map(),
      nodeOrder: [],
    })
  },

  /** Append a single node to the end of the current list (from realtime events). */
  addNode: (node) => {
    set((state) => {
      const nodes = new Map(state.nodes)
      nodes.set(node.id, node)
      const nodeOrder = state.nodeOrder.includes(node.id)
        ? state.nodeOrder
        : [...state.nodeOrder, node.id]
      return { nodes, nodeOrder }
    })
  },

  /** Replace the node list wholesale (initial load / branch switch). */
  setNodes: (nodes) => {
    const map = new Map<string, ConversationNode>()
    const order: string[] = []
    for (const n of nodes) {
      map.set(n.id, n)
      order.push(n.id)
    }
    set({ nodes: map, nodeOrder: order })
  },

  setBranches: (branches) => set({ branches }),

  /**
   * Switch to a different branch.  Clears loaded nodes so the caller can
   * fetch the new branch's slice.  Persists selection to sessionStorage.
   */
  setActiveBranch: (branchId) => {
    set({ activeBranchId: branchId, nodes: new Map(), nodeOrder: [] })
    const { conversationId } = get()
    if (conversationId) storeActiveBranchId(conversationId, branchId)
  },

  addBranch: (branch) =>
    set((state) => ({ branches: [...state.branches, branch] })),

  updateBranch: (branch) =>
    set((state) => ({
      branches: state.branches.map((b) => (b.id === branch.id ? branch : b)),
    })),

  setConnected: (connected) => set({ isConnected: connected }),

  setTyping: (userId, displayName, active) =>
    set((state) => {
      const next = new Map(state.typingUsers)
      if (active) {
        next.set(userId, displayName)
      } else {
        next.delete(userId)
      }
      return { typingUsers: next }
    }),

  reset: () => set({ ...emptyState, nodes: new Map(), nodeOrder: [], typingUsers: new Map() }),
}))
