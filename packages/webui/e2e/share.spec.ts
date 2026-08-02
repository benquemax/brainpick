/**
 * Shareable view URLs (state/urlState.ts + live/urlSync.ts + ui/SharePanel):
 * the address bar IS the sender's view — doc, view mode, layer, lens, time
 * moment — and a copy-pasted URL replicates it, against the live engine and
 * the static Pages-style export alike. The share button adds control: each
 * dimension is a checkbox, unchecked ones drop out of the link.
 */
import { expect, test } from '@playwright/test';

function baseURL(): string {
  const url = process.env.BP_E2E_URL;
  if (!url) throw new Error('BP_E2E_URL missing — did global-setup run?');
  return url;
}

function staticURL(): string {
  const url = process.env.BP_E2E_URL_STATIC;
  if (!url) throw new Error('BP_E2E_URL_STATIC missing — did global-setup run?');
  return url;
}

test('a shared URL restores doc, view and lens on the live engine', async ({ page }) => {
  await page.goto(`${baseURL()}/?doc=aurinko.md&view=cosmos&lens=orphans`);
  await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.__bp_store.getState().selection)).toBe('aurinko.md');
  const s = await page.evaluate(() => {
    const st = window.__bp_store.getState();
    return { mode: st.mode, lens: st.lens };
  });
  expect(s.mode).toBe('cosmos');
  expect(s.lens).toEqual({ kind: 'orphans' });
  await expect(page.locator('.doc-panel h2').first()).not.toBeEmpty();
});

test('the address bar mirrors what the user does — the URL is always shareable', async ({ page }) => {
  await page.goto(`${baseURL()}/`);
  await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });
  await page.evaluate(() => window.__bp_store.getState().select('kuu.md'));
  await expect.poll(() => page.evaluate(() => window.location.search)).toContain('doc=kuu.md');
  await page.evaluate(() => window.__bp_store.getState().select(null));
  await expect.poll(() => page.evaluate(() => window.location.search)).not.toContain('doc=');
});

test('the share button offers each dimension; unchecking drops its param', async ({ page }) => {
  await page.goto(`${baseURL()}/?doc=aurinko.md&view=cosmos`);
  await expect.poll(() => page.evaluate(() => window.__bp_store.getState().selection)).toBe('aurinko.md');

  await page.locator('.share-cluster button.hud-btn').click();
  await expect(page.locator('.share-pop')).toBeVisible();
  await expect(page.locator('.share-dim')).toHaveCount(2); // node + view
  await expect(page.locator('.share-url')).toHaveValue(/doc=aurinko\.md/);

  // uncheck the node dimension — the link stops prescribing a selection
  await page.locator('.share-dim', { hasText: 'node' }).locator('input').uncheck();
  await expect(page.locator('.share-url')).not.toHaveValue(/doc=/);
  await expect(page.locator('.share-url')).toHaveValue(/view=cosmos/);
});

test('a shared URL works identically on the static export — Pages links replicate', async ({ page }) => {
  await page.goto(`${staticURL()}/?doc=aurinko.md&view=cosmos`);
  await expect(page.locator('.hud-stats')).toContainText('10 docs', { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.__bp_store.getState().selection)).toBe('aurinko.md');
  await expect(page.locator('.doc-panel h2').first()).not.toBeEmpty();
});

test('time travel writes ?commit= to the bar and clears it on exit (static leg has history)', async ({ page }) => {
  await page.goto(`${staticURL()}/`);
  await expect(page.locator('.hud-stats')).toContainText('10 docs', { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.__bp_store.getState().timeline.commits.length)).toBe(2);
  await page.evaluate(() => window.__bp_store.getState().enterTimeTravel(0));
  await expect.poll(() => page.evaluate(() => window.location.search)).toContain('commit=');
  await page.evaluate(() => window.__bp_store.getState().exitTimeTravel());
  await expect.poll(() => page.evaluate(() => window.location.search)).not.toContain('commit=');
});
