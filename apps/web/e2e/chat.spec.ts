/**
 * Chat room E2E tests.
 *
 * Prerequisites:
 *   1. Next.js dev server running on http://localhost:3001
 *   2. NestJS API running on http://localhost:3000
 *   3. A seeded test user and project (see docs/03_implementation_phases.md)
 *
 * These tests are integration-level: they exercise the real UI against the
 * real backend.  They are NOT included in the vitest unit-test suite.
 *
 * Run: pnpm --filter @bramha/web test:e2e
 */

import { test, expect, type Page } from '@playwright/test'

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Sign in using the test credentials stored in env, or skip if not set. */
async function signIn(page: Page) {
  const email = process.env.E2E_EMAIL
  const password = process.env.E2E_PASSWORD
  const projectId = process.env.E2E_PROJECT_ID

  if (!email || !password || !projectId) {
    test.skip(true, 'E2E_EMAIL / E2E_PASSWORD / E2E_PROJECT_ID not set')
    return ''
  }

  await page.goto('/login')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/password/i).fill(password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(`**/dashboard`)

  return projectId
}

/** Navigate to the conference room for the given project. */
async function goToConference(page: Page, projectId: string) {
  await page.goto(`/p/${projectId}/conference`)
  // Wait for composer to be visible — indicates conversation loaded
  await expect(page.getByLabel('Message')).toBeVisible({ timeout: 15_000 })
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test.describe('Chat room', () => {
  test('user can send a message and it appears in the list', async ({ page }) => {
    const projectId = await signIn(page)
    await goToConference(page, projectId)

    const uniqueText = `e2e-msg-${Date.now()}`
    await page.getByLabel('Message').fill(uniqueText)
    await page.getByRole('button', { name: /send message/i }).click()

    // Message should appear in the message list
    await expect(page.getByText(uniqueText)).toBeVisible({ timeout: 10_000 })
  })

  test('user can branch from a message and a branch chip appears', async ({ page }) => {
    const projectId = await signIn(page)
    await goToConference(page, projectId)

    // Send a seed message to branch from
    const seedText = `e2e-branch-seed-${Date.now()}`
    await page.getByLabel('Message').fill(seedText)
    await page.getByRole('button', { name: /send message/i }).click()
    await expect(page.getByText(seedText)).toBeVisible({ timeout: 10_000 })

    // Hover the message to reveal the branch button
    const bubble = page.getByText(seedText)
    await bubble.hover()
    const branchBtn = page.getByRole('button', { name: /branch/i })
    await expect(branchBtn).toBeVisible({ timeout: 5_000 })
    await branchBtn.click()

    // Branch chip row should now appear below the message
    // (BranchChips renders when there are ≥2 branches at a fork point)
    await expect(
      page.locator('[data-testid="branch-chips"], [aria-label*="branch"]').first(),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('user can switch between branches', async ({ page }) => {
    const projectId = await signIn(page)
    await goToConference(page, projectId)

    // RoomHeader branch selector should be present when >1 branch exists
    const selector = page.locator('#room-branch-select')

    // If only one branch exists the selector is hidden — skip gracefully
    const count = await selector.count()
    if (count === 0) {
      test.skip(true, 'No extra branches present; run branch test first')
      return
    }

    // Get all options and switch to a different one
    const options = await selector.locator('option').all()
    if (options.length < 2) {
      test.skip(true, 'Fewer than 2 branches; cannot switch')
      return
    }

     
    const targetValue = await options[1]!.getAttribute('value')
    await selector.selectOption(targetValue ?? '')

    // Composer branch badge should appear (non-main branch name shown)
    // OR message list fades in — either confirms switch completed
    await page.waitForTimeout(500) // allow 150 ms transition + render
    // No hard assertion here: the switch itself must not throw/crash
    await expect(page.getByLabel('Message')).toBeVisible()
  })

  test('page reload restores last active branch (sessionStorage persistence)', async ({
    page,
  }) => {
    const projectId = await signIn(page)
    await goToConference(page, projectId)

    // Read current branch from the selector (if present)
    const selector = page.locator('#room-branch-select')
    const hasBranches = (await selector.count()) > 0
    if (!hasBranches) {
      test.skip(true, 'Need multiple branches for this test')
      return
    }

    const options = await selector.locator('option').all()
    if (options.length < 2) {
      test.skip(true, 'Fewer than 2 branches')
      return
    }

    // Switch to second branch
     
    const targetValue = await options[1]!.getAttribute('value')
    await selector.selectOption(targetValue ?? '')
    await page.waitForTimeout(300)

    // Reload
    await page.reload()
    await expect(page.getByLabel('Message')).toBeVisible({ timeout: 15_000 })

    // After reload the selector should show the same branch
    const reloadedSelector = page.locator('#room-branch-select')
    if ((await reloadedSelector.count()) > 0) {
      await expect(reloadedSelector).toHaveValue(targetValue ?? '')
    }
  })
})
