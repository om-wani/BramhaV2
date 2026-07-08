import net from 'net'
import { ClamAvDownError } from '../errors.js'

/**
 * Lightweight health check for the ClamAV daemon.
 *
 * Sends a PING command (null-terminated 'z' protocol) and expects PONG back.
 * Resolves on success, rejects (throws) if the daemon is unreachable.
 * Used by main.ts to poll for ClamAV recovery after a ClamAvDownError.
 */
export function checkClamAvHealth(
  host = process.env['CLAMAV_HOST'] ?? 'localhost',
  port = parseInt(process.env['CLAMAV_PORT'] ?? '3310', 10),
  timeoutMs = 5_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port })
    let settled = false
    let response = ''

    function settle(fn: () => void) {
      if (settled) return
      settled = true
      fn()
      socket.destroy()
    }

    socket.setTimeout(timeoutMs, () => {
      settle(() => reject(new Error('ClamAV PING timeout')))
    })

    socket.on('error', (err) => {
      settle(() => reject(err))
    })

    socket.on('connect', () => {
      socket.write('zPING\0')
    })

    socket.on('data', (data: Buffer) => {
      response += data.toString()
      const nullIdx = response.indexOf('\0')
      if (nullIdx === -1) return
      const resp = response.slice(0, nullIdx).trim()
      if (resp === 'PONG') {
        settle(() => resolve())
      } else {
        settle(() => reject(new Error(`Unexpected ClamAV PING response: ${resp}`)))
      }
    })

    socket.on('end', () => {
      if (!settled) {
        settle(() => reject(new Error('ClamAV closed connection before PONG')))
      }
    })
  })
}

export interface ClamAvResult {
  verdict: 'clean' | 'virus'
  threatName?: string
}

const CLAMAV_CHUNK_SIZE = 65536 // 64 KB chunks

/**
 * Sends a file buffer to the ClamAV daemon via the INSTREAM TCP protocol.
 *
 * Protocol (zINSTREAM — null-terminated variant):
 *   Client → "zINSTREAM\0"
 *   Client → [4-byte big-endian uint32 length][chunk bytes]  (repeat)
 *   Client → [4 zero bytes]  (end-of-stream marker)
 *   Server → "stream: OK\0"  |  "stream: <threat-name> FOUND\0"
 *
 * If the daemon is unreachable or times out, throws ClamAvDownError.
 * The caller MUST rethrow this so BullMQ retries the job — never swallow it.
 */
export function scanWithClamAv(
  buffer: Buffer,
  host = process.env['CLAMAV_HOST'] ?? 'localhost',
  port = parseInt(process.env['CLAMAV_PORT'] ?? '3310', 10),
  timeoutMs = 30_000,
): Promise<ClamAvResult> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port })
    let settled = false
    let response = ''

    function settle(fn: () => void) {
      if (settled) return
      settled = true
      fn()
      socket.destroy()
    }

    socket.setTimeout(timeoutMs, () => {
      settle(() => reject(new ClamAvDownError(new Error('ClamAV connection timeout'))))
    })

    socket.on('error', (err) => {
      settle(() => reject(new ClamAvDownError(err)))
    })

    socket.on('connect', () => {
      // 1. Send INSTREAM command (null-terminated 'z' protocol)
      socket.write('zINSTREAM\0')

      // 2. Stream the buffer in chunks
      let offset = 0
      while (offset < buffer.length) {
        const end = Math.min(offset + CLAMAV_CHUNK_SIZE, buffer.length)
        const chunk = buffer.subarray(offset, end)
        const lengthBuf = Buffer.allocUnsafe(4)
        lengthBuf.writeUInt32BE(chunk.length, 0)
        socket.write(lengthBuf as unknown as Uint8Array)
        socket.write(chunk as unknown as Uint8Array)
        offset = end
      }

      // 3. End-of-stream marker (4 zero bytes)
      socket.write(Buffer.alloc(4) as unknown as Uint8Array)
    })

    socket.on('data', (data: Buffer) => {
      response += data.toString()

      // ClamAV response is null-terminated in 'z' mode
      const nullIdx = response.indexOf('\0')
      if (nullIdx === -1) return

      const resp = response.slice(0, nullIdx).trim()

      if (resp === 'stream: OK') {
        settle(() => resolve({ verdict: 'clean' }))
        return
      }

      const foundMatch = /stream:\s+(.+)\s+FOUND$/i.exec(resp)
      const threatName = foundMatch?.[1]
      if (threatName) {
        settle(() => resolve({ verdict: 'virus', threatName }))
        return
      }

      // Unexpected response — surface as an error
      settle(() => reject(new Error(`Unexpected ClamAV response: ${resp}`)))
    })

    socket.on('end', () => {
      if (!settled) {
        // Server closed connection before we got a response
        const resp = response.trim()
        if (resp === 'stream: OK') {
          settle(() => resolve({ verdict: 'clean' }))
        } else {
          const foundMatch = /stream:\s+(.+)\s+FOUND$/i.exec(resp)
          const endThreat = foundMatch?.[1]
          if (endThreat) {
            settle(() => resolve({ verdict: 'virus', threatName: endThreat }))
          } else {
            settle(() => reject(new ClamAvDownError(new Error('ClamAV closed connection unexpectedly'))))
          }
        }
      }
    })
  })
}
