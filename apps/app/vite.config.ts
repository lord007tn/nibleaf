import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite';
import viteTsConfigPaths from 'vite-tsconfig-paths';

const API_TARGET = process.env.VITE_API_URL ?? 'http://localhost:4311';

export default defineConfig({
  server: { port: 4310 },
  plugins: [
    viteTsConfigPaths({ projects: ['./tsconfig.json'] }),
    tailwindcss(),
    // Same-origin /api proxy: the browser only talks to the dashboard origin, so
    // better-auth session cookies stay first-party. All /api/** → the Plume API.
    nitro({
      routeRules: {
        '/api/**': { proxy: `${API_TARGET}/api/**` },
      },
    }),
    tanstackStart(),
    viteReact(),
  ],
});
