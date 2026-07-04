/**
 * End-to-end against the REAL Python engine (no mocks): global-setup copies the
 * kotiaurinko fixture to three tmp bundles and spawns `uv run brainpick serve`
 * on ephemeral ports — the primary with the mock embedder (T2 fresh: semantic
 * search answers from real vectors), a second without (T2 off: semantic
 * degrades honestly), and a third with a staged T3 export (tiers.t3 fresh:
 * /api/graph?layer=entities returns real entities). Tests run serially — the
 * primary bundle mutates on purpose (test 2).
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
    __bp_runtime: {
      ids: string[];
      liveCount: number;
      /** Holographic brain: the live morph value + lazy-layout / orbit signals. */
      morph: number;
      brainReady: boolean;
      orbited: boolean;
      brainAzimuth: number;
      brainPositions: Float32Array;
      /** Set while brain mode is mounted: project a node to client pixels. */
      projectNodeToScreen: ((i: number) => { x: number; y: number } | null) | null;
      positions: Float32Array;
      /**
       * Live mirror of the ACTIVE render camera (PointerControls refreshes it each
       * frame). After the brain→cosmos return the flat cosmos MUST be drawn by the
       * ortho camera with `frustumAspect` matching `viewportAspect` — a stale ortho
       * frustum (a resize during brain mode) is the horizontal-stretch regression.
       */
      activeCamera: {
        ortho: boolean;
        zoom: number;
        frustumAspect: number;
        viewportAspect: number;
      } | null;
    };
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

function t3URL(): string {
  const url = process.env.BP_E2E_URL_T3;
  if (!url) throw new Error('BP_E2E_URL_T3 missing — did global-setup run?');
  return url;
}

/** The entity render-id marker (state/entities.ts ENTITY_MARK), for pixel-free asserts. */
const ENTITY_MARK = '\u0000entity:';

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

test('entity layer: the toggle switches to the extracted entity graph — gems, not docs', async ({ page }) => {
  await page.goto(t3URL() + '/');
  await expect(page.locator('.hud-stats')).toContainText('10 docs', { timeout: 30_000 });

  // Availability is proven by the endpoint (200), not by tiers.t3 — a staged
  // export serves entities even while the compiler still reports t3 off.
  const entities = page.getByRole('radio', { name: 'entities' });
  await expect(entities).toBeEnabled();
  await entities.click();

  // the entity graph loads (6 entities from the fixture) and the layer flips
  await page.waitForFunction(() => {
    const s = window.__bp_store.getState();
    return s.layer === 'entities' && s.entityAvailability === 'available' && (s.entityGraph?.nodes.length ?? 0) === 6;
  });

  // the SCENE now draws entity render-nodes — distinct from the 10 docs
  const rendered = await page.evaluate((mark) => {
    const rt = window.__bp_runtime;
    return {
      count: rt.ids.length,
      allEntities: rt.ids.every((id) => id.startsWith(mark)),
      anyDoc: rt.ids.some((id) => id.endsWith('.md')),
    };
  }, ENTITY_MARK);
  expect(rendered.count).toBe(6);
  expect(rendered.allEntities).toBe(true);
  expect(rendered.anyDoc).toBe(false);

  await expect(page.locator('.layer-legend')).toContainText('entities');
});

test('entity layer: overlay draws BOTH the doc graph and the entity graph', async ({ page }) => {
  await page.goto(t3URL() + '/');
  await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });

  await page.getByRole('radio', { name: 'overlay' }).click();
  await page.waitForFunction(() => {
    const s = window.__bp_store.getState();
    return s.layer === 'overlay' && s.entityAvailability === 'available';
  });

  const rendered = await page.evaluate((mark) => {
    const rt = window.__bp_runtime;
    const entities = rt.ids.filter((id) => id.startsWith(mark)).length;
    return { docs: rt.ids.length - entities, entities };
  }, ENTITY_MARK);
  expect(rendered.docs).toBeGreaterThanOrEqual(10); // the doc graph is still there
  expect(rendered.entities).toBe(6); // and the entity graph on top
  await expect(page.locator('.layer-legend')).toContainText('docs');
  await expect(page.locator('.layer-legend')).toContainText('mentions');
});

