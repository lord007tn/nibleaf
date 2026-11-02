import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Standalone vitest config (does not load the TanStack Start vite plugins) so unit
// tests run fast in a plain node environment. The `@` alias mirrors tsconfig paths.
export default defineConfig({
  test: {
    environment: 'node',
    // Vitest 5.0.5 caches typed import.meta.glob<T>, hiding added or removed MDX files.
    fsModuleCache: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
