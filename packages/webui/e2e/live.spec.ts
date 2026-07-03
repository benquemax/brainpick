/**
 * End-to-end against the REAL Python engine (no mocks): global-setup copies the
 * kotiaurinko fixture to two tmp bundles and spawns `uv run brainpick serve` on
 * ephemeral ports — the primary with the mock embedder (T2 fresh: semantic
 * search answers from real vectors), the second without (T2 off: semantic
 * degrades honestly). Tests run serially — the primary bundle mutates on
 * purpose (test 2).
 *
 * Store-backed assertions read window.__bp_store (exposed by main.tsx): the
 * zustand store is the single source of truth, so tests assert state, not
 * pixels, for lens/camera behavior.
 */
import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { UIState } from '../src/state/store';

declare global {
  interface Window {
    __bp_store: { getState(): UIState };
  }
}

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

function t2lessURL(): string {
  const url = process.env.BP_E2E_URL_T2LESS;
  if (!url) throw new Error('BP_E2E_URL_T2LESS missing — did global-setup run?');
  return url;
}

function bundleDir(): string {
  const dir = process.env.BP_E2E_BUNDLE;
  if (!dir) throw new Error('BP_E2E_BUNDLE missing — did global-setup run?');
  return dir;
}

/** A search-hit row matched by its TITLE (snippets often echo other titles). */
function hitTitled(page: Page, title: string) {
  return page
    .locator('.search-hits li')
    .filter({ has: page.locator('.hit-title', { hasText: new RegExp(`^${title}$`) }) });
}

test.describe.configure({ mode: 'serial' });

test('the UI loads and the HUD reports the compiled bundle (T2 fresh via mock embedder)', async ({ page }) => {
  await page.goto(baseURL() + '/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.hud-stats')).toContainText('10 docs', { timeout: 30_000 });
  await expect(page.locator('.hud-tiers')).toContainText('t2 fresh');
});

test('a doc written to disk joins the graph live — no reload', async ({ page }) => {
  await page.goto(baseURL() + '/');
  await expect(page.locator('.hud-stats')).toContainText('10 docs', { timeout: 30_000 });

  // Mutate the bundle on disk; the watcher recompiles and the SSE delta lands.
  writeFileSync(path.join(bundleDir(), 'uusi.md'), NEW_DOC, 'utf-8');
  await expect(page.locator('.hud-stats')).toContainText('11 docs', { timeout: 30_000 });

  // The new node is real: searchable (keyword mode pins the ranking),
  // selectable, and its doc panel opens.
  await page.keyboard.press('/');
  await expect(page.locator('.search-box input')).toBeFocused();
  await page.getByRole('radio', { name: 'keyword' }).click();
  await page.keyboard.type('uusi');
  await expect(page.locator('.search-hits li').first()).toContainText('Uusi');
  await page.keyboard.press('Enter');
  await expect(page.locator('.doc-panel h2')).toHaveText('Uusi');
});

test('search overlay: "/" opens, auto mode fuses, clicking a hit opens the doc panel', async ({ page }) => {
  await page.goto(baseURL() + '/');
  await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });

  await page.keyboard.press('/');
  await expect(page.locator('.search-box input')).toBeFocused();
  await page.keyboard.type('aurinko');
  // auto fuses keyword+semantic (RRF) — assert the hit exists, not its rank
  await expect(hitTitled(page, 'Aurinko')).toBeVisible();
  await expect(page.locator('.degraded-chip')).toHaveCount(0); // nothing degraded: T2 answered

  await hitTitled(page, 'Aurinko').click();
  await expect(page.locator('.doc-panel h2')).toHaveText('Aurinko');
  await expect(page.locator('.doc-panel .doc-body')).toContainText('The sun sits at the center');
});

test('search modes: the switch is visible, keyboard-reachable, graph parked behind T3', async ({ page }) => {
  await page.goto(baseURL() + '/');
  await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });

  await page.locator('.search-fab').click(); // the touch way in — no keyboard needed
  const group = page.getByRole('radiogroup', { name: 'search mode' });
  await expect(group).toBeVisible();
  await expect(group.getByRole('radio', { name: 'auto' })).toHaveAttribute('aria-checked', 'true');
  await expect(group.getByRole('radio', { name: 'keyword' })).toBeVisible();
  await expect(group.getByRole('radio', { name: 'semantic' })).toBeVisible();
  const graph = group.getByRole('radio', { name: /graph/ });
  await expect(graph).toBeDisabled();
  await expect(graph).toContainText('T3 — coming');
});

