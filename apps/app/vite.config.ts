import mdx from '@mdx-js/rollup';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
import { defineConfig } from 'vite';
import { bundleAnalysisPlugin } from './scripts/bundle-analysis-plugin.ts';
import { messageCatalogPlugin } from './scripts/message-catalog-plugin.ts';

const API_TARGET = process.env.VITE_API_URL ?? 'http://localhost:4311';

// Baseline browser hardening for every dashboard, marketing, and published-site
// response. The custom server entry adds the per-response nonce-based CSP to
// HTML after TanStack Start has created its streaming response.
const SECURITY_HEADERS = {
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
};

export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    port: 4310,
    // Vite's static middleware claims unknown dotted paths before Nitro in
    // development. Route imported media directly to the API at that layer.
    proxy: { '/api/public/assets': { target: API_TARGET, changeOrigin: true } },
  },
  plugins: [
    messageCatalogPlugin(),
    bundleAnalysisPlugin(),
    // Blog articles (src/content/**). `enforce: 'pre'` so .mdx compiles before the
    // React plugin sees it. remark-mdx-frontmatter turns the YAML block into an
    // `export const frontmatter` for the article module. Production metadata
    // comes from the lightweight manifest; a test deep-compares it to every MDX
    // frontmatter block so bodies never enter the homepage bundle.
    { enforce: 'pre', ...mdx({ remarkPlugins: [remarkFrontmatter, [remarkMdxFrontmatter, { name: 'frontmatter' }], remarkGfm] }) },
    tailwindcss(),
    // Same-origin /api proxy: the browser only talks to the dashboard origin, so
    // better-auth session cookies stay first-party. All /api/** → the Nibleaf API.
    // Custom-domain serving is handled in src/server.ts (request URL rewrite).
    nitro({
      routeRules: {
        '/**': { headers: SECURITY_HEADERS },
        // Nitro otherwise treats dotted asset keys as app/static paths before
        // the broad API proxy, leaving imported images as published-site 404s.
        '/api/public/assets/**': { proxy: `${API_TARGET}/api/public/assets/**` },
        '/api/**': { proxy: `${API_TARGET}/api/**` },
      },
    }),
    tanstackStart(),
    viteReact(),
  ],
});
