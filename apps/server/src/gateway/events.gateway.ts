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
// UUID guard (prevent injection via raw SQL, even though we use Drizzle)
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
    origin: process.env['APP_ORIGIN'] ?? true,
    credentials: true,
  },
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(EventsGateway.name);

  // Unsubscribe callbacks returned by eventBus.on()
  private readonly unsubs: Array<() => void> = [];

  constructor(private readonly authService: AuthService) {}

  // -------------------------------------------------------------------------
  // Lifecycle: wire up internal event-bus subscriptions
  // -------------------------------------------------------------------------
  afterInit() {
    // --- node.created ---
    const unsubNode = eventBus.on('node.created', async (event) => {
      const { roomId, nodeId } = event;

      // Fetch the full node row so clients get content + metadata
      try {
        const db = await getDb();
        const [node] = await db
          .select({
            id: conversationNodes.id,
            authorType: conversationNodes.authorType,
            persona: conversationNodes.persona,
            content: conversationNodes.content,
            metadata: conversationNodes.metadata,
            createdAt: conversationNodes.createdAt,
          })
          .from(conversationNodes)
          .where(eq(conversationNodes.id, nodeId));

        // Find the branch whose head is this node (or that just had it set)
        const [branch] = await db
          .select({ id: branches.id })
          .from(branches)
          .where(eq(branches.headNodeId, nodeId));

        const branchId = branch?.id ?? null;

        this.server.to(`room:${roomId}`).emit('node:created', {
          nodeId: node?.id ?? nodeId,
          branchId,
          authorType: node?.authorType ?? 'system',
          persona: node?.persona ?? null,
          content: node?.content ?? '',
          metadata: node?.metadata ?? {},
          createdAt: node?.createdAt ?? new Date(),
        });
      } catch (err) {
        this.logger.error(`[node.created] DB lookup failed for nodeId=${nodeId}`, err);
        // Emit minimal payload so clients know a node exists
        this.server.to(`room:${roomId}`).emit('node:created', {
          nodeId,
          branchId: null,
          authorType: 'system',
          persona: null,
          content: '',
          metadata: {},
          createdAt: new Date(),
        });
      }
    });

    // --- branch.created ---
    const unsubBranch = eventBus.on('branch.created', async (event) => {
      const { roomId, branchId } = event;

      try {
        const db = await getDb();
        const [branch] = await db
          .select({
            id: branches.id,
            name: branches.name,
            headNodeId: branches.headNodeId,
            forkedFromNodeId: branches.forkedFromNodeId,
          })
          .from(branches)
          .where(eq(branches.id, branchId));

        this.server.to(`room:${roomId}`).emit('branch:created', {
          branchId: branch?.id ?? branchId,
          name: branch?.name ?? '',
          headNodeId: branch?.headNodeId ?? null,
          forkedFromNodeId: branch?.forkedFromNodeId ?? null,
        });
      } catch (err) {
        this.logger.error(`[branch.created] DB lookup failed for branchId=${branchId}`, err);
        this.server.to(`room:${roomId}`).emit('branch:created', {
          branchId,
          name: '',
          headNodeId: null,
          forkedFromNodeId: null,
        });
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
  // Disconnect: nothing special needed (Socket.IO auto-leaves rooms)
  // -------------------------------------------------------------------------
  handleDisconnect(socket: AuthSocket) {
    const userId = socket.data.user?.id ?? 'unauthenticated';
    this.logger.debug(`[disconnect] userId=${userId} socket=${socket.id}`);
  }

  // -------------------------------------------------------------------------
  // join:room — validate membership then add socket to room
  // -------------------------------------------------------------------------
  @SubscribeMessage('join:room')
  async handleJoinRoom(
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

      // Verify caller is a project member
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

      // Verify room belongs to this project
      const [room] = await db
        .select({ id: rooms.id })
        .from(rooms)
        .where(and(eq(rooms.id, roomId), eq(rooms.projectId, projectId)));

      if (!room) {
        socket.emit('error:room', { code: 'NOT_FOUND' });
        return;
      }

      await socket.join(`room:${roomId}`);
      socket.emit('joined:room', { roomId });
      this.logger.debug(
        `[join:room] userId=${user.id} joined room:${roomId}`,
      );
    } catch (err) {
      this.logger.error(`[join:room] unexpected error`, err);
      socket.emit('error:room', { code: 'INTERNAL_ERROR' });
    }
  }

  // -------------------------------------------------------------------------
  // Cleanup on module destroy (NestJS lifecycle)
  // -------------------------------------------------------------------------
  onModuleDestroy() {
    for (const unsub of this.unsubs) {
      unsub();
    }
  }
}