test('semantic mode answers end-to-end from the real T2 vectors', async ({ page }) => {
  await page.goto(baseURL() + '/');
  await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });

  await page.keyboard.press('/');
  await page.getByRole('radio', { name: 'semantic' }).click();
  await page.keyboard.type('aurinko'); // mode click hands focus back to the input
  await expect(page.locator('.search-hits li').first()).toBeVisible();
  await expect(page.locator('.degraded-chip')).toHaveCount(0);
  await page.waitForFunction(() => {
    const meta = window.__bp_store.getState().searchMeta;
    return meta !== null && meta.usedModes.join(',') === 'semantic' && meta.degradedFrom === null;
  });
});

test('semantic on a T2-less bundle degrades honestly — the chip says so', async ({ page }) => {
  await page.goto(t2lessURL() + '/');
  await expect(page.locator('.hud-stats')).toContainText('10 docs', { timeout: 30_000 });
  await expect(page.locator('.hud-tiers')).toContainText('t2 off');

  await page.keyboard.press('/');
  await page.getByRole('radio', { name: 'semantic' }).click();
  await page.keyboard.type('aurinko');
  await expect(page.locator('.search-hits li').first()).toBeVisible(); // keyword still answers
  await expect(page.locator('.degraded-chip')).toHaveText('semantic unavailable — keyword answered');
});

test('the orphan lens dims the cosmos around the orphans; the ghost toggle flips the layer', async ({ page }) => {
  await page.goto(baseURL() + '/');
  await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });

  await page.getByRole('button', { name: 'orphans' }).click();
  await page.waitForFunction(() => {
    const s = window.__bp_store.getState();
    return s.lens.kind === 'orphans' && s.dimOthers && s.highlight.has('yksinainen.md');
  });

  await page.getByRole('button', { name: 'orphans' }).click(); // toggle off releases the dim
  await page.waitForFunction(() => {
    const s = window.__bp_store.getState();
    return s.lens.kind === 'none' && !s.dimOthers && s.highlight.size === 0;
  });

  await expect(page.getByRole('button', { name: /ghosts/ })).toBeVisible();
  await page.getByRole('button', { name: /ghosts/ }).click();
  await page.waitForFunction(() => !window.__bp_store.getState().showGhosts);
  await page.keyboard.press('g'); // and the key path
  await page.waitForFunction(() => window.__bp_store.getState().showGhosts);
});

test('camera save slots: shift+1 saves the view, 1 recalls it, 0 fits the cosmos', async ({ page }) => {
  await page.goto(baseURL() + '/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });
  await expect(page.locator('.slot-btn.filled')).toHaveCount(0);

  await page.keyboard.press('Shift+Digit1');
  await page.waitForFunction(() => {
    const pose = window.__bp_store.getState().bookmarks[0];
    return pose !== null && pose !== undefined && Number.isFinite(pose.x) && Number.isFinite(pose.zoom);
  });
  await expect(page.locator('.slot-btn.filled')).toHaveCount(1); // the slot indicator fills

  await page.keyboard.press('Digit1');
  await page.waitForFunction(() => {
    const s = window.__bp_store.getState();
    const saved = s.bookmarks[0];
    return (
      s.cameraCommand?.kind === 'pose' &&
      saved != null &&
      s.cameraCommand.pose.x === saved.x &&
      s.cameraCommand.pose.zoom === saved.zoom
    );
  });

  const nonceBefore = await page.evaluate(() => window.__bp_store.getState().cameraCommand?.nonce ?? 0);
  await page.keyboard.press('Digit0');
  await page.waitForFunction(
    (prev) => {
      const cmd = window.__bp_store.getState().cameraCommand;
      return cmd?.kind === 'overview' && cmd.nonce === prev + 1;
    },
    nonceBefore,
  );
});

test('PWA: the manifest is linked and served', async ({ page }) => {
  await page.goto(baseURL() + '/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  const manifest = await page.request.get(baseURL() + '/manifest.webmanifest');
  expect(manifest.status()).toBe(200);
  expect((await manifest.json()).name).toBe('brainpick');
});
