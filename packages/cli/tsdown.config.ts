import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/cli.ts', 'src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: true,
  clean: true,
  sourcemap: true,
});
