import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { and, eq } from 'drizzle-orm';
import {
  getDb,
  projectMembers,
  rooms,
  conversationNodes,
  branches,
} from '@bramha/db';
import type { NodeCreatedEvent, BranchCreatedEvent } from '@bramha/shared';
import { AuthService } from '../modules/auth/auth.service.js';
import { eventBus } from '@bramha/event-bus';

// ---------------------------------------------------------------------------
// Utility: parse the cookie header string into a key→value map
// ---------------------------------------------------------------------------
function parseCookieHeader(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader.split(';').flatMap((c) => {
      const idx = c.indexOf('=');
      if (idx === -1) return [];
      const k = c.slice(0, idx).trim();
      const v = c.slice(idx + 1).trim();
      return k ? ([[k, v]] as [string, string][]) : [];
    }),
  );
}

// ---------------------------------------------------------------------------
// UUID guard
// ---------------------------------------------------------------------------
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s: unknown): s is string {
  return typeof s === 'string' && UUID_RE.test(s);
}

// ---------------------------------------------------------------------------
// Socket user type stored in socket.data
// ---------------------------------------------------------------------------
interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
}

interface SocketData {
  user?: AuthenticatedUser;
}

type AuthSocket = Socket & { data: SocketData };

// ---------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------
@WebSocketGateway({
  cors: {
    origin: process.env['APP_ORIGIN'] ?? 'http://localhost:3000',
    credentials: true,
  },
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(EventsGateway.name);

  private readonly unsubs: Array<() => void> = [];

  constructor(private readonly authService: AuthService) {}

  // -------------------------------------------------------------------------
  // Lifecycle: wire up internal event-bus subscriptions
  // -------------------------------------------------------------------------
  afterInit() {
    // --- node.created ---
    const unsubNode = eventBus.on('node.created', async (event) => {
      const { projectId, roomId, nodeId, branchId } = event;

      try {
        const db = await getDb();
        const [node] = await db
          .select({
            id: conversationNodes.id,
            parentId: conversationNodes.parentId,
            authorType: conversationNodes.authorType,
            userId: conversationNodes.userId,
            persona: conversationNodes.persona,
            content: conversationNodes.content,
            metadata: conversationNodes.metadata,
            createdAt: conversationNodes.createdAt,
          })
          .from(conversationNodes)
          .where(eq(conversationNodes.id, nodeId));

        const nodeEvent: NodeCreatedEvent = {
          type: 'node:created',
          node: {
            id: node?.id ?? nodeId,
            roomId,
            projectId,
            parentId: node?.parentId ?? null,
            authorType: (node?.authorType ?? 'system') as NodeCreatedEvent['node']['authorType'],
            userId: node?.userId ?? null,
            persona: node?.persona ?? null,
            content: node?.content ?? '',
            metadata: (node?.metadata ?? {}) as Record<string, unknown>,
            createdAt: node?.createdAt?.toISOString() ?? new Date().toISOString(),
          },
        };
        this.server.to(`room:${roomId}`).emit('node:created', nodeEvent);
        this.logger.debug(`[node.created] fan-out nodeId=${nodeId} branchId=${branchId} room=${roomId}`);
      } catch (err) {
        this.logger.error(`[node.created] DB lookup failed for nodeId=${nodeId}`, err);
      }
    });

    // --- branch.created ---
    const unsubBranch = eventBus.on('branch.created', async (event) => {
      const { projectId, roomId, branchId } = event;

      try {
        const db = await getDb();
        const [branch] = await db
          .select({
            id: branches.id,
            name: branches.name,
            headNodeId: branches.headNodeId,
            forkedFromNodeId: branches.forkedFromNodeId,
            createdBy: branches.createdBy,
            createdAt: branches.createdAt,
          })
          .from(branches)
          .where(eq(branches.id, branchId));

        const branchEvent: BranchCreatedEvent = {
          type: 'branch:created',
          branch: {
            id: branch?.id ?? branchId,
            roomId,
            projectId,
            name: branch?.name ?? '',
            headNodeId: branch?.headNodeId ?? null,
            forkedFromNodeId: branch?.forkedFromNodeId ?? null,
            createdBy: branch?.createdBy ?? '',
            createdAt: branch?.createdAt?.toISOString() ?? new Date().toISOString(),
          },
        };
        this.server.to(`room:${roomId}`).emit('branch:created', branchEvent);
        this.logger.debug(`[branch.created] fan-out branchId=${branchId} room=${roomId}`);
      } catch (err) {
        this.logger.error(`[branch.created] DB lookup failed for branchId=${branchId}`, err);
      }
    });

    this.unsubs.push(unsubNode, unsubBranch);
    this.logger.log('EventsGateway initialized — event-bus subscriptions active');
  }

  // -------------------------------------------------------------------------
  // Connection: authenticate via session cookie
  // -------------------------------------------------------------------------
  async handleConnection(socket: AuthSocket) {
    const cookieHeader = socket.handshake.headers['cookie'];
    const cookies = parseCookieHeader(cookieHeader);
    const rawToken = cookies['bramha_session'];

    if (!rawToken) {
      this.logger.warn(`[connect] no session cookie — disconnecting ${socket.id}`);
      socket.disconnect();
      return;
    }

    try {
      const user = await this.authService.validateSession(rawToken);
      socket.data.user = user;
      this.logger.debug(`[connect] authenticated userId=${user.id} socket=${socket.id}`);
    } catch {
      this.logger.warn(`[connect] invalid session — disconnecting ${socket.id}`);
      socket.disconnect();
    }
  }

  // -------------------------------------------------------------------------
  // Disconnect
  // -------------------------------------------------------------------------
  handleDisconnect(socket: AuthSocket) {
    const userId = socket.data.user?.id ?? 'unauthenticated';
    this.logger.debug(`[disconnect] userId=${userId} socket=${socket.id}`);
  }

  // -------------------------------------------------------------------------
  // room:join — validate membership then add socket to room
  // -------------------------------------------------------------------------
  @SubscribeMessage('room:join')
  async handleRoomJoin(
    @ConnectedSocket() socket: AuthSocket,
    @MessageBody() data: unknown,
  ) {
    const user = socket.data.user;
    if (!user) {
      socket.emit('error:room', { code: 'UNAUTHORIZED' });
      return;
    }

    if (
      !data ||
      typeof data !== 'object' ||
      !isUuid((data as Record<string, unknown>)['projectId']) ||
      !isUuid((data as Record<string, unknown>)['roomId'])
    ) {
      socket.emit('error:room', { code: 'INVALID_INPUT' });
      return;
    }

    const { projectId, roomId } = data as { projectId: string; roomId: string };

    try {
      const db = await getDb();

      const [membership] = await db
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.userId, user.id),
          ),
        );

      if (!membership) {
        socket.emit('error:room', { code: 'FORBIDDEN' });
        return;
      }

      const [room] = await db
        .select({ id: rooms.id })
        .from(rooms)
        .where(and(eq(rooms.id, roomId), eq(rooms.projectId, projectId)));

      if (!room) {
        socket.emit('error:room', { code: 'NOT_FOUND' });
        return;
      }

      await socket.join(`room:${roomId}`);
      socket.emit('room:joined', { roomId });
      this.logger.debug(`[room:join] userId=${user.id} joined room:${roomId}`);
    } catch (err) {
      this.logger.error(`[room:join] unexpected error`, err);
      socket.emit('error:room', { code: 'INTERNAL_ERROR' });
    }
  }

  // -------------------------------------------------------------------------
  // Cleanup on module destroy
  // -------------------------------------------------------------------------
  onModuleDestroy() {
    for (const unsub of this.unsubs) {
      unsub();
    }
  }
}
