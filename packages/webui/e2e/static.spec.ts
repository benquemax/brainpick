/**
 * The static-snapshot export (scripts/build-static-site.mjs + staticMode.ts),
 * end to end: global-setup bakes the kotiaurinko fixture (with a real
 * two-commit git history) into a static site and serves it with a DUMB file
 * server that drops query strings — GitHub Pages semantics, no brainpick
 * process anywhere behind the page. Everything the demo promises must come
 * from the baked files alone: the brain, the doc panel, client-side search
 * with honest degradation, the timeline, and a terminal 'snapshot'
 * connection state instead of an SSE retry loop.
 */
import { expect, test, type Page } from '@playwright/test';

function staticURL(): string {
  const url = process.env.BP_E2E_URL_STATIC;
  if (!url) throw new Error('BP_E2E_URL_STATIC missing — did global-setup run?');
  return url;
}

async function openBrain(page: Page): Promise<void> {
  await page.goto(`${staticURL()}/`);
  await expect(page.locator('.hud-stats')).toContainText('10 docs', { timeout: 30_000 });
}

test('the baked brain renders with real tiers and a terminal snapshot state', async ({ page }) => {
  await openBrain(page);

  // tiers come from the baked /api/status (no SSE hello exists to carry them)
  await expect(page.locator('.hud-tiers')).toContainText('t1 fresh');

  // the connection is 'snapshot' — and STAYS so (no reconnect loop degrading
  // through 'reconnecting' toward 'offline')
  const state = () => page.evaluate(() => window.__bp_store.getState().connection);
  expect(await state()).toBe('snapshot');
  await page.waitForTimeout(2_000);
  expect(await state()).toBe('snapshot');
  await expect(page.locator('.conn-dot.snapshot')).toBeVisible();

  // a static page cannot accept writes — the editor affordance is gone
  expect(await page.evaluate(() => window.__bp_store.getState().writesEnabled)).toBe(false);
});

test('search answers client-side from the baked index, honestly degraded', async ({ page }) => {
  await openBrain(page);

  await page.keyboard.press('/');
  await page.locator('.search-box input').fill('aurinko');
  await expect(page.locator('.search-hits li').first()).toBeVisible();
  // AUTO's contract is "best available" — keyword IS the answer, no chip
  await expect(page.locator('.degraded-chip')).toHaveCount(0);

  const hits = await page.evaluate(() => window.__bp_store.getState().searchHits.map((h) => h.path));
  expect(hits).toContain('aurinko.md');

  // an EXPLICIT semantic ask is a promise a static page cannot keep — say so
  await page.getByRole('radio', { name: 'semantic' }).click();
  await expect(page.locator('.degraded-chip')).toBeVisible();
  await expect(page.locator('.degraded-chip')).toContainText('semantic unavailable');
});

test('a doc opens from its baked file, links and body intact', async ({ page }) => {
  await openBrain(page);

  await page.keyboard.press('/');
  await page.locator('.search-box input').fill('aurinko');
  await expect(page.locator('.search-hits li').first()).toBeVisible();
  await page.keyboard.press('Enter');

  await expect(page.locator('.doc-panel h2').first()).not.toBeEmpty();
  expect(await page.evaluate(() => window.__bp_store.getState().selection)).toBe('aurinko.md');
});

test('the timeline is baked — the git history travels with the snapshot', async ({ page }) => {
  await openBrain(page);

  // global-setup committed the fixture twice; the baked /api/timeline carries it
  await expect
    .poll(() => page.evaluate(() => window.__bp_store.getState().timeline.commits.length))
    .toBe(2);
});
