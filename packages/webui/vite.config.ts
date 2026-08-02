/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// The brainpick server binds 127.0.0.1:4747 (spec/50-rest-api.md); the mock
// server (scripts/mock-server.mjs) binds the same port so `dev` and
// `dev:mock` share this proxy. BP_API_TARGET overrides it when 4747 is
// already taken (e.g. a real engine running alongside dev:mock).
const API_TARGET = process.env.BP_API_TARGET ?? 'http://127.0.0.1:4747';

// Static-snapshot builds (scripts/build-static-site.mjs): a relative base so
// the export works at any subpath (GitHub Pages serves under /<repo>/), and
// no PWA — a demo snapshot must not install a caching service worker. The
// same flag reaches the app as import.meta.env.VITE_STATIC_SNAPSHOT.
const STATIC_SNAPSHOT = process.env.VITE_STATIC_SNAPSHOT === '1';

export default defineConfig({
  base: STATIC_SNAPSHOT ? './' : '/',
  resolve: {
    alias: STATIC_SNAPSHOT
      ? // With the plugin off its virtual module vanishes; alias the (never
        // executed) dynamic import in main.tsx to a no-op so Rollup resolves.
        { 'virtual:pwa-register': new URL('./src/pwaStub.ts', import.meta.url).pathname }
      : {},
  },
  plugins: [
    react(),
    !STATIC_SNAPSHOT &&
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'brainpick',
        short_name: 'brainpick',
        description: 'Live holographic view of your knowledge bundle',
        theme_color: '#05070f',
        background_color: '#05070f',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/index.html',
        // The SPA fallback must never swallow API routes — /api/live is a
        // long-lived SSE stream and must reach the network untouched.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Offline snapshot of the last graph. /api/live is deliberately
            // NOT matched by any route: SSE bypasses the service worker.
            urlPattern: ({ url }) => url.pathname === '/api/graph',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'brainpick-graph',
              expiration: { maxEntries: 8, maxAgeSeconds: 7 * 24 * 3600 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false },
      // Dev-only: the mock (and a real engine) serves embedded doc images under
      // /assets, so a doc's `![alt](assets/x.png)` renders in the editor preview.
      '/assets': { target: API_TARGET, changeOrigin: false },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
