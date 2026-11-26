import { describe, expect, it } from 'vitest';
import {
  forbiddenModuleIds,
  leakedDashboardPreloads,
  marketingSharedReaderIcons,
  preloadTableFiles,
  searchOpenFiles,
  searchOpenZodModules,
} from './bundle-boundaries.mjs';

const root = 'C:/work/nibleaf';
const app = (path) => `${root}/apps/app/src/${path}`;

// What main's public-docs profile held before marketing heads moved into their
// loaders (#345): the marketing SEO helpers and the comparison loader came in
// through route heads and loaders, next to modules the reader really needs.
const readerModules = [
  app('routes/__root.tsx'),
  app('routes/sites/$projectId/route.tsx?tsr-split=component'),
  app('components/site/page-icon.tsx'),
  app('components/root-marketing-analytics.tsx'),
  app('lib/marketing-analytics-route.ts'),
  app('lib/site-language-path.ts'),
  `${root}/node_modules/lucide-react/dist/esm/icons/life-buoy.mjs`,
];
const leakedModules = [
  app('lib/marketing-seo.ts'),
  app('lib/marketing-organization.ts'),
  app('lib/marketing-faqs.ts'),
  app('lib/comparison-loader.ts'),
  app('lib/comparison-page.ts'),
  app('lib/blog-seo.ts'),
  app('functions/marketing.ts'),
  // Feature modules are dashboard code (operations/ui-overhaul.md §7.2).
  app('features/people/api/query-options.ts'),
  app('features/people/model/permissions.ts'),
];

describe('public docs module boundary', () => {
  it('fails when marketing SEO, comparison or GitHub-star code reaches a public profile', () => {
    expect(forbiddenModuleIds([...readerModules, ...leakedModules])).toEqual(leakedModules);
  });

  it('passes the reader and the root route marketing-analytics check', () => {
    expect(forbiddenModuleIds(readerModules)).toEqual([]);
  });

  it('forbids feature components, API and policy models in public profiles', () => {
    const modules = [
      app('features/site-general/components/general-section.tsx'),
      app('features/site-general/api/query-options.ts'),
      app('features/site-access/model/access.ts'),
      app('features/site-general/model/internal/ids.ts'),
      app('features/site-general/components/section-search.ts'),
    ];
    expect(forbiddenModuleIds(modules)).toEqual(modules);
  });

  it('forbids zod in public profiles', () => {
    const zod = [
      `${root}/node_modules/zod/v4/classic/schemas.js`,
      `${root}/node_modules/zod/v4/core/schemas.js`,
      `${root}/node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/classic/coerce.js`,
      `${root}/node_modules/zod/v4/mini/schemas.js`,
      `${root}/node_modules/zod/v4/core/core.js`,
    ];
    expect(forbiddenModuleIds([...zod, app('lib/search-params.ts'), app('lib/zod-csp.ts')])).toEqual(zod);
  });

  it('forbids the session cache, the app-wide query keys and the mutation observer in public profiles', () => {
    const modules = [
      app('integrations/tanstack-query/session-cache.ts'),
      app('hooks/api/query-keys.ts'),
      `${root}/node_modules/@tanstack/query-core/build/modern/mutationObserver.js`,
      `${root}/node_modules/.pnpm/@tanstack+react-query@5.90.0/node_modules/@tanstack/react-query/build/modern/useMutation.js`,
    ];
    const allowed = [
      app('hooks/api/site-query-options.ts'),
      app('integrations/tanstack-query/query-client.ts'),
      `${root}/node_modules/@tanstack/query-core/build/modern/mutationCache.js`,
    ];
    expect(forbiddenModuleIds([...modules, ...allowed])).toEqual(modules);
  });

  it('allows only feature route ids and search parsers needed by non-split route options', () => {
    expect(forbiddenModuleIds([app('features/site-general/model/ids.ts'), app('features/site-general/model/section-search.ts')])).toEqual([]);
  });
});