test('entity layer: selecting an entity shows its source docs; a source doc reaches the doc layer', async ({ page }) => {
  await page.goto(t3URL() + '/');
  await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });

  await page.getByRole('radio', { name: 'entities' }).click();
  await page.waitForFunction(() => window.__bp_store.getState().entityAvailability === 'available');
  // grounding (source docs) is reconstructed from /api/neighbors in the background
  await page.waitForFunction(() => window.__bp_store.getState().grounding.has('aurinko'));

  // selecting the entity — what a gem click does — opens the entity panel
  await page.evaluate(() => window.__bp_store.getState().selectEntity('aurinko'));
  const panel = page.locator('.entity-panel');
  await expect(panel.locator('h2')).toHaveText('Aurinko');
  await expect(panel).toContainText('star');
  await expect(panel.getByRole('button', { name: 'aurinko.md' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'planeetat.md' })).toBeVisible();

  // clicking a source doc jumps to the doc layer (overlay) and selects it
  await panel.getByRole('button', { name: 'planeetat.md' }).click();
  await page.waitForFunction(() => {
    const s = window.__bp_store.getState();
    return s.layer === 'overlay' && s.selection === 'planeetat.md' && s.entitySelection === null;
  });
});

test('entity layer: a T3-less bundle degrades on select — toggle tags it, view stays links', async ({ page }) => {
  await page.goto(t2lessURL() + '/');
  await expect(page.locator('.hud-stats')).toContainText('10 docs', { timeout: 30_000 });
  await expect(page.locator('.hud-tiers')).toContainText('t3 off');

  // Picking entities probes /api/graph?layer=entities → 404 → unavailable, and
  // the view falls back to links (no crash, no error).
  await page.getByRole('radio', { name: 'entities' }).click();
  await page.waitForFunction(() => {
    const s = window.__bp_store.getState();
    return s.entityAvailability === 'unavailable' && s.layer === 'links';
  });

  const entities = page.getByRole('radio', { name: 'entities' });
  await expect(entities).toBeDisabled();
  await expect(entities).toContainText('T3 not compiled');

  // links still render, and no entity chrome leaks into links mode
  await expect(page.locator('canvas')).toBeVisible();
  const count = await page.evaluate(() => window.__bp_runtime.ids.length);
  expect(count).toBeGreaterThanOrEqual(10);
  await expect(page.locator('.layer-legend')).toHaveCount(0);
  await expect(page.locator('.entity-panel')).toHaveCount(0);
});

