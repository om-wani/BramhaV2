import { io, type Socket } from 'socket.io-client'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'

let socket: Socket | null = null

/**
 * Create (or reuse) a Socket.IO client authenticated with the given JWT.
 * If a connected socket already exists it is returned as-is; otherwise
 * any stale socket is destroyed and a fresh one is created.
 */
export function createSocket(token: string): Socket {
  if (socket?.connected) {
    return socket
  }
  destroySocket()

  socket = io(API_BASE, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
  })

  return socket
}

/** Return the current singleton socket, or null if none has been created. */
export function getSocket(): Socket | null {
  return socket
}

/** Disconnect and discard the current singleton socket. */
export function destroySocket(): void {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}
