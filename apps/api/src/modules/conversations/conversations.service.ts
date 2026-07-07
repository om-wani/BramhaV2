import {
  Injectable,
  Logger,
  NotFoundException,
  HttpException,
  HttpStatus,
  ConflictException,
  Inject,
} from '@nestjs/common'
import { RlsDbService } from '../common/db/rls-db.service'
import { REDIS_CLIENT } from '../common/redis/redis.module'
import type Redis from 'ioredis'
import type postgres from 'postgres'
import type {
  CreateConversationInput,
  AppendNodeInput,
  ForkInput,
  UpdateBranchInput,
} from '@bramha/shared'
import { EventPublisher, Channels } from '@bramha/event-bus'

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface ConversationDto {
  id: string
  roomId: string
  projectId: string
  title: string | null
  defaultBranchId: string | null
  createdAt: string
  updatedAt: string
  branches: BranchDto[]
}

export interface BranchDto {
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

export interface ConversationNodeDto {
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
  content: unknown
  tokenUsage: unknown
  createdAt: string
}

export interface NodeLinkDto {
  fromNode: string
  toNode: string
  kind: string
}

export interface GraphDto {
  nodes: ConversationNodeDto[]
  edges: NodeLinkDto[]
  branches: BranchDto[]
  /** Composite cursor `<created_at>|<id>` for the next page, or null. */
  nextCursor: string | null
}

export interface SliceDto {
  nodes: ConversationNodeDto[]
  truncated: boolean
}

// ── Row types ─────────────────────────────────────────────────────────────────

interface ConversationRow {
  id: string
  room_id: string
  project_id: string
  title: string | null
  default_branch_id: string | null
  created_at: string
  updated_at: string
}

interface BranchRow {
  id: string
  conversation_id: string
  project_id: string
  name: string
  head_node_id: string
  forked_from_node: string | null
  created_by_kind: string
  created_by_id: string | null
  status: string
  created_at: string
  updated_at: string
}

interface NodeRow {
  id: string
  conversation_id: string
  project_id: string
  parent_id: string | null
  depth: number
  path: string
  type: string
  author_kind: string
  author_user_id: string | null
  author_persona_id: string | null
  content: unknown
  token_usage: unknown
  created_at: string
}

interface NodeLinkRow {
  from_node: string
  to_node: string
  kind: string
}

// ── Mappers ───────────────────────────────────────────────────────────────────

function mapBranch(r: BranchRow): BranchDto {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    projectId: r.project_id,
    name: r.name,
    headNodeId: r.head_node_id,
    forkedFromNode: r.forked_from_node,
    createdByKind: r.created_by_kind,
    createdById: r.created_by_id,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function mapNode(r: NodeRow): ConversationNodeDto {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    projectId: r.project_id,
    parentId: r.parent_id,
    depth: r.depth,
    path: r.path,
    type: r.type,
    authorKind: r.author_kind,
    authorUserId: r.author_user_id,
    authorPersonaId: r.author_persona_id,
    content: r.content,
    tokenUsage: r.token_usage,
    createdAt: r.created_at,
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RATE_LIMIT_MSG_PER_MIN = 20
const IDEMPOTENCY_TTL_SECS = 86400 // 24h
const CONTENT_MAX_BYTES = 32768

/**
 * Atomic INCR + conditional EXPIRE in a single Lua round-trip.
 * Prevents permanent rate-limit keys if the process crashes between INCR and EXPIRE.
 */
const LUA_RATE_LIMIT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], 60)
end
return count
`

type Tx = postgres.TransactionSql

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name)
  private readonly publisher: EventPublisher

  constructor(
    private readonly db: RlsDbService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.publisher = new EventPublisher(redis)
  }

  // ── Rate limiting (atomic Lua) ────────────────────────────────────────────

  private async checkRateLimit(userId: string): Promise<void> {
    const key = `ratelimit:msg:${userId}`
    const count = (await this.redis.eval(LUA_RATE_LIMIT, 1, key)) as number
    if (count > RATE_LIMIT_MSG_PER_MIN) {
      throw new HttpException(
        { statusCode: 429, code: 'rate_limit_exceeded', message: 'Too many messages' },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
  }

  // ── Idempotency ───────────────────────────────────────────────────────────

  private redisIdempotencyKey(userId: string, key: string): string {
    return `idempotency:${userId}:${key}`
  }

  private async getIdempotencyResult(userId: string, key: string): Promise<unknown | null> {
    const val = await this.redis.get(this.redisIdempotencyKey(userId, key))
    if (!val) return null
    return JSON.parse(val) as unknown
  }

  private async setIdempotencyResult(userId: string, key: string, result: unknown): Promise<void> {
    await this.redis.set(
      this.redisIdempotencyKey(userId, key),
      JSON.stringify(result),
      'EX',
      IDEMPOTENCY_TTL_SECS,
    )
  }

  // ── Guard helpers ─────────────────────────────────────────────────────────

  private async assertRoomBelongsToProject(
    tx: Tx,
    roomId: string,
    projectId: string,
  ): Promise<void> {
    const rows = await tx<{ id: string }[]>`
      SELECT id FROM rooms WHERE id = ${roomId} AND project_id = ${projectId}
    `
    if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
  }

  private async assertConvBelongsToRoom(
    tx: Tx,
    convId: string,
    roomId: string,
    projectId: string,
  ): Promise<void> {
    const rows = await tx<{ id: string }[]>`
      SELECT id FROM conversations
      WHERE id = ${convId} AND room_id = ${roomId} AND project_id = ${projectId}
    `
    if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
  }

  // ── Conversation CRUD ─────────────────────────────────────────────────────

  async create(
    userId: string,
    projectId: string,
    roomId: string,
    input: CreateConversationInput,
  ): Promise<ConversationDto> {
    return this.db.run({ userId, projectId }, async (tx) => {
      await this.assertRoomBelongsToProject(tx, roomId, projectId)

      // 1. Insert conversation
      const convRows = await tx<ConversationRow[]>`
        INSERT INTO conversations (room_id, project_id, title)
        VALUES (${roomId}, ${projectId}, ${input.title ?? null})
        RETURNING id, room_id, project_id, title, default_branch_id, created_at, updated_at
      `
      if (!convRows[0]) throw new Error('conversation insert returned no row')
      const conv = convRows[0]

      // 2. Insert root node (no parent; trigger sets depth + path)
      const rootContent = JSON.stringify({
        text: 'Conversation started',
        mentions: [],
        attachments: [],
        meta: {},
      })
      const nodeRows = await tx<NodeRow[]>`
        INSERT INTO conversation_nodes (conversation_id, project_id, type, author_kind, content)
        VALUES (
          ${conv.id},
          ${projectId},
          'system_event',
          'system',
          ${rootContent}::jsonb
        )
        RETURNING id, conversation_id, project_id, parent_id, depth, path::text, type,
                  author_kind, author_user_id, author_persona_id, content, token_usage, created_at
      `
      if (!nodeRows[0]) throw new Error('root node insert returned no row')
      const rootNode = nodeRows[0]

      // 3. Insert 'main' branch pointing at root node
      const branchRows = await tx<BranchRow[]>`
        INSERT INTO branches (conversation_id, project_id, name, head_node_id, created_by_kind, created_by_id)
        VALUES (${conv.id}, ${projectId}, 'main', ${rootNode.id}, 'user', ${userId})
        RETURNING id, conversation_id, project_id, name, head_node_id, forked_from_node,
                  created_by_kind, created_by_id, status, created_at, updated_at
      `
      if (!branchRows[0]) throw new Error('main branch insert returned no row')
      const mainBranch = branchRows[0]

      // 4. Update conversation with default_branch_id
      await tx`
        UPDATE conversations SET default_branch_id = ${mainBranch.id} WHERE id = ${conv.id}
      `

      this.logger.log({
        event: 'conversation.created',
        actorId: userId,
        targetId: conv.id,
        action: 'create',
      })

      return {
        id: conv.id,
        roomId: conv.room_id,
        projectId: conv.project_id,
        title: conv.title,
        defaultBranchId: mainBranch.id,
        createdAt: conv.created_at,
        updatedAt: conv.updated_at,
        branches: [mapBranch(mainBranch)],
      }
    })
  }

  async getById(
    userId: string,
    projectId: string,
    roomId: string,
    convId: string,
  ): Promise<ConversationDto> {
    return this.db.run({ userId, projectId }, async (tx) => {
      await this.assertRoomBelongsToProject(tx, roomId, projectId)

      const convRows = await tx<ConversationRow[]>`
        SELECT id, room_id, project_id, title, default_branch_id, created_at, updated_at
        FROM conversations
        WHERE id = ${convId} AND room_id = ${roomId} AND project_id = ${projectId}
      `
      if (!convRows[0]) throw new NotFoundException({ code: 'not_found' })
      const conv = convRows[0]

      const branchRows = await tx<BranchRow[]>`
        SELECT id, conversation_id, project_id, name, head_node_id, forked_from_node,
               created_by_kind, created_by_id, status, created_at, updated_at
        FROM branches
        WHERE conversation_id = ${convId}
        ORDER BY created_at ASC, id ASC
      `

      return {
        id: conv.id,
        roomId: conv.room_id,
        projectId: conv.project_id,
        title: conv.title,
        defaultBranchId: conv.default_branch_id,
        createdAt: conv.created_at,
        updatedAt: conv.updated_at,
        branches: branchRows.map(mapBranch),
      }
    })
  }

  // ── Append node ───────────────────────────────────────────────────────────

  async appendNode(
    userId: string,
    projectId: string,
    roomId: string,
    convId: string,
    input: AppendNodeInput,
  ): Promise<ConversationNodeDto> {
    // 1. Idempotency check (before any DB work)
    const cached = await this.getIdempotencyResult(userId, input.idempotencyKey)
    if (cached != null) {
      return cached as ConversationNodeDto
    }

    // 2. Rate limit (atomic Lua script — single round-trip, no TTL leak)
    await this.checkRateLimit(userId)

    // 3. Content size guard (UTF-8 bytes, not UTF-16 character count)
    const contentJson = JSON.stringify(input.content)
    if (Buffer.byteLength(contentJson, 'utf8') > CONTENT_MAX_BYTES) {
      throw new HttpException(
        { statusCode: 413, code: 'content_too_large', message: 'Content exceeds 32 kB limit' },
        HttpStatus.PAYLOAD_TOO_LARGE,
      )
    }

    // 4. DB work + idempotency write (inside db.run so write is as close to commit as possible)
    const result = await this.db.run({ userId, projectId }, async (tx) => {
      await this.assertRoomBelongsToProject(tx, roomId, projectId)
      await this.assertConvBelongsToRoom(tx, convId, roomId, projectId)

      // Get current branch state
      const branchRows = await tx<BranchRow[]>`
        SELECT id, conversation_id, project_id, name, head_node_id, forked_from_node,
               created_by_kind, created_by_id, status, created_at, updated_at
        FROM branches
        WHERE id = ${input.branchId} AND conversation_id = ${convId}
      `
      if (!branchRows[0]) throw new NotFoundException({ code: 'branch_not_found' })
      const branch = branchRows[0]

      const currentHeadId = branch.head_node_id
      const parentId = input.parentId ?? currentHeadId
      const authorUserId = input.authorKind === 'user' ? userId : null

      // Insert node (trigger sets depth + path)
      const nodeRows = await tx<NodeRow[]>`
        INSERT INTO conversation_nodes (
          conversation_id, project_id, parent_id, type, author_kind,
          author_user_id, content
        )
        VALUES (
          ${convId},
          ${projectId},
          ${parentId},
          ${input.type},
          ${input.authorKind},
          ${authorUserId},
          ${contentJson}::jsonb
        )
        RETURNING id, conversation_id, project_id, parent_id, depth, path::text, type,
                  author_kind, author_user_id, author_persona_id, content, token_usage, created_at
      `
      if (!nodeRows[0]) throw new Error('node insert returned no row')
      const newNode = nodeRows[0]

      // Optimistic concurrency: advance head only if it hasn't changed
      const advanceResult = await tx<{ id: string }[]>`
        UPDATE branches
        SET    head_node_id = ${newNode.id},
               updated_at   = now()
        WHERE  id            = ${input.branchId}
          AND  head_node_id  = ${currentHeadId}
        RETURNING id
      `

      if (advanceResult.length === 0) {
        // Conflict: head was already advanced — create a collision-resistant parallel branch.
        // Use the new node's UUID prefix so two concurrent transactions never collide on the name.
        const parallelName = `parallel-${newNode.id.slice(0, 8)}`

        await tx`
          INSERT INTO branches (
            conversation_id, project_id, name, head_node_id, forked_from_node,
            created_by_kind, created_by_id
          )
          VALUES (
            ${convId}, ${projectId}, ${parallelName}, ${newNode.id}, ${parentId},
            'user', ${userId}
          )
        `
      }

      const mapped = mapNode(newNode)

      // Write idempotency cache INSIDE db.run — as close to the DB commit as possible.
      // This minimises the crash window between a committed node and a missing cache entry.
      await this.setIdempotencyResult(userId, input.idempotencyKey, mapped)

      return mapped
    })

    this.logger.log({
      event: 'conversation.node_appended',
      actorId: userId,
      targetId: result.id,
      action: 'append_node',
    })

    // Fire-and-forget publish — never fail the main operation on Redis error
    this.publisher
      .publish(Channels.convNodeAppended(projectId), {
        conversationId: convId,
        roomId,
        projectId,
        node: result as unknown as Record<string, unknown>,
      })
      .catch((err: unknown) => {
        this.logger.error({ event: 'event_publish.failed', channel: 'conv.node.appended', err })
      })

    return result
  }

  // ── Fork ──────────────────────────────────────────────────────────────────

  async fork(
    userId: string,
    projectId: string,
    roomId: string,
    convId: string,
    input: ForkInput,
  ): Promise<BranchDto> {
    return this.db.run({ userId, projectId }, async (tx) => {
      await this.assertRoomBelongsToProject(tx, roomId, projectId)
      await this.assertConvBelongsToRoom(tx, convId, roomId, projectId)

      // Verify fromNode belongs to this conversation
      const nodeRows = await tx<{ id: string }[]>`
        SELECT id FROM conversation_nodes WHERE id = ${input.fromNodeId} AND conversation_id = ${convId}
      `
      if (!nodeRows[0]) throw new NotFoundException({ code: 'node_not_found' })

      let branchName = input.name
      if (!branchName) {
        const forkCount = await tx<{ cnt: string }[]>`
          SELECT count(*)::text AS cnt FROM branches
          WHERE conversation_id = ${convId} AND name LIKE 'fork-%'
        `
        branchName = `fork-${Number(forkCount[0]?.cnt ?? '0') + 1}`
      }

      try {
        const rows = await tx<BranchRow[]>`
          INSERT INTO branches (
            conversation_id, project_id, name, head_node_id, forked_from_node,
            created_by_kind, created_by_id
          )
          VALUES (
            ${convId}, ${projectId}, ${branchName}, ${input.fromNodeId}, ${input.fromNodeId},
            'user', ${userId}
          )
          RETURNING id, conversation_id, project_id, name, head_node_id, forked_from_node,
                    created_by_kind, created_by_id, status, created_at, updated_at
        `
        if (!rows[0]) throw new Error('branch insert returned no row')
        this.logger.log({
          event: 'conversation.forked',
          actorId: userId,
          targetId: rows[0].id,
          action: 'fork',
        })
        const forkedBranch = mapBranch(rows[0])

        // Fire-and-forget publish
        this.publisher
          .publish(Channels.convBranchForked(projectId), {
            conversationId: convId,
            roomId,
            projectId,
            branch: forkedBranch as unknown as Record<string, unknown>,
          })
          .catch((err: unknown) => {
            this.logger.error({ event: 'event_publish.failed', channel: 'conv.branch.forked', err })
          })

        return forkedBranch
      } catch (err: unknown) {
        if (
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          (err as { code: string }).code === '23505'
        ) {
          throw new ConflictException({ code: 'branch_name_conflict' })
        }
        throw err
      }
    })
  }

  // ── Graph ─────────────────────────────────────────────────────────────────

  async getGraph(
    userId: string,
    projectId: string,
    roomId: string,
    convId: string,
    opts: {
      cursor?: string | undefined
      limit?: number | undefined
      branchId?: string | undefined
    },
  ): Promise<GraphDto> {
    const limit = Math.min(opts.limit ?? 50, 100)

    // Parse composite cursor `<created_at>|<id>`
    let cursorTs: string | undefined
    let cursorId: string | undefined
    if (opts.cursor) {
      const sep = opts.cursor.indexOf('|')
      if (sep !== -1) {
        cursorTs = opts.cursor.slice(0, sep)
        cursorId = opts.cursor.slice(sep + 1)
      }
    }

    return this.db.run({ userId, projectId }, async (tx) => {
      await this.assertRoomBelongsToProject(tx, roomId, projectId)
      await this.assertConvBelongsToRoom(tx, convId, roomId, projectId)

      let nodeRows: NodeRow[]

      if (opts.branchId) {
        // Get head's ltree path; filter ancestors using @> ("path is ancestor of headPath")
        const headRows = await tx<{ path: string }[]>`
          SELECT cn.path::text AS path
          FROM branches b
          JOIN conversation_nodes cn ON cn.id = b.head_node_id
          WHERE b.id = ${opts.branchId} AND b.conversation_id = ${convId}
        `
        if (!headRows[0]) throw new NotFoundException({ code: 'branch_not_found' })
        const headPath = headRows[0].path

        if (cursorTs && cursorId) {
          nodeRows = await tx<NodeRow[]>`
            SELECT id, conversation_id, project_id, parent_id, depth, path::text, type,
                   author_kind, author_user_id, author_persona_id, content, token_usage, created_at
            FROM conversation_nodes
            WHERE conversation_id = ${convId}
              AND path::ltree @> ${headPath}::ltree
              AND (created_at, id) > (${cursorTs}::timestamptz, ${cursorId}::uuid)
            ORDER BY created_at ASC, id ASC
            LIMIT ${limit + 1}
          `
        } else {
          nodeRows = await tx<NodeRow[]>`
            SELECT id, conversation_id, project_id, parent_id, depth, path::text, type,
                   author_kind, author_user_id, author_persona_id, content, token_usage, created_at
            FROM conversation_nodes
            WHERE conversation_id = ${convId}
              AND path::ltree @> ${headPath}::ltree
            ORDER BY created_at ASC, id ASC
            LIMIT ${limit + 1}
          `
        }
      } else if (cursorTs && cursorId) {
        nodeRows = await tx<NodeRow[]>`
          SELECT id, conversation_id, project_id, parent_id, depth, path::text, type,
                 author_kind, author_user_id, author_persona_id, content, token_usage, created_at
          FROM conversation_nodes
          WHERE conversation_id = ${convId}
            AND (created_at, id) > (${cursorTs}::timestamptz, ${cursorId}::uuid)
          ORDER BY created_at ASC, id ASC
          LIMIT ${limit + 1}
        `
      } else {
        nodeRows = await tx<NodeRow[]>`
          SELECT id, conversation_id, project_id, parent_id, depth, path::text, type,
                 author_kind, author_user_id, author_persona_id, content, token_usage, created_at
          FROM conversation_nodes
          WHERE conversation_id = ${convId}
          ORDER BY created_at ASC, id ASC
          LIMIT ${limit + 1}
        `
      }

      const hasMore = nodeRows.length > limit
      const pageNodes = hasMore ? nodeRows.slice(0, limit) : nodeRows
      const lastNode = pageNodes[pageNodes.length - 1]
      const nextCursor =
        hasMore && lastNode != null ? `${lastNode.created_at}|${lastNode.id}` : null

      // Edges for visible nodes
      const nodeIds = pageNodes.map((n) => n.id)
      let edgeRows: NodeLinkRow[] = []
      if (nodeIds.length > 0) {
        edgeRows = await tx<NodeLinkRow[]>`
          SELECT from_node, to_node, kind
          FROM node_links
          WHERE from_node = ANY(${nodeIds}::uuid[])
        `
      }

      // All branches for this conversation
      const branchRows = await tx<BranchRow[]>`
        SELECT id, conversation_id, project_id, name, head_node_id, forked_from_node,
               created_by_kind, created_by_id, status, created_at, updated_at
        FROM branches
        WHERE conversation_id = ${convId}
        ORDER BY created_at ASC, id ASC
      `

      return {
        nodes: pageNodes.map(mapNode),
        edges: edgeRows.map((e) => ({ fromNode: e.from_node, toNode: e.to_node, kind: e.kind })),
        branches: branchRows.map(mapBranch),
        nextCursor,
      }
    })
  }

  // ── Slice ─────────────────────────────────────────────────────────────────

  async getSlice(
    userId: string,
    projectId: string,
    roomId: string,
    convId: string,
    opts: { branchId: string; tokenBudget?: number | undefined },
  ): Promise<SliceDto> {
    const tokenBudget = opts.tokenBudget ?? 4000

    return this.db.run({ userId, projectId }, async (tx) => {
      await this.assertRoomBelongsToProject(tx, roomId, projectId)
      await this.assertConvBelongsToRoom(tx, convId, roomId, projectId)

      // Get branch head + its ltree path
      const headRows = await tx<{ head_node_id: string; path: string }[]>`
        SELECT b.head_node_id, cn.path::text AS path
        FROM branches b
        JOIN conversation_nodes cn ON cn.id = b.head_node_id
        WHERE b.id = ${opts.branchId} AND b.conversation_id = ${convId}
      `
      if (!headRows[0]) throw new NotFoundException({ code: 'branch_not_found' })
      const { path: headPath } = headRows[0]

      // @> means "path is ancestor of headPath" — returns root → head chain, ordered deepest first
      const ancestorRows = await tx<NodeRow[]>`
        SELECT id, conversation_id, project_id, parent_id, depth, path::text, type,
               author_kind, author_user_id, author_persona_id, content, token_usage, created_at
        FROM conversation_nodes
        WHERE conversation_id = ${convId}
          AND path::ltree @> ${headPath}::ltree
        ORDER BY depth DESC
      `

      // Walk head → root, accumulate until token budget exhausted
      let accumulated = 0
      const selected: NodeRow[] = []
      let truncated = false

      for (const node of ancestorRows) {
        let tokens: number
        if (node.token_usage != null && typeof node.token_usage === 'object') {
          const usage = node.token_usage as Record<string, number>
          tokens = (usage['in'] ?? 0) + (usage['out'] ?? 0)
        } else {
          // Estimate ~4 tokens per character of content JSON
          tokens = Math.ceil(JSON.stringify(node.content).length / 4)
        }

        if (accumulated + tokens > tokenBudget) {
          truncated = true
          break
        }
        accumulated += tokens
        selected.push(node)
      }

      // Reverse to chronological order (root → head)
      selected.reverse()

      return {
        nodes: selected.map(mapNode),
        truncated,
      }
    })
  }

  // ── Branches ──────────────────────────────────────────────────────────────

  async listBranches(
    userId: string,
    projectId: string,
    roomId: string,
    convId: string,
  ): Promise<BranchDto[]> {
    return this.db.run({ userId, projectId }, async (tx) => {
      await this.assertRoomBelongsToProject(tx, roomId, projectId)
      await this.assertConvBelongsToRoom(tx, convId, roomId, projectId)

      const rows = await tx<BranchRow[]>`
        SELECT id, conversation_id, project_id, name, head_node_id, forked_from_node,
               created_by_kind, created_by_id, status, created_at, updated_at
        FROM branches
        WHERE conversation_id = ${convId}
        ORDER BY created_at ASC, id ASC
      `
      return rows.map(mapBranch)
    })
  }

  async updateBranch(
    userId: string,
    projectId: string,
    roomId: string,
    convId: string,
    branchId: string,
    input: UpdateBranchInput,
  ): Promise<BranchDto> {
    return this.db.run({ userId, projectId }, async (tx) => {
      await this.assertRoomBelongsToProject(tx, roomId, projectId)
      await this.assertConvBelongsToRoom(tx, convId, roomId, projectId)

      const current = await tx<{ id: string; name: string; status: string }[]>`
        SELECT id, name, status
        FROM branches
        WHERE id = ${branchId} AND conversation_id = ${convId}
      `
      if (!current[0]) throw new NotFoundException({ code: 'not_found' })

      const newName = input.name ?? current[0].name
      const newStatus = input.status ?? current[0].status

      try {
        const rows = await tx<BranchRow[]>`
          UPDATE branches
          SET    name       = ${newName},
                 status     = ${newStatus},
                 updated_at = now()
          WHERE  id = ${branchId} AND conversation_id = ${convId}
          RETURNING id, conversation_id, project_id, name, head_node_id, forked_from_node,
                    created_by_kind, created_by_id, status, created_at, updated_at
        `
        if (!rows[0]) throw new NotFoundException({ code: 'not_found' })
        this.logger.log({
          event: 'branch.updated',
          actorId: userId,
          targetId: branchId,
          action: 'update',
        })
        const updatedBranch = mapBranch(rows[0])

        // Fire-and-forget publish
        this.publisher
          .publish(Channels.convBranchUpdated(projectId), {
            conversationId: convId,
            roomId,
            projectId,
            branch: updatedBranch as unknown as Record<string, unknown>,
          })
          .catch((err: unknown) => {
            this.logger.error({ event: 'event_publish.failed', channel: 'conv.branch.updated', err })
          })

        return updatedBranch
      } catch (err: unknown) {
        if (
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          (err as { code: string }).code === '23505'
        ) {
          throw new ConflictException({ code: 'branch_name_conflict' })
        }
        throw err
      }
    })
  }
}
