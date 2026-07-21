import { test, expect } from '@playwright/test';

const EMAIL = 'demo@northwind.com';
const PASSWORD = 'Northwind2025!';
const PROJECT_NAME = 'Q3 Strategy';
const ROOM_COUNCIL = 'Strategy Session';

test.describe('BramhaV2 — Golden-path demo narrative', () => {
  test.beforeEach(async ({ page }) => {
    // Log in before each test
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole('button', { name: /log in|sign in/i }).click();
    await page.waitForURL(/dashboard/, { timeout: 10_000 });
  });

  test('Beat 1: login → dashboard → Q3 Strategy project', async ({ page }) => {
    await expect(page).toHaveURL(/dashboard/);
    // Find project card
    await expect(page.getByText(PROJECT_NAME)).toBeVisible();
    // Click into project
    await page.getByText(PROJECT_NAME).click();
    await expect(page).toHaveURL(/\/p\//);
  });

  test('Beat 2: market-research.pdf shows ready', async ({ page }) => {
    await page.goto('/');
    // Navigate to Q3 Strategy project
    await page.getByText(PROJECT_NAME).click();
    // Find files link or tab
    const filesLink = page.getByRole('link', { name: /files/i });
    if (await filesLink.isVisible()) {
      await filesLink.click();
    }
    // market-research.pdf should be visible with status ready
    await expect(page.getByText('market-research.pdf')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/ready/i).first()).toBeVisible();
  });

  test('Beat 3: council responds to Q3 question with citation', async ({ page }) => {
    await page.goto('/');
    await page.getByText(PROJECT_NAME).click();
    // Open council room
    await page.getByText(ROOM_COUNCIL).click();
    await expect(page).toHaveURL(/\/r\//);

    // Send the demo question
    const composer = page.getByRole('textbox');
    await composer.fill('Based on the market research, what should we prioritize in Q3?');
    await composer.press('Enter');

    // Wait for at least one agent response card to appear
    // Agent cards have persona-colored avatars — wait for any article with an agent node
    await expect(page.locator('article').filter({ hasText: /Q3|priorit/i }).first())
      .toBeVisible({ timeout: 45_000 });

    // At least one citation chip should appear
    await expect(page.locator('button').filter({ hasText: /market-research\.pdf/i }).first())
      .toBeVisible({ timeout: 45_000 });
  });

  test('Beat 4: @iris mention → Iris responds', async ({ page }) => {
    await page.goto('/');
    await page.getByText(PROJECT_NAME).click();
    await page.getByText(ROOM_COUNCIL).click();

    // Send a quick base message first so there's context
    const composer = page.getByRole('textbox');
    await composer.fill('@iris does this plan create hiring risk?');
    await composer.press('Enter');

    // Wait for Iris (CHRO) to respond — her display name is "Iris"
    await expect(page.getByText('Iris').nth(1)).toBeVisible({ timeout: 45_000 });
  });

  test('Beat 5: branch from message, send follow-up, switch back to main', async ({ page }) => {
    await page.goto('/');
    await page.getByText(PROJECT_NAME).click();
    await page.getByText(ROOM_COUNCIL).click();

    // Send a message to have something to branch from
    const composer = page.getByRole('textbox');
    await composer.fill('What are the technical options?');
    await composer.press('Enter');

    // Wait for a response to appear
    await expect(page.locator('article').nth(1)).toBeVisible({ timeout: 45_000 });

    // Hover over the first agent message to reveal the branch button
    const firstAgentMsg = page.locator('article').nth(1);
    await firstAgentMsg.hover();
    await page.getByText('Branch from here').click();

    // Fill in branch name
    const branchNameInput = page.getByRole('textbox', { name: /branch name/i }).or(
      page.locator('input[placeholder*="branch"]')
    );
    await branchNameInput.fill('cto-deep-dive');
    await page.getByRole('button', { name: /create|branch/i }).last().click();

    // Branch rail should show new branch
    await expect(page.getByText('cto-deep-dive')).toBeVisible({ timeout: 10_000 });

    // Send a follow-up on this branch
    await composer.fill('What is the build vs buy decision for the data platform?');
    await composer.press('Enter');
    await expect(page.locator('article').last()).toBeVisible({ timeout: 45_000 });

    // Switch back to main
    await page.getByText('main').click();
    await expect(page.getByText('cto-deep-dive')).toBeVisible(); // still in branch rail
  });

  test('Beat 6: delegation → indented node with chain badge', async ({ page }) => {
    await page.goto('/');
    await page.getByText(PROJECT_NAME).click();
    await page.getByText(ROOM_COUNCIL).click();

    const composer = page.getByRole('textbox');
    await composer.fill('Vulcan, have Orion size the data work for option two.');
    await composer.press('Enter');

    // Wait for the ↳ from badge to appear (indicates delegation happened)
    // The delegated node has a chain badge with "↳ from" text
    await expect(page.getByText(/↳ from/i)).toBeVisible({ timeout: 60_000 });
  });
});
