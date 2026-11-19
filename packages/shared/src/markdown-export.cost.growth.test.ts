import { cpus } from 'node:os';
import { PerformanceObserver } from 'node:perf_hooks';
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
const round = (value: number) => Math.round(value * 1000) / 1000;

interface Sample {
  start: number;
  end: number;
}
/** Garbage-collection pauses while measuring, as [start, end] on the performance.now() timeline. */
const watchGc = () => {
  const pauses: Array<[number, number]> = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) pauses.push([entry.startTime, entry.startTime + entry.duration]);
  });
  observer.observe({ entryTypes: ['gc'] });
  return {
    pauses,
    // Entries arrive asynchronously; let the observer catch up before reading them.
    stop: async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      observer.disconnect();
    },
  };
};
const pausedWithin = (pauses: Array<[number, number]>, sample: Sample) =>
  pauses.reduce((sum, [start, end]) => sum + Math.max(0, Math.min(end, sample.end) - Math.max(start, sample.start)), 0);

describe.runIf(growthTestsEnabled)('real documentation corpus export cost', () => {
  const corpus = export664Corpus(fileURLToPath(new URL('../../..', import.meta.url))).approved;
  it.for(exportTargets)('meets the approved absolute added cost for $name', { timeout: 120_000 }, async ({ name, project, baseline }, context) => {
    let retained = '';
    for (let warmup = 0; warmup < 5; warmup++)
      for (const [, source] of corpus) {
        retained = baseline(source);
        retained = project(source);
      }
    const pages = corpus.map(() => ({ main: [] as Sample[], head: [] as Sample[] }));
    const cpuSamples: number[] = [];
    const gc = watchGc();
    for (let round = 0; round < 9; round++) {
      const before = cpu();
      for (const [index, [, source]] of corpus.entries()) {
        for (const side of round % 2 ? [1, 0] : [0, 1]) {
          const start = performance.now();
          retained = side ? project(source) : baseline(source);
          (side ? pages[index]?.head : pages[index]?.main)?.push({ start, end: performance.now() });
        }
      }
      const after = cpu(),
        used = 100 * (1 - (after.idle - before.idle) / Math.max(1, after.total - before.total));
      if (used >= 70) context.skip('not measured: busy (CPU >= 70%)');
      cpuSamples.push(used);
    }
    await gc.stop();
    // A young-generation collection runs once the pages before it have filled
    // the nursery. The corpus runs in the same order every round, so the same
    // page tends to absorb that pause round after round, and its median with it
    // (on CI, README.md took one in 6 or 7 of 9 rounds). Time each sample without
    // the pauses that landed in it, on both sides; the page's own work still counts.
    const net = (sample: Sample) => sample.end - sample.start - pausedWithin(gc.pauses, sample);
    const costs = pages.map((page, index) => {
      const main = median(page.main.map(net)),
        head = median(page.head.map(net));
      return { page: corpus[index]?.[0] ?? '', index, main, head, added: Math.max(0, head - main) };
    });
    const added = costs.map((cost) => cost.added).sort((a, b) => a - b);
    const mean = added.reduce((a, b) => a + b, 0) / added.length;
    const p99 = added[Math.ceil(0.99 * added.length) - 1] ?? Number.POSITIVE_INFINITY;
    const main = costs.reduce((sum, cost) => sum + cost.main, 0),
      head = costs.reduce((sum, cost) => sum + cost.head, 0);
    const gcPausedMs = gc.pauses.reduce((sum, [start, end]) => sum + end - start, 0);
    // Collection is still a cost the export causes. Where a pause lands is noise,
    // but how much each side triggers in total is not: spread the head's extra
    // collection time per round over every page, so an export that allocates
    // more still counts against the mean budget.
    const sideGc = (side: 'main' | 'head') =>
      pages.reduce((sum, page) => sum + page[side].reduce((pageSum, sample) => pageSum + pausedWithin(gc.pauses, sample), 0), 0) /
      Math.max(1, pages[0]?.[side].length ?? 1);
    const addedGcPerPage = Math.max(0, sideGc('head') - sideGc('main')) / Math.max(1, corpus.length);
    const meanWithGc = mean + addedGcPerPage;
    console.info({
      name,
      pages: corpus.length,
      meanAddedMs: mean,
      meanAddedWithGcMs: meanWithGc,
      p99AddedMs: p99,
      pairedRatio: head / main,
      cpuSamples,
      gcPausedMs,
    });
    // The pages that decide the p99, with each round's [time without GC, GC pause] in ms.
    const top = [...costs].sort((a, b) => b.added - a.added).slice(0, 5);
    console.info(
      `EXPORT_COST ${JSON.stringify({
        name,
        p99AddedMs: round(p99),
        top: top.map(({ page, index, added: cost }) => ({
          page,
          added: round(cost),
          head: pages[index]?.head.map((sample) => [round(net(sample)), round(pausedWithin(gc.pauses, sample))]),
          main: pages[index]?.main.map((sample) => [round(net(sample)), round(pausedWithin(gc.pauses, sample))]),
        })),
      })}`,
    );
    expect(typeof retained).toBe('string');
    // The master's absolute budget supersedes the old 1.3x/1.5x corpus caps.
    expect(meanWithGc).toBeLessThanOrEqual(1);
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
