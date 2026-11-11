import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Timing measurements, kept out of the unit suite (`vitest.config.ts` only
// includes `*.test.*`): they are noisy under a loaded run.
// `pnpm --filter @nibleaf/app bench:page-tree` runs them on demand.
export default defineConfig({
  envDir: false,
  test: {
    environment: 'node',
    include: ['src/**/*.bench.{ts,tsx}'],
    testTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
