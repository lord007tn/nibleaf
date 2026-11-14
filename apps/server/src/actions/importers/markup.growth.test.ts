import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { htmlToPlainText } from './ghost-mapping';
import { normalizeImportFidelity } from './import-fidelity';
import { rewriteMintlifyAssetReferences } from './mintlify-assets';
import { mintlifyInternalLinkTargets, rewriteMintlifyInternalLinks } from './mintlify-links';
import { normalizeMintlifyMdx } from './mintlify-mdx';

// growthMs warms both inputs and interleaves three samples of n and 4n.
// A 50 ms minimum keeps brief scheduling pauses from dominating the ratio;
// linearGrowthLimit still rejects quadratic growth (about 16x for 4x input).
// Run on their own with pnpm test:growth.
describe.runIf(growthTestsEnabled)('importer markup reading: growth', () => {
  const rewrite = (content: string) => rewriteMintlifyAssetReferences(content, 'docs/page.mdx', new Set(), (path) => `https://raw.example/${path}`);
  it.each([
    ['unclosed media openers', normalizeImportFidelity, (n: number) => '<video src="https://cdn.test/a.mp4">\n\nAfter.\n\n'.repeat(n)],
    [
      'unclosed component container fences',
      normalizeImportFidelity,
      (n: number) => '<CodeGroup>\n    - ```md\n      literal\n</CodeGroup>\n\nAfter.\n\n'.repeat(n),
    ],
    [
      'embed normalization',
      normalizeImportFidelity,
      (n: number) => 'Tour\n\n<iframe src="https://youtu.be/abcdefghijk"></iframe>\n\n/\n\n'.repeat(n),
    ],
    ['malformed embed openers', normalizeImportFidelity, (n: number) => '<iframe src="'.repeat(n)],
    [
      'source link resolution',
      (text: string) => rewriteMintlifyInternalLinks(text, 'intro', new Map([['next', '/guide/next']]), { sourceUrl: 'https://help.example.test' }),
      (n: number) => '[Next](https://help.example.test/next?lang=ar#start)\n'.repeat(n),
    ],
    ['same-line embeds', normalizeImportFidelity, (n: number) => '<iframe src="https://youtu.be/abcdefghijk"></iframe>'.repeat(n)],
    [
      'MDX child fence protection',
      normalizeImportFidelity,
      (n: number) => '<CodeGroup>\n  ```md\n  ![Example](./example.png)\n  ```\n</CodeGroup>\n\n'.repeat(n),
    ],
    ['CR code protection', normalizeImportFidelity, (n: number) => 'Intro\r\r    ![Example](./next.png)\r\r'.repeat(n)],
    [
      'multiline self-closing component protection',
      normalizeImportFidelity,
      (n: number) => '<Image\n  alt={{ label: "/> and >" }}\n/>\n\n    ```md\n\n[Tour](https://youtu.be/abcdefghijk)\n\n'.repeat(n),
    ],
    ['unclosed component attributes', normalizeImportFidelity, (n: number) => '<Image\n  alt="\n'.repeat(n)],
    [
      'tabbed component container fences',
      normalizeImportFidelity,
      (n: number) => '<CodeGroup>\n- >\t```md\n  >\t[Tour](https://youtu.be/abcdefghijk)\n  >\t`````\n</CodeGroup>\n\n'.repeat(n),
    ],
    [
      'exact application destination discovery',
      (text: string) => mintlifyInternalLinkTargets(text, 'intro', undefined, undefined, 'en', ['en'], new Map([['api/next', '/next']])),
      (n: number) => '[Next](https://nibleaf.com/pages/next)\n'.repeat(n),
    ],
    [
      'importer optional container fence spacing',
      normalizeImportFidelity,
      (n: number) => '> ```md\n> example\n>```\n\n[Tour](https://youtu.be/abcdefghijk)\n\n'.repeat(n),
    ],
    [
      'component container fence closers',
      normalizeImportFidelity,
      (n: number) => '<CodeGroup>\n  ```md\n  > ```\n  - ```\n  1. ```\n  ![Example](./example.png)\n  ```\n</CodeGroup>\n\n'.repeat(n),
    ],
    [
      'encoded source link resolution',
      (text: string) => rewriteMintlifyInternalLinks(text, 'intro', new Map([['guides/مرحبا', '/guide/next']]), { sourceUrl: 'https://help.test' }),
      (n: number) => '[Next](https://help.test/guides/%D9%85%D8%B1%D8%AD%D8%A8%D8%A7#start)\n'.repeat(n),
    ],
    [
      'container code protection',
      normalizeImportFidelity,
      (n: number) => '- Example\n\n      [Demo](https://youtu.be/abcdefghijk)\n      /\n      \\---\n\n'.repeat(n),
    ],
    ['quoted rejected media', normalizeImportFidelity, (n: number) => '<iframe src="data:text/html,<video></video>"></iframe>\n\n'.repeat(n)],
    [
      'indented source link protection',
      (text: string) => rewriteMintlifyInternalLinks(text, 'intro', new Map([['next', '/guide/next']]), { sourceUrl: 'https://help.test' }),
      (n: number) => 'Example:\n\n    [Next](https://help.test/next)\n\n'.repeat(n),
    ],
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
      const [small, large] = growthMs(run as (text: string) => unknown, build(2000), build(8000), {
        minMs: 50,
        budgetMs: 10_000,
        vary: (text, rep) => `${text} ${rep}`,
      });
      expect(large / small, `n=${small.toFixed(2)} ms, 4n=${large.toFixed(2)} ms`).toBeLessThanOrEqual(linearGrowthLimit(small) / small);
    },
    60_000,
  );
});
