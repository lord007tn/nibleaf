import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/keys.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: true,
  clean: true,
  sourcemap: true,
});