describe('reader icon chunks shared with marketing (#345)', () => {
  const icon = (name) => ({ id: `${root}/node_modules/lucide-react/dist/esm/icons/${name}.mjs` });
  // #332's case: the reader's `play` chunk grouped two icons until a marketing
  // page imported one of them.
  const chunks = [
    { fileName: 'assets/index.js', imports: [], modules: [{ id: app('routes/__root.tsx') }, icon('loader-circle')] },
    { fileName: 'assets/play.js', imports: [], modules: [icon('play'), icon('zap')] },
    { fileName: 'assets/x.js', imports: [], modules: [icon('x')] },
    { fileName: 'assets/star.js', imports: [], modules: [icon('star')] },
    {
      fileName: 'assets/landing.js',
      imports: ['assets/index.js', 'assets/play.js', 'assets/x.js'],
      modules: [{ id: app('components/marketing/landing/landing-view.tsx') }],
    },
    { fileName: 'assets/pricing.js', imports: [], dynamicImports: ['assets/star.js'], modules: [{ id: app('components/marketing/pricing.tsx') }] },
    { fileName: 'assets/settings.js', imports: ['assets/play.js'], modules: [{ id: app('components/project-settings/general-section.tsx') }] },
  ];
  const publicFiles = new Set(['assets/index.js', 'assets/play.js', 'assets/x.js', 'assets/star.js']);

  it('flags reader icons a marketing chunk newly imports, statically or dynamically', () => {
    expect(marketingSharedReaderIcons(chunks, publicFiles)).toEqual(['play', 'star', 'zap']);
  });

  it('ignores known shared icons, mixed chunks, dashboard importers and icons outside the public profile', () => {
    expect(marketingSharedReaderIcons(chunks, new Set(['assets/index.js', 'assets/x.js']))).toEqual([]);
    expect(
      marketingSharedReaderIcons(
        chunks.filter((chunk) => !chunk.fileName.match(/landing|pricing/)),
        publicFiles,
      ),
    ).toEqual([]);
  });
});

describe('dashboard chunk names in the eager preload table (#393)', () => {
  const route = (file) => app(`routes/${file}?tsr-split=component`);
  const chunk = (fileName, facadeModuleId, imports, moduleIds, dynamicImports = []) => ({
    fileName,
    facadeModuleId,
    imports,
    dynamicImports,
    modules: moduleIds.map((id) => ({ id })),
  });
  const chunks = [
    chunk('assets/index.js', null, [], [app('routes/__root.tsx')], ['assets/sites.js', 'assets/sign-in.js', 'assets/reader.js']),
    chunk('assets/sites.js', route('app/(dashboard)/sites.tsx'), ['assets/table.js', 'assets/session.js'], [route('app/(dashboard)/sites.tsx')]),
    chunk('assets/table.js', null, [], [app('components/app/sites-table.tsx'), app('hooks/api/query-keys.ts')]),
    chunk('assets/session.js', null, [], [app('hooks/api/public.ts')]),
    chunk('assets/sign-in.js', route('(auth)/sign-in.tsx'), ['assets/session.js', 'assets/ui.js'], [route('(auth)/sign-in.tsx')]),
    chunk('assets/ui.js', null, [], [app('components/app/button.tsx'), app('lib/utils.ts')]),
    chunk('assets/reader.js', route('sites/$projectId/$.tsx'), [], [route('sites/$projectId/$.tsx')]),
  ];

  it('reads the file list of a minified preload table', () => {
    const source = 'var a=1;const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/sites.js","assets/table.js"])))=>i.map(i=>d[i]);';
    expect(preloadTableFiles(source)).toEqual(['assets/sites.js', 'assets/table.js']);
    expect(preloadTableFiles('export const a = 1;')).toEqual([]);
  });

  it('flags chunks only dashboard routes load', () => {
    const listed = ['assets/sites.js', 'assets/table.js', 'assets/session.js', 'assets/sign-in.js', 'assets/ui.js', 'assets/reader.js'];
    expect(leakedDashboardPreloads(chunks, 'assets/index.js', listed)).toEqual(['assets/sites.js', 'assets/table.js']);
  });

  it('classifies feature modules as dashboard-only preload chunks', () => {
    const feature = chunk('assets/feature.js', null, [], [app('features/site-general/components/general-section.tsx')]);
    const withFeature = chunks.map((entry) =>
      entry.fileName === 'assets/sites.js' ? { ...entry, imports: [...entry.imports, feature.fileName] } : entry,
    );
    expect(leakedDashboardPreloads([...withFeature, feature], 'assets/index.js', [feature.fileName])).toEqual([feature.fileName]);
    const shared = chunks.map((entry) =>
      entry.fileName === 'assets/sign-in.js' ? { ...entry, imports: [...entry.imports, feature.fileName] } : entry,
    );
    expect(leakedDashboardPreloads([...shared, feature], 'assets/index.js', [feature.fileName])).toEqual([]);
  });

  it('allows dashboard data hooks that sign-in also loads, mixed chunks and CSS', () => {
    expect(leakedDashboardPreloads(chunks, 'assets/index.js', ['assets/session.js', 'assets/ui.js', 'assets/editor.css'])).toEqual([]);
  });
});

