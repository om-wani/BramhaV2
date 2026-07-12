import { describe, it, expect, vi } from 'vitest'
import { HttpException, HttpStatus } from '@nestjs/common'
import { ProblemJsonFilter } from './problem-json.filter.js'
import type { ArgumentsHost } from '@nestjs/common'

function mockHost(reply: {
  status: ReturnType<typeof vi.fn>
  header: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
}) {
  return {
    switchToHttp: () => ({
      getResponse: () => reply,
    }),
  } as unknown as ArgumentsHost
}

describe('ProblemJsonFilter', () => {
  const filter = new ProblemJsonFilter()

  function makeReply() {
    const reply = {
      status: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    }
    return reply
  }

  it('maps HttpException to problem+json', () => {
    const reply = makeReply()
    filter.catch(new HttpException('Not found', HttpStatus.NOT_FOUND), mockHost(reply))
    expect(reply.status).toHaveBeenCalledWith(404)
    expect(reply.header).toHaveBeenCalledWith('Content-Type', 'application/problem+json')
    const body = reply.send.mock.calls[0]?.[0] as Record<string, unknown>
    expect(body?.['code']).toBe('not_found')
    expect(body).not.toHaveProperty('stack')
  })

  it('maps unknown Error to internal_error without leaking stack', () => {
    const reply = makeReply()
    filter.catch(new Error('DB connection failed'), mockHost(reply))
    expect(reply.status).toHaveBeenCalledWith(500)
    const body = reply.send.mock.calls[0]?.[0] as Record<string, unknown>
    expect(body?.['code']).toBe('internal_error')
    expect(body?.['status']).toBe(500)
    expect(body).not.toHaveProperty('stack')
    expect(JSON.stringify(body)).not.toContain('DB connection failed')
  })

  it('uses string response for HttpException', () => {
    const reply = makeReply()
    filter.catch(new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED), mockHost(reply))
    expect(reply.status).toHaveBeenCalledWith(401)
    const body = reply.send.mock.calls[0]?.[0] as Record<string, unknown>
    expect(body?.['code']).toBe('unauthorized')
  })
})
