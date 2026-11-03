import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/keys.ts', 'src/workspace.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: true,
  clean: true,
  sourcemap: true,
});
