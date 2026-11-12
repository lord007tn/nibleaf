import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { htmlToPlainText } from './ghost-mapping';
import { rewriteMintlifyAssetReferences } from './mintlify-assets';
import { normalizeMintlifyMdx } from './mintlify-mdx';

// Timing bounds, run on their own (pnpm test:growth). Imported files can be
// large and full of markup that never closes, where a regex re-reads the rest of
// the text from every opener.
describe.runIf(growthTestsEnabled)('importer markup reading: growth', () => {
  const rewrite = (content: string) => rewriteMintlifyAssetReferences(content, 'docs/page.mdx', new Set(), (path) => `https://raw.example/${path}`);
  it.each([
    ['Mintlify image labels without ]', rewrite, (n: number) => '![a'.repeat(n)],
    ['Mintlify image targets without )', rewrite, (n: number) => '![](a "t'.repeat(n)],
    ['Mintlify image tags without a src', rewrite, (n: number) => `${'<img a '.repeat(n)}>`],
    ['Mintlify image tags without a closing >', normalizeMintlifyMdx, (n: number) => '<img a'.repeat(n)],
    ['Ghost HTML with unclosed script elements', htmlToPlainText, (n: number) => '<script a'.repeat(n)],
    ['Ghost HTML with tags without a closing >', htmlToPlainText, (n: number) => '<p a'.repeat(n)],
  ] as const)(
    'reads %s in linear time',
    (_label, run, build) => {
      const [small, large] = growthMs(run as (text: string) => unknown, build(2000), build(8000), { vary: (text, rep) => `${text} ${rep}` });
      expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
    },
    60_000,
  );
});
