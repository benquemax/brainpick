/**
 * Playwright e2e against the REAL Python engine — the server is spawned in
 * e2e/global-setup.ts (fixture copy + ephemeral port) and torn down in
 * e2e/global-teardown.ts. Serial on purpose: test 2 mutates the tmp bundle.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000, // server-backed flows; uv + compile + SSE round trips take seconds
  expect: { timeout: 20_000 },
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
