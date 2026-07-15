import mdx from '@mdx-js/rollup';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
import { defineConfig } from 'vite';
import viteTsConfigPaths from 'vite-tsconfig-paths';

const API_TARGET = process.env.VITE_API_URL ?? 'http://localhost:4311';

// Baseline browser hardening for every dashboard, marketing, and published-site
// response. A full CSP is intentionally deferred: TanStack Start hydration uses
// inline scripts and needs a nonce-based policy rather than an unsafe blanket.
const SECURITY_HEADERS = {
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
};

export default defineConfig({
  server: { port: 4310 },
  plugins: [
    // Blog articles (src/content/**). `enforce: 'pre'` so .mdx compiles before the
    // React plugin sees it. remark-mdx-frontmatter turns the YAML block into an
    // `export const frontmatter`, which lib/blog.ts reads to build the article
    // registry — adding an article is one .mdx file, no codegen and no index edit.
    { enforce: 'pre', ...mdx({ remarkPlugins: [remarkFrontmatter, [remarkMdxFrontmatter, { name: 'frontmatter' }], remarkGfm] }) },
    viteTsConfigPaths({ projects: ['./tsconfig.json'] }),
    tailwindcss(),
    // Same-origin /api proxy: the browser only talks to the dashboard origin, so
    // better-auth session cookies stay first-party. All /api/** → the Nibleaf API.
    // Custom-domain serving is handled in src/server.ts (request URL rewrite).
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