test.describe('holographic brain', () => {
  test('the cosmos is byte-untouched until the brain is entered — the layout is lazy', async ({ page }) => {
    await page.goto(baseURL() + '/');
    await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });
    // Never toggled: no brain layout has been computed and the morph is at rest.
    const s = await page.evaluate(() => ({
      mode: window.__bp_store.getState().mode,
      morphActive: window.__bp_store.getState().morphActive,
      brainReady: window.__bp_runtime.brainReady,
      brainPts: window.__bp_runtime.brainPositions.length,
      morph: window.__bp_runtime.morph,
    }));
    expect(s.mode).toBe('cosmos');
    expect(s.morphActive).toBe(false);
    expect(s.brainReady).toBe(false); // nothing computed yet
    expect(s.brainPts).toBe(0);
    expect(s.morph).toBe(0);
  });

  test('key b morphs into the brain and back; the canvas stays alive, no crash', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    await page.goto(baseURL() + '/');
    await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });

    await page.keyboard.press('b');
    // The brain layout is computed lazily on entry (store/runtime flags, no pixels).
    await page.waitForFunction(() => {
      const s = window.__bp_store.getState();
      const rt = window.__bp_runtime;
      return s.mode === 'brain' && s.morphActive && rt.brainReady && rt.brainPositions.length > 0;
    });
    // A morph-complete signal is observable: uMorph animates to 1.
    await page.waitForFunction(() => window.__bp_runtime.morph > 0.9);

    // The WebGL context is alive (like the existing scene e2e, assert the
    // context, not pixels — canvas pixels are not deterministic).
    await expect(page.locator('canvas')).toBeVisible();
    const contextAlive = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      const gl = c && ((c.getContext('webgl2') as WebGLRenderingContext | null) ?? (c.getContext('webgl') as WebGLRenderingContext | null));
      return !!gl && !gl.isContextLost();
    });
    expect(contextAlive).toBe(true);

    // Back to the cosmos: the morph unwinds and the flat 2D view returns.
    await page.keyboard.press('b');
    await page.waitForFunction(() => {
      const s = window.__bp_store.getState();
      return s.mode === 'cosmos' && !s.morphActive && window.__bp_runtime.morph < 0.05;
    });

    expect(pageErrors).toEqual([]); // no uncaught exceptions across the morph
  });

  test('the HUD button toggles the brain, and a drag orbits the camera', async ({ page }) => {
    await page.goto(baseURL() + '/');
    await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });

    await page.getByRole('button', { name: 'brain' }).click();
    await page.waitForFunction(() => window.__bp_store.getState().mode === 'brain' && window.__bp_runtime.morph > 0.9);
    // the pill now offers the way back
    await expect(page.getByRole('button', { name: 'cosmos' })).toBeVisible();

    // Drag across the canvas → the perspective orbit camera reacts. `orbited` is
    // set by the pointer handler itself, so the assertion is frame-independent.
    const box = await page.locator('canvas').boundingBox();
    if (!box) throw new Error('canvas has no box');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(cx + i * 14, cy - i * 3);
    await page.mouse.up();
    await page.waitForFunction(() => window.__bp_runtime.orbited === true);

    // and back to cosmos restores the 2D view
    await page.getByRole('button', { name: 'cosmos' }).click();
    await page.waitForFunction(() => window.__bp_store.getState().mode === 'cosmos' && window.__bp_runtime.morph < 0.05);
  });

  test('clicking a node in brain mode opens its article (3D picking, no regression)', async ({ page }) => {
    await page.goto(baseURL() + '/');
    await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });

    await page.keyboard.press('b');
    await page.waitForFunction(() => {
      const rt = window.__bp_runtime;
      return window.__bp_store.getState().mode === 'brain' && rt.brainReady && rt.morph > 0.9 && !!rt.projectNodeToScreen;
    });

    // Find a real doc node whose projected dot sits comfortably on screen, and
    // click it — the 3D picker must select it and open the doc panel.
    const target = await page.evaluate(() => {
      const rt = window.__bp_runtime;
      const proj = rt.projectNodeToScreen!;
      for (let i = 0; i < rt.ids.length; i++) {
        const id = rt.ids[i]!;
        if (!id.endsWith('.md')) continue;
        const p = proj(i);
        if (!p) continue;
        if (p.x > 90 && p.y > 90 && p.x < window.innerWidth - 90 && p.y < window.innerHeight - 140) {
          return { id, x: Math.round(p.x), y: Math.round(p.y) };
        }
      }
      return null;
    });
    expect(target, 'a doc dot was on screen to click').not.toBeNull();

    await page.mouse.click(target!.x, target!.y);
    // A dot was selected (front-most under the cursor) and its article opened.
    await page.waitForFunction(() => {
      const s = window.__bp_store.getState();
      return s.selection !== null && s.selection.endsWith('.md');
    });
    await expect(page.locator('.doc-panel')).toBeVisible();
    await expect(page.locator('.doc-panel h2')).toBeVisible();
  });

  test('the brain turns on its own axis like a galaxy, and a gesture pauses the spin', async ({ page }) => {
    await page.goto(baseURL() + '/');
    await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });

    await page.keyboard.press('b');
    await page.waitForFunction(() => {
      const rt = window.__bp_runtime;
      return window.__bp_store.getState().mode === 'brain' && rt.brainReady && rt.morph > 0.9;
    });

    // The idle turntable advances the azimuth WITHOUT any interaction — active the
    // moment we enter brain mode (it is a movie shot, not a still).
    const a0 = await page.evaluate(() => window.__bp_runtime.brainAzimuth);
    await page.waitForFunction((prev) => Math.abs(window.__bp_runtime.brainAzimuth - prev) > 0.05, a0);

    // A drag pauses the spin: within the resume window the azimuth barely moves
    // (the idle spin would advance ~0.14 rad over the same ~0.9 s).
    const box = await page.locator('canvas').boundingBox();
    if (!box) throw new Error('canvas has no box');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(cx + i * 12, cy - i * 2);
    await page.mouse.up();
    await page.waitForFunction(() => window.__bp_runtime.orbited === true);
    await page.waitForTimeout(700); // let the drag's damping settle, still inside the pause window
    const b0 = await page.evaluate(() => window.__bp_runtime.brainAzimuth);
    await page.waitForTimeout(900);
    const b1 = await page.evaluate(() => window.__bp_runtime.brainAzimuth);
    expect(Math.abs(b1 - b0)).toBeLessThan(0.03); // paused by the gesture
  });

  test('returning from brain restores the flat camera cleanly: no stretch, dots clickable again', async ({ page }) => {
    // The regression this guards (Hologrammi V): the brain→cosmos return left the
    // ortho cosmos camera behind. If the viewport changed while the perspective
    // brain camera was active, R3F only refreshed THAT camera's frustum, so the
    // ortho camera came back with a stale aspect (the flat dots rendered stretched)
    // and picking read the wrong camera (clicks missed). We force the exact
    // conditions: resize DURING brain mode, then return.
    await page.setViewportSize({ width: 1000, height: 720 });
    await page.goto(baseURL() + '/');
    await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });
    await page.waitForFunction(() => {
      const rt = window.__bp_runtime;
      return rt.liveCount > 0 && rt.activeCamera !== null && rt.positions.length >= rt.liveCount * 2;
    });

    // Fresh cosmos: the ortho camera draws it with a viewport-matched frustum.
    await page.waitForFunction(() => {
      const c = window.__bp_runtime.activeCamera!;
      return c.ortho && Math.abs(c.frustumAspect - c.viewportAspect) < 0.02;
    });

    // Into the brain, then RESIZE to a very different aspect while it is on screen
    // (this is what leaves the ortho frustum stale on the buggy build).
    await page.keyboard.press('b');
    await page.waitForFunction(() => {
      const rt = window.__bp_runtime;
      return window.__bp_store.getState().mode === 'brain' && rt.brainReady && rt.morph > 0.9;
    });
    await page.setViewportSize({ width: 720, height: 1000 });
    await page.waitForFunction(() => Math.abs(window.__bp_runtime.activeCamera!.viewportAspect - 0.72) < 0.05);

    // Back to the cosmos; let the morph settle fully.
    await page.keyboard.press('b');
    await page.waitForFunction(() => {
      const s = window.__bp_store.getState();
      return s.mode === 'cosmos' && !s.morphActive && window.__bp_runtime.morph < 0.02;
    });
    await page.waitForFunction(() => window.__bp_runtime.activeCamera!.ortho === true);

    // (b) STRETCH SENTINEL: the flat cosmos is drawn by the ortho camera and its
    // frustum aspect matches the (resized) viewport — round dots, no stretch.
    const cam = await page.evaluate(() => window.__bp_runtime.activeCamera!);
    expect(cam.ortho).toBe(true);
    expect(Math.abs(cam.frustumAspect - cam.viewportAspect)).toBeLessThan(0.02);

    // (a) CLICKABLE AGAIN: a doc node clicked where it renders opens its article.
    // The ortho camera is centered on the origin, so screen = centre + world·zoom
    // holds exactly once the frustum matches the viewport (the fix).
    const target = await page.evaluate(() => {
      const rt = window.__bp_runtime;
      const z = rt.activeCamera!.zoom;
      const W = window.innerWidth;
      const H = window.innerHeight;
      for (let i = 0; i < rt.liveCount; i++) {
        const id = rt.ids[i]!;
        if (!id.endsWith('.md')) continue;
        const x = Math.round(W / 2 + (rt.positions[i * 2] ?? 0) * z);
        const y = Math.round(H / 2 - (rt.positions[i * 2 + 1] ?? 0) * z);
        if (x > 90 && y > 110 && x < W - 90 && y < H - 150) return { id, x, y };
      }
      return null;
    });
    expect(target, 'a doc dot was on screen to click').not.toBeNull();

    await page.mouse.click(target!.x, target!.y);
    await page.waitForFunction((id) => window.__bp_store.getState().selection === id, target!.id);
    await expect(page.locator('.doc-panel')).toBeVisible();
    await expect(page.locator('.doc-panel h2')).toBeVisible();
  });
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the holographic brain toggle + orbit work by touch on a phone', async ({ page }) => {
    await page.goto(baseURL() + '/');
    await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });

    // the mode pill is reachable and taps into the brain
    await page.getByRole('button', { name: 'brain' }).tap();
    await page.waitForFunction(() => {
      const s = window.__bp_store.getState();
      return s.mode === 'brain' && window.__bp_runtime.brainReady;
    });
    await page.waitForFunction(() => window.__bp_runtime.morph > 0.9);

    // a one-finger touch drag orbits the brain
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!;
      const r = canvas.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const ev = (type: string, x: number, y: number) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            pointerType: 'touch',
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            buttons: type === 'pointerup' ? 0 : 1,
          }),
        );
      ev('pointerdown', cx, cy);
      for (let i = 1; i <= 10; i++) ev('pointermove', cx - i * 10, cy + i * 2);
      ev('pointerup', cx - 100, cy + 20);
    });
    await page.waitForFunction(() => window.__bp_runtime.orbited === true);
  });

  test('the layer toggle + entity legend are reachable on a phone', async ({ page }) => {
    await page.goto(t3URL() + '/');
    await expect(page.locator('.hud-stats')).toContainText('docs', { timeout: 30_000 });

    const entities = page.getByRole('radio', { name: 'entities' });
    await expect(entities).toBeVisible();
    await entities.tap();
    await page.waitForFunction(() => window.__bp_store.getState().layer === 'entities');
    await expect(page.locator('.layer-legend')).toBeVisible();
  });

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
