import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { htmlToPlainText } from './ghost-mapping';
import { rewriteMintlifyAssetReferences } from './mintlify-assets';
import { normalizeMintlifyMdx } from './mintlify-mdx';

// Timing bounds, run on their own (pnpm test:growth). Imported files can be
// large; the importers read them in time linear in their length.
describe.runIf(growthTestsEnabled)('importer markup reading: growth', () => {
  const rewrite = (content: string) => rewriteMintlifyAssetReferences(content, 'docs/page.mdx', new Set(), (path) => `https://raw.example/${path}`);
  it.each([
    ['case A', rewrite, (n: number) => '![a'.repeat(n)],
    ['case B', rewrite, (n: number) => '![](a "t'.repeat(n)],
    ['case C', rewrite, (n: number) => `${'<img a '.repeat(n)}>`],
    ['case D', normalizeMintlifyMdx, (n: number) => '<img a'.repeat(n)],
    ['case E', htmlToPlainText, (n: number) => '<script a'.repeat(n)],
    ['case F', htmlToPlainText, (n: number) => '<p a'.repeat(n)],
    ['case G', htmlToPlainText, (n: number) => `<p>${'\r'.repeat(n)}x</p>`],
  ] as const)(
    'stays linear on %s',
    (_label, run, build) => {
      const [small, large] = growthMs(run as (text: string) => unknown, build(2000), build(8000), { vary: (text, rep) => `${text} ${rep}` });
      expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
    },
    60_000,
  );
});
