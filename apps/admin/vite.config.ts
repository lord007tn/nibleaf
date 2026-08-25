import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { createEnv } from '@t3-oss/env-core';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig, loadEnv } from 'vite';
import { z } from 'zod';

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

export default defineConfig(({ mode }) => {
  const configEnv = createEnv({
    server: { VITE_API_URL: z.url().default('http://localhost:4311') },
    runtimeEnv: loadEnv(mode, process.cwd(), ''),
    emptyStringAsUndefined: true,
  });
  const apiTarget = configEnv.VITE_API_URL;
  return {
    resolve: { tsconfigPaths: true },
    server: { port: 4315 },
    plugins: [
      paraglideVitePlugin({
        project: '../../packages/i18n/project.inlang',
        outdir: '../../packages/i18n/src/paraglide',
        emitTsDeclarations: true,
        strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
        cookieName: 'NIBLEAF_LOCALE',
      }),
      tailwindcss(),
      // Same-origin /api proxy: the browser only talks to the admin origin, so the
      // better-auth session cookie stays first-party. All /api/** → the Nibleaf API.
      nitro({
        // Rolldown can otherwise split the SSR service into mutually importing
        // chunks and evaluate runtime helpers before they are initialized.
        inlineDynamicImports: true,
        routeRules: {
          '/**': { headers: SECURITY_HEADERS },
          '/api/**': { proxy: `${apiTarget}/api/**` },
        },
      }),
      tanstackStart(),
      viteReact({ compiler: true }),
    ],
  };
});
