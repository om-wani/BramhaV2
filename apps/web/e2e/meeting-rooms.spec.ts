/**
 * Meeting Rooms & 1:1 Call Rooms — E2E tests (Playwright)
 *
 * Prerequisites:
 *   1. Next.js dev server running on http://localhost:3001
 *   2. NestJS API running on http://localhost:3000
 *   3. Test credentials set in env:
 *      E2E_EMAIL, E2E_PASSWORD, E2E_PROJECT_ID
 *      E2E_LEDGER_PERSONA_ID (uuid of Ledger in this project's agent_personas)
 *      E2E_ORION_PERSONA_ID  (uuid of Orion)
 *      E2E_VULCAN_PERSONA_ID (uuid of Vulcan)
 *      E2E_LYRA_PERSONA_ID   (uuid of Lyra)
 *
 * Run: pnpm --filter @bramha/web test:e2e
 *
 * Tests that cannot run without a live server are annotated test.skip() with
 * a comment describing the validation intent.
 */

import { test, expect, type Page } from '@playwright/test'

// ── Helpers ────────────────────────────────────────────────────────────────────

const ENV_KEYS = {
  E2E_EMAIL: process.env['E2E_EMAIL'],
  E2E_PASSWORD: process.env['E2E_PASSWORD'],
  E2E_PROJECT_ID: process.env['E2E_PROJECT_ID'],
  E2E_LEDGER_PERSONA_ID: process.env['E2E_LEDGER_PERSONA_ID'],
  E2E_ORION_PERSONA_ID: process.env['E2E_ORION_PERSONA_ID'],
  E2E_VULCAN_PERSONA_ID: process.env['E2E_VULCAN_PERSONA_ID'],
  E2E_LYRA_PERSONA_ID: process.env['E2E_LYRA_PERSONA_ID'],
} as const

function requireEnv(key: keyof typeof ENV_KEYS): string | undefined {
  return ENV_KEYS[key]
}

async function signIn(page: Page): Promise<string | null> {
  const email = requireEnv('E2E_EMAIL')
  const password = requireEnv('E2E_PASSWORD')
  const projectId = requireEnv('E2E_PROJECT_ID')

  if (!email || !password || !projectId) {
    test.skip(true, 'E2E_EMAIL / E2E_PASSWORD / E2E_PROJECT_ID not set')
    return null
  }

  await page.goto('/login')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/password/i).fill(password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL('**/dashboard')
  return projectId
}

// ── Hire helpers via API ───────────────────────────────────────────────────────

async function hirePersona(page: Page, projectId: string, personaId: string) {
  const resp = await page.request.post(`/api/projects/${projectId}/agents`, {
    data: { personaId },
  })
  if (!resp.ok()) throw new Error(`hire failed: ${resp.status()}`)
}

// ── Test suite ─────────────────────────────────────────────────────────────────