describe('zod on search open (#842)', () => {
  const zod = (file) => ({ id: `${root}/node_modules/zod/v4/${file}` });
  const module = (path) => ({ id: app(path) });
  const chunk = (fileName, modules, imports = [], dynamicImports = [], facadeModuleId = null) => ({
    fileName,
    facadeModuleId,
    imports,
    dynamicImports,
    modules,
  });
  // #841's shape: the reader's entry loads the dialog lazily; the dialog chunk
  // pulls in its query hook and the transport. The Ask AI panel is another lazy
  // chunk that may load zod, but not when search opens.
  // Windows builds report the facade with backslashes.
  const dialog = `${root.replaceAll('/', '\\')}\\apps\\app\\src\\components\\site\\site-search-dialog.tsx`;
  const chunks = [
    chunk('assets/index.js', [module('routes/__root.tsx'), module('components/site/site-search.tsx')], [], ['assets/dialog.js', 'assets/ask.js']),
    chunk('assets/dialog.js', [module('components/site/site-search-dialog.tsx')], ['assets/index.js', 'assets/hook.js'], [], dialog),
    chunk('assets/hook.js', [module('hooks/api/site-search.ts'), module('functions/site-search.ts')], ['assets/input.js']),
    chunk('assets/input.js', [module('functions/site-search-input.ts'), { id: `${root}/packages/validators/src/search.ts` }]),
    chunk('assets/ask.js', [module('components/site/ai-chat/panel.tsx')], ['assets/schemas.js']),
    chunk('assets/schemas.js', [zod('classic/schemas.js'), zod('core/core.js')]),
  ];

  it('collects the dialog chunk and its static imports, not lazy chunks', () => {
    expect(searchOpenFiles(chunks)).toEqual(['assets/dialog.js', 'assets/hook.js', 'assets/index.js', 'assets/input.js']);
  });

  it('passes when no chunk loaded on search open holds zod', () => {
    expect(searchOpenZodModules(chunks)).toEqual([]);
  });

  it('fails when zod comes back on search open, through any static import', () => {
    const withZod = chunks.map((entry) => (entry.fileName === 'assets/input.js' ? { ...entry, imports: ['assets/schemas.js'] } : entry));
    expect(searchOpenZodModules(withZod)).toEqual([
      { file: 'assets/schemas.js', id: `${root}/node_modules/zod/v4/classic/schemas.js` },
      { file: 'assets/schemas.js', id: `${root}/node_modules/zod/v4/core/core.js` },
    ]);
    const pnpmZod = { id: `${root}/node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/mini/schemas.js` };
    const inDialog = chunks.map((entry) => (entry.fileName === 'assets/hook.js' ? { ...entry, modules: [...entry.modules, pnpmZod] } : entry));
    expect(searchOpenZodModules(inDialog)).toEqual([{ file: 'assets/hook.js', ...pnpmZod }]);
  });

  it('finds the dialog when it shares a chunk without being its facade', () => {
    const merged = chunks.map((entry) => (entry.fileName === 'assets/dialog.js' ? { ...entry, facadeModuleId: null } : entry));
    expect(searchOpenFiles(merged)).toContain('assets/hook.js');
  });

  it('returns nothing when no chunk holds the dialog, which the budget check reports as a failure', () => {
    expect(searchOpenFiles(chunks.filter((entry) => entry.fileName !== 'assets/dialog.js'))).toEqual([]);
  });
});
