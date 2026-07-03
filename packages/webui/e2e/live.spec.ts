/**
 * End-to-end against the REAL Python engine (no mocks): global-setup copies the
 * kotiaurinko fixture to a tmp bundle and spawns `uv run brainpick serve` on an
 * ephemeral port. Tests run serially — the bundle mutates on purpose (test 2).
 */
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const NEW_DOC = [
  '---',
  'type: Concept',
  'title: Uusi',
  'description: A freshly discovered rock.',
  'timestamp: 2026-07-03T09:00:00Z',
  '---',
  '',
  '# Uusi',
  '',
  'It circles close to [Kuu](kuu.md).',
  '',
].join('\n');

function baseURL(): string {
  const url = process.env.BP_E2E_URL;
  if (!url) throw new Error('BP_E2E_URL missing — did global-setup run?');
  return url;
}

function bundleDir(): string {
  const dir = process.env.BP_E2E_BUNDLE;
  if (!dir) throw new Error('BP_E2E_BUNDLE missing — did global-setup run?');
  return dir;
}

test.describe.configure({ mode: 'serial' });

test('the UI loads and the HUD reports the compiled bundle', async ({ page }) => {
  await page.goto(baseURL() + '/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.hud-stats')).toContainText('10 docs', { timeout: 30_000 });
});

test('a doc written to disk joins the graph live — no reload', async ({ page }) => {
  await page.goto(baseURL() + '/');
  await expect(page.locator('.hud-stats')).toContainText('10 docs', { timeout: 30_000 });

  // Mutate the bundle on disk; the watcher recompiles and the SSE delta lands.
  writeFileSync(path.join(bundleDir(), 'uusi.md'), NEW_DOC, 'utf-8');
  await expect(page.locator('.hud-stats')).toContainText('11 docs', { timeout: 30_000 });

  // The new node is real: searchable, selectable, and its doc panel opens.
  await page.keyboard.press('/');
  await expect(page.locator('.search-box input')).toBeFocused();
  await page.keyboard.type('uusi');
  await expect(page.locator('.search-hits li').first()).toContainText('Uusi');
  await page.keyboard.press('Enter');
  await expect(page.locator('.doc-panel h2')).toHaveText('Uusi');
});

test('search overlay: "/" opens, results appear, Enter opens the doc panel', async ({ page }) => {
  await page.goto(baseURL() + '/');
  await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });

  await page.keyboard.press('/');
  await expect(page.locator('.search-box input')).toBeFocused();
  await page.keyboard.type('aurinko');
  await expect(page.locator('.search-hits li').first()).toContainText('Aurinko');

  await page.keyboard.press('Enter');
  await expect(page.locator('.doc-panel h2')).toHaveText('Aurinko');
  await expect(page.locator('.doc-panel .doc-body')).toContainText('The sun sits at the center');
});

test('PWA: the manifest is linked and served', async ({ page }) => {
  await page.goto(baseURL() + '/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  const manifest = await page.request.get(baseURL() + '/manifest.webmanifest');
  expect(manifest.status()).toBe(200);
  expect((await manifest.json()).name).toBe('brainpick');
});
