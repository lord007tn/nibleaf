import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mayHaveActiveExportHtml } from './export-html';
import { export664Corpus } from './testing/export-664-corpus';
import { exportTargets } from './testing/export-664-guard';
import { growthMs, growthTestsEnabled, linearGrowthLimit } from './testing/growth';

const cpu = () =>
  cpus().reduce((sum, core) => ({ idle: sum.idle + core.times.idle, total: sum.total + Object.values(core.times).reduce((a, b) => a + b, 0) }), {
    idle: 0,
    total: 0,
  });
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

describe.runIf(growthTestsEnabled)('real documentation corpus export cost', () => {
  const corpus = export664Corpus(fileURLToPath(new URL('../../..', import.meta.url))).approved;
  it.for(exportTargets)('meets the approved absolute added cost for $name', { timeout: 120_000 }, ({ name, project, baseline }, context) => {
    let retained = '';
    for (let warmup = 0; warmup < 5; warmup++)
      for (const [, source] of corpus) {
        retained = baseline(source);
        retained = project(source);
      }
    const pages = corpus.map(() => ({ main: [] as number[], head: [] as number[] }));
    const cpuSamples: number[] = [];
    for (let round = 0; round < 9; round++) {
      const before = cpu();
      for (const [index, [, source]] of corpus.entries()) {
        for (const side of round % 2 ? [1, 0] : [0, 1]) {
          const started = performance.now();
          retained = side ? project(source) : baseline(source);
          (side ? pages[index]?.head : pages[index]?.main)?.push(performance.now() - started);
        }
      }
      const after = cpu(),
        used = 100 * (1 - (after.idle - before.idle) / Math.max(1, after.total - before.total));
      if (used >= 70) context.skip('not measured: busy (CPU >= 70%)');
      cpuSamples.push(used);
    }
    const added = pages.map((page) => Math.max(0, median(page.head) - median(page.main))).sort((a, b) => a - b);
    const mean = added.reduce((a, b) => a + b, 0) / added.length;
    const p99 = added[Math.ceil(0.99 * added.length) - 1] ?? Number.POSITIVE_INFINITY;
    const main = pages.reduce((sum, page) => sum + median(page.main), 0),
      head = pages.reduce((sum, page) => sum + median(page.head), 0);
    console.info({ name, pages: corpus.length, meanAddedMs: mean, p99AddedMs: p99, pairedRatio: head / main, cpuSamples });
    expect(typeof retained).toBe('string');
    // The master's absolute budget supersedes the old 1.3x/1.5x corpus caps.
    expect(mean).toBeLessThanOrEqual(1);
    expect(p99).toBeLessThanOrEqual(5);
  });
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
