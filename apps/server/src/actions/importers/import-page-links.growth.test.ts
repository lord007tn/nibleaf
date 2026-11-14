import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { rewriteMintlifyInternalLinks } from './mintlify-links';

const routes = new Map([['next', '/topic/next']]);
describe.runIf(growthTestsEnabled)('component link rewriting: growth', () => {
  it.each([
    ['component children', (n: number) => '<Columns>\n<Card href="/next">\n[Go](/next)\n</Card>\n</Columns>\n\n'.repeat(n), 2000],
    ['lowercase HTML children', (n: number) => '<Note>\n<div>\n<section>\n[Go](/next)\n</section>\n</div>\n</Note>\n\n'.repeat(n), 2000],
    [
      'opaque HTML bodies',
      (n: number) =>
        '<code>[Literal](/next)</code-sample>[Still literal](/next)</code>\n\n<pre>\n[Literal](/next)\n</pre>\n\n<div>\n[Go](/next)\n</div>\n\n'.repeat(
          n,
        ),
      2000,
    ],
    ['nested components', (n: number) => `${'<Unknown>\n'.repeat(n)}[Go](/next)\n${'</Unknown>\n'.repeat(n)}`, 2000],
    ['two MiB unterminated labels', (n: number) => `${'['.repeat(n)}\n\n<Note>\n[Go](/next)\n</Note>`, 512 * 1024],
    ['two MiB angle destinations', (n: number) => `${'[a](<b)'.repeat(Math.ceil(n / 7)).slice(0, n)}\n\n<Note>\n[Go](/next)\n</Note>`, 512 * 1024],
  ] as const)(
    'stays linear on %s',
    (label, build, size) => {
      const small = build(size);
      const large = build(size * 4);
      expect(rewriteMintlifyInternalLinks(large, 'intro', routes)).toContain('[Go](/topic/next)');
      const [n, fourN] = growthMs((source: string) => rewriteMintlifyInternalLinks(source, 'intro', routes), small, large, {
        minMs: 50,
        budgetMs: 15_000,
        vary: (source, rep) => `${source}\n${rep}`,
      });
      console.info(`${label}: n=${n.toFixed(2)} ms, 4n=${fourN.toFixed(2)} ms, ratio=${(fourN / n).toFixed(2)}`);
      expect(fourN).toBeLessThanOrEqual(linearGrowthLimit(n));
    },
    60_000,
  );
});
