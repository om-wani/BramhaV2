import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@bramha/shared';

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (socket === null) {
    socket = io('/', {
      path: '/backend/socket.io',
      withCredentials: true,
      autoConnect: false,
    });
  }
  return socket;
}
