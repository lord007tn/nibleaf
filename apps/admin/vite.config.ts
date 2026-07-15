import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite';
import viteTsConfigPaths from 'vite-tsconfig-paths';

const API_TARGET = process.env.VITE_API_URL ?? 'http://localhost:4311';

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

export default defineConfig({
  server: { port: 4315 },
  plugins: [
    viteTsConfigPaths({ projects: ['./tsconfig.json'] }),
    tailwindcss(),
    // Same-origin /api proxy: the browser only talks to the admin origin, so the
    // better-auth session cookie stays first-party. All /api/** → the Nibleaf API.
    nitro({
      routeRules: {
        '/**': { headers: SECURITY_HEADERS },
        '/api/**': { proxy: `${API_TARGET}/api/**` },
      },
    }),
    tanstackStart(),
    viteReact(),
  ],
});
