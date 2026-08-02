/**
 * Static-snapshot stand-in for `virtual:pwa-register` (vite.config.ts aliases
 * it here when the PWA plugin is off). The registration guard in main.tsx
 * never runs in static builds — this exists purely so Rollup can resolve the
 * dynamic import.
 */
export function registerSW(_options?: unknown): void {
  /* a static snapshot installs no service worker */
}
