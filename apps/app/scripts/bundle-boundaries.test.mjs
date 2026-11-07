import { describe, expect, it } from 'vitest';
import { forbiddenModuleIds } from './bundle-boundaries.mjs';

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
