import { readFileSync } from 'node:fs';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import mdx from '@mdx-js/rollup';
import { createEnv } from '@t3-oss/env-core';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
import { defineConfig, loadEnv } from 'vite';
import { z } from 'zod';
import { bundleAnalysisPlugin } from './scripts/bundle-analysis-plugin.ts';

// Baseline browser hardening for every dashboard, marketing, and published-site
// response. The custom server entry adds the per-response nonce-based CSP to
// HTML after TanStack Start has created its streaming response.
/** OAuth discovery documents MCP clients fetch from the dashboard origin
 *  (RFC 9728 protected resource, RFC 8414 / OpenID metadata). The API serves
 *  them at its root; see apps/server/src/modules/mcp/oauth-discovery.ts. */
const OAUTH_DISCOVERY_PREFIXES = [
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-authorization-server',
  '/.well-known/openid-configuration',
] as const;

const SECURITY_HEADERS = {
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
};

/** Message files only the published reader's lazily loaded search dialog, article
 * renderer and AI chat panel import, read from those translators' own imports so the
 * list can't drift (packages/i18n/src/site-search.ts, site-content.ts and site-chat.ts). */
const LAZY_SITE_MESSAGES = new RegExp(
  `/paraglide/messages/site_(?:${['site-search.ts', 'site-content.ts', 'site-chat.ts', 'site-access.ts']
    .flatMap((file) =>
      [...readFileSync(new URL(`../../packages/i18n/src/${file}`, import.meta.url), 'utf8').matchAll(/paraglide\/messages\/site_(\w+)\.js/g)].map(
        (match) => match[1],
      ),
    )
    .join('|')})\\.js$`,
);

/** Routes whose loaders only serve the dashboard and its sign-in pages. */
const DASHBOARD_ROUTE = /^\/(?:app(?:\/|$)|\(auth\)(?:\/|$)|accept-invite\/|oauth\/)/;
/** The router's default groupings (component, errorComponent, notFoundComponent;
 *  pendingComponent stays eager so a pending UI can show at once), plus the
 *  loader in its own lazy chunk. */
const DASHBOARD_SPLIT_GROUPINGS = [['loader'], ['component'], ['errorComponent'], ['notFoundComponent']] satisfies Array<
  Array<'loader' | 'component' | 'errorComponent' | 'notFoundComponent'>
>;

export default defineConfig(({ mode }) => {
  const configEnv = createEnv({
    server: { VITE_API_URL: z.url().default('http://localhost:4311') },
    runtimeEnv: loadEnv(mode, process.cwd(), ''),
    emptyStringAsUndefined: true,
  });
  const apiTarget = configEnv.VITE_API_URL;
  return {
    // Keep the manual i18n groups in the browser bundle. Nitro's generated
    // service namespace must stay in one SSR chunk: Rolldown otherwise splits
    // the TanStack Start entry across a cycle and leaves an invalid
    // `ssr_exports` re-export that fails only when the production server starts.
    environments: {
      client: {
        build: {
          rolldownOptions: {
            output: {
              codeSplitting: {
                groups: [
                  {
                    name: 'marketing-faqs',
                    priority: 100,
                    minSize: 0,
                    test: (id) => /\/apps\/app\/src\/lib\/marketing-faqs\.ts$/.test(id.replaceAll('\\', '/')),
                  },
                  {
                    name: 'public-site-i18n',
                    // Messages of the lazily loaded search dialog and article renderer load
                    // with those chunks instead of every published page's first load.
                    test: (id) => {
                      const path = id.replaceAll('\\', '/');
                      return /\/packages\/i18n\/src\/paraglide\/messages\/site_/.test(path) && !LAZY_SITE_MESSAGES.test(path);
                    },
                  },
                  {
                    name: 'standalone-i18n',
                    test: (id) =>
                      /\/packages\/i18n\/src\/paraglide\/messages\/(?:common_loading|error_(?:backhome|badge|title|tryagain|unexpected)|notfound_(?:backhome|badge|body|title))\.js$/.test(
                        id.replaceAll('\\', '/'),
                      ),
                  },
                ],
              },
            },
          },
        },
      },
      ssr: {
        build: {
          rolldownOptions: {
            output: { codeSplitting: false },
          },
        },
      },
    },
    resolve: { tsconfigPaths: true },
    server: {
      port: 4310,
      // Vite's static middleware claims unknown dotted paths before Nitro in
      // development. Route imported media directly to the API at that layer.
      proxy: {
        '/api/public/assets': { target: apiTarget, changeOrigin: true },
        ...Object.fromEntries(OAUTH_DISCOVERY_PREFIXES.map((prefix) => [prefix, { target: apiTarget, changeOrigin: true }])),
      },
    },
    plugins: [
      paraglideVitePlugin({
        project: '../../packages/i18n/project.inlang',
        outdir: '../../packages/i18n/src/paraglide',
        emitTsDeclarations: true,
        // site.ts and standalone.ts intentionally import per-message modules
        // for public-site tree shaking. Pin this in development too: Paraglide
        // otherwise defaults to locale modules and deletes those imports.
        outputStructure: 'message-modules',
        strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
        cookieName: 'NIBLEAF_LOCALE',
      }),
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
          '/api/public/assets/**': { proxy: `${apiTarget}/api/public/assets/**` },
          '/api/**': { proxy: `${apiTarget}/api/**` },
          // MCP clients discover OAuth at the public origin, outside /api.
          ...Object.fromEntries(
            OAUTH_DISCOVERY_PREFIXES.flatMap((prefix) => [
              [prefix, { proxy: `${apiTarget}${prefix}` }],
              [`${prefix}/**`, { proxy: `${apiTarget}${prefix}/**` }],
            ]),
          ),
        },
      }),
      tanstackStart({
        router: {
          codeSplittingOptions: {
            // A route's loader normally stays in the router's eager chunk, which
            // published docs pages load too. Dashboard and sign-in loaders only
            // prefetch dashboard data, so they load with their route instead.
            splitBehavior: ({ routeId }) => (DASHBOARD_ROUTE.test(routeId) ? DASHBOARD_SPLIT_GROUPINGS : undefined),
          },
        },
      }),
      viteReact({ compiler: true }),
    ],
  };
});