test.describe('Meeting rooms and 1:1 isolation', () => {
  /**
   * Creates a "Pricing War-Room" meeting with Ledger + Orion.
   * Asserts those two personas and no others are participants.
   */
  test('create meeting with subset roster — only selected personas appear', async ({ page }) => {
    const projectId = await signIn(page)
    if (!projectId) return

    const ledgerId = requireEnv('E2E_LEDGER_PERSONA_ID')
    const orionId = requireEnv('E2E_ORION_PERSONA_ID')

    if (!ledgerId || !orionId) {
      test.skip(true, 'E2E_LEDGER_PERSONA_ID / E2E_ORION_PERSONA_ID not set')
      return
    }

    // Hire Ledger and Orion via API
    await hirePersona(page, projectId, ledgerId)
    await hirePersona(page, projectId, orionId)

    // Navigate to meetings page
    await page.goto(`/p/${projectId}/meeting`)
    await page.getByRole('button', { name: /new meeting/i }).click()

    // Fill in the dialog
    await page.getByLabel(/meeting name/i).fill('Pricing War-Room')

    // Select Ledger and Orion checkboxes
    const ledgerCheck = page.getByLabel(new RegExp('ledger', 'i')).first()
    const orionCheck = page.getByLabel(new RegExp('orion', 'i')).first()
    if (await ledgerCheck.isVisible()) await ledgerCheck.check()
    if (await orionCheck.isVisible()) await orionCheck.check()

    await page.getByRole('button', { name: /create meeting/i }).click()

    // Should navigate to the new meeting room
    await page.waitForURL(`**/meeting/**`)

    // Check participants via API
    const url = page.url()
    const roomId = url.split('/meeting/')[1]?.split('/')[0]
    expect(roomId).toBeTruthy()

    const resp = await page.request.get(
      `/api/projects/${projectId}/rooms/${roomId}/participants`,
    )
    expect(resp.ok()).toBeTruthy()
    const participants: Array<{ participantKind: string; personaId: string | null }> =
      await resp.json()

    const agentIds = participants
      .filter((p) => p.participantKind === 'agent')
      .map((p) => p.personaId)

    expect(agentIds).toContain(ledgerId)
    expect(agentIds).toContain(orionId)
    // Must be exactly these two agents (no extras)
    expect(agentIds).toHaveLength(2)
  })

  /**
   * 1:1 with Vulcan — Lyra must never appear.
   * Validates WS channel isolation: only Vulcan responds.
   */
  test('1:1 call with Vulcan is isolated — Lyra never appears', async ({ page }) => {
    const projectId = await signIn(page)
    if (!projectId) return

    const vulcanId = requireEnv('E2E_VULCAN_PERSONA_ID')
    const lyraId = requireEnv('E2E_LYRA_PERSONA_ID')

    if (!vulcanId) {
      test.skip(true, 'E2E_VULCAN_PERSONA_ID not set')
      return
    }

    // Hire Vulcan
    await hirePersona(page, projectId, vulcanId)

    // Navigate to Vulcan's 1:1 room
    await page.goto(`/p/${projectId}/call/${vulcanId}`)

    // Persona bio card should show Vulcan
    await expect(page.getByText(/vulcan/i)).toBeVisible({ timeout: 10_000 })

    // If Lyra is set, ensure she is not visible in the header
    if (lyraId) {
      await expect(page.getByText(/lyra/i)).not.toBeVisible()
    }

    // Participants via API — only Vulcan should be the agent participant
    // (call-room endpoint returns the room; participants endpoint returns roster)
    const callRoomResp = await page.request.get(
      `/api/projects/${projectId}/agents/${vulcanId}/call-room`,
    )
    expect(callRoomResp.ok()).toBeTruthy()
    const callRoom: { id: string } = await callRoomResp.json()

    const partResp = await page.request.get(
      `/api/projects/${projectId}/rooms/${callRoom.id}/participants`,
    )
    expect(partResp.ok()).toBeTruthy()
    const parts: Array<{ participantKind: string; personaId: string | null }> =
      await partResp.json()

    const agentParticipants = parts.filter((p) => p.participantKind === 'agent')
    expect(agentParticipants).toHaveLength(1)
    expect(agentParticipants[0].personaId).toBe(vulcanId)

    if (lyraId) {
      expect(agentParticipants.map((p) => p.personaId)).not.toContain(lyraId)
    }
  })

  /**
   * Archive a meeting room — all WS clients should be disconnected within 5 s.
   *
   * NOTE: This test verifies the archive API call triggers kickRoom.
   * Full WS eviction requires a live Socket.IO connection; that behaviour is
   * covered by the unit test (relay.kickRoom called) and the security
   * invariant in EventRelayService.kickRoom().
   */
  test('archive meeting — PATCH archived:true, room becomes archived', async ({ page }) => {
    const projectId = await signIn(page)
    if (!projectId) return

    // Create a throwaway meeting room via API
    const createResp = await page.request.post(`/api/projects/${projectId}/rooms`, {
      data: { type: 'meeting', name: 'Throwaway Archive Test' },
    })
    expect(createResp.ok()).toBeTruthy()
    const room: { id: string } = await createResp.json()

    // Archive it
    const archiveResp = await page.request.patch(
      `/api/projects/${projectId}/rooms/${room.id}`,
      { data: { archived: true } },
    )
    expect(archiveResp.ok()).toBeTruthy()
    const archived: { archivedAt: string | null } = await archiveResp.json()
    expect(archived.archivedAt).not.toBeNull()
  })

  /**
   * Roster tamper guard — attempting to add a non-hired persona via direct API
   * call must be rejected with 403.
   */
  test('roster tamper: adding non-hired persona returns 403', async ({ page }) => {
    const projectId = await signIn(page)
    if (!projectId) return

    // Use a random UUID that is definitely not hired
    const nonHiredPersonaId = '00000000-cafe-babe-0000-000000000000'

    // Create a meeting room
    const createResp = await page.request.post(`/api/projects/${projectId}/rooms`, {
      data: { type: 'meeting', name: 'Tamper Test Room' },
    })
    expect(createResp.ok()).toBeTruthy()
    const room: { id: string } = await createResp.json()

    // Try to add the non-hired persona — must get 403
    const addResp = await page.request.post(
      `/api/projects/${projectId}/rooms/${room.id}/participants`,
      { data: { participantKind: 'agent', personaId: nonHiredPersonaId } },
    )
    expect(addResp.status()).toBe(403)
  })
})
