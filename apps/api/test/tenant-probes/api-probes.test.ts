/**
 * HTTP-level API isolation probe battery.
 *
 * Uses tenant B's JWT against tenant A's resource IDs across every API route
 * group that touches tenant data.  Any 200 response is an isolation breach
 * and fails the build with a clear table/route report.
 *
 * Tests are skipped when TEST_API_URL is not set (the CI tenant-isolation job
 * does not start the API server; these probes run in environments that do).
 *
 * To run locally:
 *   TEST_API_URL=http://localhost:3000 pnpm --filter @bramha/api test:tenant-probes
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupFixtures, teardownFixtures, type TenantFixture } from './fixtures'
import { appendResults, type ProbeResult } from './report'

// ─────────────────────────────────────────────────────────────────────────────
// Skip guard
// ─────────────────────────────────────────────────────────────────────────────

const TEST_API_URL = process.env['TEST_API_URL']
const DATABASE_URL = process.env['DATABASE_URL']
const RUN = !!(TEST_API_URL && DATABASE_URL)

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helper
// ─────────────────────────────────────────────────────────────────────────────

interface ProbeResponse {
  status: number
  body: unknown
}

async function get(path: string, jwtToken: string): Promise<ProbeResponse> {
  const url = `${TEST_API_URL}${path}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${jwtToken}` },
  })
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

async function post(path: string, jwtToken: string, payload: unknown): Promise<ProbeResponse> {
  const url = `${TEST_API_URL}${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwtToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

// ─────────────────────────────────────────────────────────────────────────────
// Probe runner
// ─────────────────────────────────────────────────────────────────────────────

function assertNotLeaking(route: string, response: ProbeResponse, results: ProbeResult[]): void {
  const { status } = response

  if (status === 200) {
    // 200 with an empty array is acceptable for list endpoints
    const body = response.body
    if (
      Array.isArray(body) && body.length === 0
    ) {
      results.push({ probe: route, route, passed: true })
      return
    }
    if (
      body !== null &&
      typeof body === 'object' &&
      'data' in body &&
      Array.isArray((body as Record<string, unknown>)['data']) &&
      ((body as Record<string, unknown>)['data'] as unknown[]).length === 0
    ) {
      results.push({ probe: route, route, passed: true })
      return
    }

    const msg = `ISOLATION BREACH: ${route} returned 200 with data for cross-tenant request`
    results.push({ probe: route, route, passed: false, failReason: msg })
    throw new Error(msg)
  }

  // 403 or 404 are both acceptable — the resource is protected
  if (status === 403 || status === 404 || status === 401) {
    results.push({ probe: route, route, passed: true })
    return
  }

  // Any other status is unexpected; record but don't fail hard
  results.push({
    probe: route,
    route,
    passed: true, // not a breach, just unexpected
    failReason: `Unexpected status ${status} (not a breach, expected 403/404)`,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN)('Tenant API isolation probes (HTTP level)', () => {
  let tenantA: TenantFixture
  let tenantB: TenantFixture

  const results: ProbeResult[] = []

  beforeAll(async () => {
    const fixtures = await setupFixtures()
    tenantA = fixtures.tenantA
    tenantB = fixtures.tenantB
  })

  afterAll(async () => {
    await teardownFixtures({ tenantA, tenantB })
    appendResults('apiProbes', results)
  })

  // ── Project endpoints ──────────────────────────────────────────────────────

  it('GET /projects/:id — B cannot read A project', async () => {
    const res = await get(`/projects/${tenantA.projectId}`, tenantB.jwtToken)
    assertNotLeaking(`GET /projects/${tenantA.projectId}`, res, results)
    expect([401, 403, 404]).toContain(res.status)
  })

  it('GET /projects/:id/members — B cannot read A project members', async () => {
    const res = await get(`/projects/${tenantA.projectId}/members`, tenantB.jwtToken)
    assertNotLeaking(`GET /projects/${tenantA.projectId}/members`, res, results)
    expect([401, 403, 404]).toContain(res.status)
  })

  it('GET /orgs/:orgId/projects — B cannot read A org projects', async () => {
    const res = await get(`/orgs/${tenantA.orgId}/projects`, tenantB.jwtToken)
    // Acceptable: 403/404, or 200 with empty list (B is not a member of A's org)
    assertNotLeaking(`GET /orgs/${tenantA.orgId}/projects`, res, results)
    // If 200, must be empty (the empty-list branch in assertNotLeaking handles this)
    if (res.status === 200) {
      expect(results.at(-1)?.passed).toBe(true)
    } else {
      expect([401, 403, 404]).toContain(res.status)
    }
  })

  // ── Room endpoints ─────────────────────────────────────────────────────────

  it('GET /projects/:id/rooms — B cannot list A rooms', async () => {
    const res = await get(`/projects/${tenantA.projectId}/rooms`, tenantB.jwtToken)
    assertNotLeaking(`GET /projects/${tenantA.projectId}/rooms`, res, results)
    expect([401, 403, 404]).toContain(res.status)
  })

  it('GET /projects/:id/rooms/:roomId — B cannot read A room', async () => {
    const aRoomId = tenantA.rows['rooms']?.[0]
    expect(aRoomId).toBeTruthy()
    const route = `/projects/${tenantA.projectId}/rooms/${aRoomId!}`
    const res = await get(route, tenantB.jwtToken)
    assertNotLeaking(route, res, results)
    expect([401, 403, 404]).toContain(res.status)
  })

  // ── Conversation endpoints ─────────────────────────────────────────────────

  it('GET /projects/:id/conversations/:convId — B cannot read A conversation', async () => {
    const aConvId = tenantA.rows['conversations']?.[0]
    expect(aConvId).toBeTruthy()
    const route = `/projects/${tenantA.projectId}/conversations/${aConvId!}`
    const res = await get(route, tenantB.jwtToken)
    assertNotLeaking(route, res, results)
    expect([401, 403, 404]).toContain(res.status)
  })

  // ── File endpoints ─────────────────────────────────────────────────────────

  it('GET /projects/:id/files — B cannot list A files', async () => {
    const res = await get(`/projects/${tenantA.projectId}/files`, tenantB.jwtToken)
    assertNotLeaking(`GET /projects/${tenantA.projectId}/files`, res, results)
    expect([401, 403, 404]).toContain(res.status)
  })

  it('GET /projects/:id/files/:fileId — B cannot read A file', async () => {
    const aFileId = tenantA.rows['files']?.[0]
    expect(aFileId).toBeTruthy()
    const route = `/projects/${tenantA.projectId}/files/${aFileId!}`
    const res = await get(route, tenantB.jwtToken)
    assertNotLeaking(route, res, results)
    expect([401, 403, 404]).toContain(res.status)
  })

  it('POST /projects/:id/files/presign — B cannot get A presign URL (S3 probe)', async () => {
    const route = `/projects/${tenantA.projectId}/files/presign`
    const res = await post(route, tenantB.jwtToken, {
      name: 'probe.txt',
      contentType: 'text/plain',
      size: 100,
    })
    assertNotLeaking(route, res, results)
    expect([401, 403, 404]).toContain(res.status)
  })

  // ── Notes endpoints ────────────────────────────────────────────────────────

  it('GET /projects/:id/notes — B cannot list A notes', async () => {
    const res = await get(`/projects/${tenantA.projectId}/notes`, tenantB.jwtToken)
    assertNotLeaking(`GET /projects/${tenantA.projectId}/notes`, res, results)
    expect([401, 403, 404]).toContain(res.status)
  })

  it('GET /projects/:id/notes/:noteId — B cannot read A note', async () => {
    const aNoteId = tenantA.rows['notes']?.[0]
    expect(aNoteId).toBeTruthy()
    const route = `/projects/${tenantA.projectId}/notes/${aNoteId!}`
    const res = await get(route, tenantB.jwtToken)
    assertNotLeaking(route, res, results)
    expect([401, 403, 404]).toContain(res.status)
  })

  // ── Knowledge / search endpoints ───────────────────────────────────────────

  it('GET /projects/:id/search — B cannot vector-search A knowledge (vector search probe)', async () => {
    const res = await get(
      `/projects/${tenantA.projectId}/search?q=probe`,
      tenantB.jwtToken,
    )
    assertNotLeaking(`GET /projects/${tenantA.projectId}/search`, res, results)
    expect([401, 403, 404]).toContain(res.status)
  })

  // ── Agent endpoints ────────────────────────────────────────────────────────

  it('GET /projects/:id/agents — B cannot list A agents', async () => {
    const res = await get(`/projects/${tenantA.projectId}/agents`, tenantB.jwtToken)
    assertNotLeaking(`GET /projects/${tenantA.projectId}/agents`, res, results)
    expect([401, 403, 404]).toContain(res.status)
  })

  // ── Token usage endpoints ──────────────────────────────────────────────────

  it('GET /projects/:id/token-usage — B cannot read A token usage', async () => {
    const res = await get(`/projects/${tenantA.projectId}/token-usage`, tenantB.jwtToken)
    assertNotLeaking(`GET /projects/${tenantA.projectId}/token-usage`, res, results)
    expect([401, 403, 404]).toContain(res.status)
  })
})
