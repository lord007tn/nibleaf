import { describe, expect, it } from 'vitest';
import { forbiddenModuleIds, marketingSharedReaderIcons } from './bundle-boundaries.mjs';

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
];

describe('public docs module boundary', () => {
  it('fails when marketing SEO, comparison or GitHub-star code reaches a public profile', () => {
    expect(forbiddenModuleIds([...readerModules, ...leakedModules])).toEqual(leakedModules);
  });

  it('passes the reader and the root route marketing-analytics check', () => {
    expect(forbiddenModuleIds(readerModules)).toEqual([]);
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
