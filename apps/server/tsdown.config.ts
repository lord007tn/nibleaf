import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/rpc.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node26',
  dts: true,
  clean: true,
  sourcemap: true,
});
