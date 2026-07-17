import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Standalone unit-test config: plain node environment, no server bootstrap.
// The `@` alias mirrors tsconfig paths so modules under test that import
// `@/…` (e.g. `@/errors`) resolve without loading the app entrypoint.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
