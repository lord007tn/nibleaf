import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  envDir: false,
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: [
      { find: '@nibleaf/design-system/components/ui/dialog', replacement: fileURLToPath(new URL('./observed-dialog.tsx', import.meta.url)) },
      { find: '@/providers/site-analytics-provider', replacement: fileURLToPath(new URL('./fixtures.ts', import.meta.url)) },
      { find: '@/functions/site-search', replacement: fileURLToPath(new URL('./fixtures.ts', import.meta.url)) },
      { find: '@/lib/site-origin', replacement: fileURLToPath(new URL('./fixtures.ts', import.meta.url)) },
      { find: '@', replacement: fileURLToPath(new URL('../../src', import.meta.url)) },
    ],
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: { input: fileURLToPath(new URL('./index.html', import.meta.url)) },
  },
  preview: {
    host: '127.0.0.1',
    port: 4310,
    strictPort: true,
    proxy: { '/api': 'http://localhost:4410' },
  },
});
