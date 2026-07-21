import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@bramha/shared';

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

// In dev, connect straight to the server origin (default :3001) so the
// Socket.IO handshake keeps its trailing slash — the Next.js /backend rewrite
// strips it and engine.io 404s. In prod both are unset and we use the
// same-origin /backend proxy fronted by the reverse proxy.
const SOCKET_URL = process.env['NEXT_PUBLIC_SOCKET_URL'] || '/';
const SOCKET_PATH = process.env['NEXT_PUBLIC_SOCKET_PATH'] || '/backend/socket.io';

export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (socket === null) {
    socket = io(SOCKET_URL, {
      path: SOCKET_PATH,
      withCredentials: true,
      autoConnect: false,
    });
  }
  return socket;
}
