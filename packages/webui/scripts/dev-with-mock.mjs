#!/usr/bin/env node
/**
 * `npm run dev:mock` — start the mock API server (port 4747, matching the
 * vite proxy) and the vite dev server together; kill both together.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createMockServer } from './mock-server.mjs';

// vite's exports map hides ./bin — resolve it through package.json instead.
const require = createRequire(import.meta.url);
const vitePkgPath = require.resolve('vite/package.json');
const viteBin = join(dirname(vitePkgPath), require('vite/package.json').bin.vite);

const port = Number(process.env.MOCK_PORT ?? '4747');
const stepMs = Number(process.env.MOCK_STEP_MS ?? '6000');
const mock = createMockServer({ stepMs });
await mock.start(port);
console.log(`[dev:mock] mock API on http://127.0.0.1:${port}, deltas every ${stepMs} ms`);

const vite = spawn(process.execPath, [viteBin], { stdio: 'inherit' });

const shutdown = (code = 0) => {
  mock.stop();
  if (vite.exitCode === null) vite.kill('SIGTERM');
  process.exit(code);
};
vite.on('exit', (code) => shutdown(code ?? 0));
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
