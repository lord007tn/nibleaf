import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Standalone vitest config (does not load the TanStack Start vite plugins) so unit
// tests run fast in a plain node environment. The `@` alias mirrors tsconfig paths.
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
