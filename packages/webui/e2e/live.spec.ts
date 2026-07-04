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

// Written into saaret/ by the navigator live test — the tree must show the
// join in the right directory without a reload. (The root-level uusi.md is
// already spent by the earlier serial test.)
const REEF_DOC = [
  '---',
  'type: Concept',
  'title: Riutta',
  'description: A reef just off the atoll.',
  'timestamp: 2026-07-04T09:00:00Z',
  '---',
  '',
  '# Riutta',
  '',
  'It shelters the [Atolli](atolli.md).',
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

test('the navigator opens via key n and the HUD button, mirroring the bundle tree', async ({ page }) => {
  await page.goto(baseURL() + '/');
  await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });

  await page.keyboard.press('n');
  await expect(page.locator('.navigator-panel')).toBeVisible();
  await page.waitForFunction(() => window.__bp_store.getState().navigatorOpen);

  // the fixture tree: the saaret dir with its 2 docs, default-expanded (≤3 dirs)
  const saaret = page.locator('.nav-dir', { hasText: 'saaret' });
  await expect(saaret).toBeVisible();
  await expect(saaret.locator('.nav-count')).toHaveText('2');
  await expect(page.locator('.nav-doc', { hasText: /^Atolli$/ })).toBeVisible();
  await expect(page.locator('.nav-doc', { hasText: /^Laguuni$/ })).toBeVisible();
  // reserved docs stay listed but de-emphasized; the orphan carries its dot
  await expect(page.locator('.nav-doc.reserved')).toHaveCount(2); // index.md + log.md
  await expect(page.locator('.nav-doc', { hasText: /^Yksinäinen$/ }).locator('.orphan-dot')).toBeVisible();

  await page.keyboard.press('n'); // the key toggles it shut again
  await expect(page.locator('.navigator-panel')).toHaveCount(0);

  await page.getByRole('button', { name: 'tree' }).click(); // the HUD way in
  await expect(page.locator('.navigator-panel')).toBeVisible();
});

test('clicking a doc in the navigator selects it: doc panel, cosmos flight, tree highlight', async ({ page }) => {
  await page.goto(baseURL() + '/');
  await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });

  await page.keyboard.press('n');
  await page.locator('.nav-doc', { hasText: /^Kuu$/ }).click();
  await expect(page.locator('.doc-panel h2')).toHaveText('Kuu');
  await expect(page.locator('.nav-doc.selected')).toHaveText('Kuu');
  await page.waitForFunction(() => {
    const s = window.__bp_store.getState();
    return s.selection === 'kuu.md' && s.flyTo?.id === 'kuu.md';
  });
});

test('navigator keyboard: arrows walk the focus ring, left/right fold dirs, enter selects', async ({ page }) => {
  await page.goto(baseURL() + '/');
  await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });

  await page.keyboard.press('n');
  // opening hands focus to the first row — the saaret dir
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-path') === 'saaret');

  await page.keyboard.press('ArrowLeft'); // collapse the dir
  await expect(page.locator('.nav-doc', { hasText: /^Atolli$/ })).toHaveCount(0);
  await page.keyboard.press('ArrowRight'); // unfold it again
  await expect(page.locator('.nav-doc', { hasText: /^Atolli$/ })).toBeVisible();

  await page.keyboard.press('ArrowDown'); // into the first child
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-path') === 'saaret/atolli.md');
  await page.keyboard.press('Enter'); // select it
  await expect(page.locator('.doc-panel h2')).toHaveText('Atolli');
  await expect(page.locator('.navigator-panel')).toBeVisible(); // desktop keeps the panel open
});

test('a doc written into a directory joins the navigator tree live — no reload', async ({ page }) => {
  await page.goto(baseURL() + '/');
  await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });

  await page.keyboard.press('n');
  const saaret = page.locator('.nav-dir', { hasText: 'saaret' });
  await expect(saaret.locator('.nav-count')).toHaveText('2');

  // Mutate the bundle on disk; the watcher recompiles and the delta lands.
  writeFileSync(path.join(bundleDir(), 'saaret', 'riutta.md'), REEF_DOC, 'utf-8');
  await expect(page.locator('.nav-doc', { hasText: /^Riutta$/ })).toBeVisible({ timeout: 30_000 });
  await expect(saaret.locator('.nav-count')).toHaveText('3');
});

test('GPU budget: a small brain is never capped — no proxies, no budget line (honesty)', async ({ page }) => {
  await page.goto(baseURL() + '/');
  await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });

  // Nothing to cull on a tiny fixture: the budget line simply does not exist.
  await expect(page.locator('.hud-budget')).toHaveCount(0);
  const honest = await page.evaluate(() => {
    const s = window.__bp_store.getState();
    return { budget: s.nodeBudget, count: s.nodes.size, expanded: s.expandedDirs.size };
  });
  expect(honest.budget).toBeGreaterThanOrEqual(honest.count); // budget covers the whole brain
  expect(honest.expanded).toBe(0);
});

test('GPU budget: capping the view aggregates culled docs and the HUD says "showing N of M"', async ({ page }) => {
  await page.goto(baseURL() + '/');
  await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });
  const total = await page.evaluate(() => window.__bp_store.getState().nodes.size);

  // Force a cap well under the doc count (store injection hook) -> aggregation.
  await page.evaluate(() => window.__bp_store.getState().setNodeBudget(4));
  const line = page.locator('.hud-budget');
  await expect(line).toBeVisible();
  await expect(line).toContainText(new RegExp(`showing 4 of ${total} nodes`));

  // "show more" (touch + keyboard reachable) raises the budget.
  const before = await page.evaluate(() => window.__bp_store.getState().nodeBudget);
  await page.getByRole('button', { name: 'show more' }).click();
  const after = await page.evaluate(() => window.__bp_store.getState().nodeBudget);
  expect(after).toBeGreaterThan(before);

  // Raise it above the doc count -> honesty restored, the line disappears.
  await page.evaluate(() => window.__bp_store.getState().setNodeBudget(9999));
  await expect(page.locator('.hud-budget')).toHaveCount(0);
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('GPU budget: the phone view is honest too — no budget line on a small brain', async ({ page }) => {
    await page.goto(baseURL() + '/');
    await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });
    await expect(page.locator('.hud-budget')).toHaveCount(0);
  });

  test('the navigator is a slide-in drawer: opens, rows tap-select, ✕ closes', async ({ page }) => {
    await page.goto(baseURL() + '/');
    await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });

    await page.getByRole('button', { name: 'tree' }).tap();
    await expect(page.locator('.navigator-panel')).toBeVisible();
    await expect(page.locator('.nav-scrim')).toBeVisible();

    // tapping a doc selects it AND steps the drawer aside (it covers the doc panel)
    await page.locator('.nav-doc', { hasText: /^Maa$/ }).tap();
    await expect(page.locator('.doc-panel h2')).toHaveText('Maa');
    await expect(page.locator('.navigator-panel')).toHaveCount(0);
    await page.waitForFunction(() => window.__bp_store.getState().selection === 'maa.md');

    // the doc sheet covers the bottom clusters on phones — dismiss it first
    await page.locator('.doc-panel .close').tap();
    await expect(page.locator('.doc-panel')).toHaveCount(0);

    // reopen; the ✕ closes it too
    await page.getByRole('button', { name: 'tree' }).tap();
    await expect(page.locator('.navigator-panel')).toBeVisible();
    await page.getByRole('button', { name: 'close navigator' }).tap();
    await expect(page.locator('.navigator-panel')).toHaveCount(0);
  });
});
