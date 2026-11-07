import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Unit tests must not inherit a developer's local .env files.
  envDir: false,
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
});
