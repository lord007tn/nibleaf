import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { mayHaveActiveExportHtml } from './export-html';
import { normalizePublicMarkdownContent, portablePublicMdxMarkdown } from './public-markdown-content';
import { growthMs, growthTestsEnabled, linearGrowthLimit } from './testing/growth';
import { markdownCorpus } from './testing/markdown-corpus';

// Compare the actual exports with their own pre-pass output. Only the baseline
// bypasses the final pass; both measurements run the identical main projection.
const measurement = vi.hoisted(() => ({ baseline: false }));
vi.mock('./export-html', async (original) => {
  const actual = await original<typeof import('./export-html')>();
  return { ...actual, escapeDisallowedExportHtml: (source: string) => (measurement.baseline ? source : actual.escapeDisallowedExportHtml(source)) };
});

describe.runIf(growthTestsEnabled)('real documentation corpus export cost', () => {
  const corpus = markdownCorpus(fileURLToPath(new URL('../../..', import.meta.url)));
  it.each([
    { name: 'public', project: normalizePublicMarkdownContent },
    { name: 'portable', project: portablePublicMdxMarkdown },
  ])(
    'stays within 1.3x main for $name',
    ({ name, project }) => {
      const run = (baseline: boolean) => {
        measurement.baseline = baseline;
        try {
          return corpus.map(([, source]) => project(source));
        } finally {
          measurement.baseline = false;
        }
      };
      // Both sides process the same corpus, so use equal repeat counts (unlike
      // n-vs-4n growthMs). Alternate order and take medians to share JIT/GC/load.
      run(true);
      run(false);
      const started = performance.now();
      run(true);
      const repeats = Math.max(1, Math.ceil(100 / Math.max(1, performance.now() - started)));
      const samples: [number[], number[]] = [[], []];
      let retained: string[] = [];
      const time = (baseline: boolean) => {
        const started = performance.now();
        for (let repeat = 0; repeat < repeats; repeat++) retained = run(baseline);
        return performance.now() - started;
      };
      for (let round = 0; round < 5; round++) {
        for (const index of round % 2 ? [1, 0] : [0, 1]) samples[index]?.push(time(index === 0));
      }
      expect(retained).toHaveLength(corpus.length);
      const median = (values: number[]) => values.sort((a, b) => a - b)[2] ?? 0;
      const main = median(samples[0]);
      const head = median(samples[1]);
      console.info(
        `Corpus cost ${name}: ${corpus.length} pages, main ${(main / repeats).toFixed(1)} ms, head ${(head / repeats).toFixed(1)} ms, ${(head / main).toFixed(3)}x (${repeats} equal corpus passes/sample)`,
      );
      expect(head).toBeLessThanOrEqual(main * 1.3);
    },
    60_000,
  );
  it.each([
    ['safe markup and links', (n: number) => '<div title="x>y">ordinary</div> [relative](#a) [web](https://example.test)\n'.repeat(n)],
    ['malformed prefixes', (n: number) => `${'< '.repeat(n)}condition options\n`],
  ] as const)(
    'preflight grows linearly on %s',
    (_name, build) => {
      const [small, large] = growthMs(mayHaveActiveExportHtml, build(10_000), build(40_000), { minMs: 20 });
      expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
      expect(mayHaveActiveExportHtml(build(40_000))).toBe(false);
    },
    60_000,
  );
});
