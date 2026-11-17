import type { SiteSnapshot } from '@nibleaf/shared/site';
import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { renderStaticHtml } from './render';

const site = (content: string): SiteSnapshot => ({
  project: {
    id: 'project-1',
    name: 'Docs',
    slug: 'docs',
    description: null,
    icon: null,
    config: null,
    languages: [{ code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null }],
    versions: [{ id: 'v1', name: 'Latest', slug: 'latest', isDefault: true }],
  },
  generatedAt: '2026-11-01T00:00:00.000Z',
  pages: [
    {
      id: 'page-1',
      parentId: null,
      versionId: 'v1',
      languageCode: 'en',
      kind: 'PAGE',
      title: 'Page',
      slug: 'page',
      path: 'page',
      icon: null,
      description: null,
      content,
      config: null,
      translationKey: null,
      position: 0,
      hidden: false,
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
  ],
});

// Timing bounds, run on their own (pnpm test:growth; see @nibleaf/shared/testing/growth).
// The static export reads each page in time linear in its length: about 4x for
// 4x the input.
describe.runIf(growthTestsEnabled)('renderStaticHtml: growth', () => {
  it.each([
    ['case A', (n: number) => `~~~\n${'<a b'.repeat(n)}\n~~~`],
    ['case B', (n: number) => `\`\`\`\n${'<a b'.repeat(n)}`],
  ] as const)(
    'stays linear on %s',
    (_label, build) => {
      const [small, large] = growthMs((text: string) => renderStaticHtml(site(text), []), build(8000), build(32_000), {
        vary: (text, rep) => `${text} ${rep}`,
      });
      expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
    },
    60_000,
  );
});
