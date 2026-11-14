import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const server = new URL('../../../apps/server/src/', import.meta.url);
export default defineConfig({
  envDir: false,
  resolve: {
    alias: {
      '@nibleaf/qdrant': fileURLToPath(new URL('../../../packages/qdrant/src/index.ts', import.meta.url)),
      '@nibleaf/search/workspace': fileURLToPath(new URL('../../../packages/search/src/workspace.ts', import.meta.url)),
      '@nibleaf/storage': fileURLToPath(new URL('../../../packages/storage/src/index.ts', import.meta.url)),
      '@/lib/ai-search/runtime': fileURLToPath(
        new URL(process.env.SEARCH_BENCH_BASELINE === '1' ? 'lib/ai-search/runtime.before.ts' : 'lib/ai-search/runtime.ts', server),
      ),
      '@': fileURLToPath(server),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/reader-search-latency/benchmark.ts'],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 120_000,
  },
});
