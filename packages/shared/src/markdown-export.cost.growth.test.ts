import { cpus } from 'node:os';
import { PerformanceObserver } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
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

// DIAGNOSTIC (draft only): per-page outliers, GC overlap and measurement variants.
setFlagsFromString('--expose-gc');
const collect = runInNewContext('gc') as (options?: { type: 'minor' | 'major' }) => void;
interface Sample {
  ms: number;
  start: number;
  end: number;
}
interface Plan {
  label: string;
  rounds: number;
  gcEachRound: boolean;
  pageWarmup: number;
  minorGcEachPage?: boolean;
}
const gcEntries: Array<{ start: number; end: number; kind: number }> = [];
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries())
    gcEntries.push({
      start: entry.startTime,
      end: entry.startTime + entry.duration,
      kind: (entry as { detail?: { kind?: number } }).detail?.kind ?? -1,
    });
});
observer.observe({ entryTypes: ['gc'] });
const flushGc = () => new Promise((resolve) => setTimeout(resolve, 20));
const gcMs = (sample: Sample) =>
  gcEntries.reduce((sum, entry) => sum + Math.max(0, Math.min(entry.end, sample.end) - Math.max(entry.start, sample.start)), 0);
const measure = (plan: Plan, corpus: Array<[string, string]>, project: (s: string) => string, baseline: (s: string) => string) => {
  let retained = '';
  for (let warmup = 0; warmup < 5; warmup++)
    for (const [, source] of corpus) {
      retained = baseline(source);
      retained = project(source);
    }
  const pages = corpus.map(() => ({ main: [] as Sample[], head: [] as Sample[] }));
  const cpuSamples: number[] = [];
  for (let round = 0; round < plan.rounds; round++) {
    if (plan.gcEachRound) collect();
    const before = cpu();
    for (const [index, [, source]] of corpus.entries()) {
      if (plan.minorGcEachPage) collect({ type: 'minor' });
      for (let warm = 0; warm < plan.pageWarmup; warm++) {
        retained = baseline(source);
        retained = project(source);
      }
      for (const side of round % 2 ? [1, 0] : [0, 1]) {
        const start = performance.now();
        retained = side ? project(source) : baseline(source);
        const end = performance.now();
        (side ? pages[index]?.head : pages[index]?.main)?.push({ ms: end - start, start, end });
      }
    }
    const after = cpu();
    cpuSamples.push(100 * (1 - (after.idle - before.idle) / Math.max(1, after.total - before.total)));
  }
  return { pages, cpuSamples, retained };
};
const summarize = async (plan: Plan, name: string, corpus: Array<[string, string]>, run: ReturnType<typeof measure>) => {
  await flushGc();
  const added = run.pages.map((page, index) => ({
    index,
    page: corpus[index]?.[0] ?? '',
    added: Math.max(0, median(page.head.map((s) => s.ms)) - median(page.main.map((s) => s.ms))),
  }));
  const net = run.pages.map((page) => Math.max(0, median(page.head.map((s) => s.ms - gcMs(s))) - median(page.main.map((s) => s.ms - gcMs(s)))));
  const netSorted = [...net].sort((a, b) => a - b);
  const netP99 = netSorted[Math.ceil(0.99 * netSorted.length) - 1] ?? Number.POSITIVE_INFINITY;
  const netMean = net.reduce((sum, value) => sum + value, 0) / net.length;
  const sorted = [...added].sort((a, b) => a.added - b.added);
  const p99 = sorted[Math.ceil(0.99 * sorted.length) - 1]?.added ?? Number.POSITIVE_INFINITY;
  const mean = added.reduce((sum, row) => sum + row.added, 0) / added.length;
  const top = [...added].sort((a, b) => b.added - a.added).slice(0, 5);
  const round = (value: number) => Math.round(value * 100) / 100;
  console.info(
    `EXPORT_COST ${JSON.stringify({
      plan: plan.label,
      name,
      cpus: cpus().length,
      meanAddedMs: round(mean * 100) / 100,
      p99AddedMs: round(p99),
      gcSubtracted: { mean: round(netMean * 100) / 100, p99: round(netP99) },
      gcOverlappedSamples: run.pages.reduce((sum, page) => sum + [...page.head, ...page.main].filter((sample) => gcMs(sample) > 0).length, 0),
      p99Page: sorted[Math.ceil(0.99 * sorted.length) - 1]?.page,
      cpu: run.cpuSamples.map(round),
      gcTotalMs: round(gcEntries.reduce((sum, entry) => sum + entry.end - entry.start, 0)),
      top: top.map((row) => ({
        page: row.page,
        added: round(row.added),
        head: run.pages[row.index]?.head.map((s) => [round(s.ms), round(gcMs(s))]),
        main: run.pages[row.index]?.main.map((s) => [round(s.ms), round(gcMs(s))]),
      })),
    })}`,
  );
  gcEntries.length = 0;
  return { mean, p99 };
};

describe.runIf(growthTestsEnabled)('real documentation corpus export cost', () => {
  const corpus = export664Corpus(fileURLToPath(new URL('../../..', import.meta.url))).approved;
  it.for(exportTargets)('meets the approved absolute added cost for $name', { timeout: 120_000 }, async ({ name, project, baseline }, context) => {
    let retained = '';
    for (let warmup = 0; warmup < 5; warmup++)
      for (const [, source] of corpus) {
        retained = baseline(source);
        retained = project(source);
      }
    const pages = corpus.map(() => ({ main: [] as number[], head: [] as number[] }));
    const spans = corpus.map(() => ({ main: [] as Sample[], head: [] as Sample[] }));
    const cpuSamples: number[] = [];
    gcEntries.length = 0;
    for (let round = 0; round < 9; round++) {
      const before = cpu();
      for (const [index, [, source]] of corpus.entries()) {
        for (const side of round % 2 ? [1, 0] : [0, 1]) {
          const started = performance.now();
          retained = side ? project(source) : baseline(source);
          const ended = performance.now();
          (side ? pages[index]?.head : pages[index]?.main)?.push(ended - started);
          (side ? spans[index]?.head : spans[index]?.main)?.push({ ms: ended - started, start: started, end: ended });
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
    await summarize({ label: 'check', rounds: 9, gcEachRound: false, pageWarmup: 0 }, name, corpus, { pages: spans, cpuSamples, retained });
    expect(typeof retained).toBe('string');
    // The master's absolute budget supersedes the old 1.3x/1.5x corpus caps.
    expect(mean).toBeLessThanOrEqual(1);
    expect(p99).toBeLessThanOrEqual(5);
  });
  // DIAGNOSTIC (draft only): the same measurement under variants, logged and never asserted.
  const plans: Plan[] = [
    { label: 'same', rounds: 9, gcEachRound: false, pageWarmup: 0 },
    { label: 'gc-each-round', rounds: 9, gcEachRound: true, pageWarmup: 0 },
    { label: 'page-warmup', rounds: 9, gcEachRound: false, pageWarmup: 1 },
    { label: 'rounds-21', rounds: 21, gcEachRound: false, pageWarmup: 0 },
    { label: 'gc-warmup-21', rounds: 21, gcEachRound: true, pageWarmup: 1 },
    { label: 'minor-gc-page', rounds: 9, gcEachRound: false, pageWarmup: 0, minorGcEachPage: true },
    { label: 'minor-gc-page-21', rounds: 21, gcEachRound: false, pageWarmup: 0, minorGcEachPage: true },
  ];
  for (const plan of plans)
    it.for(exportTargets)(`DIAGNOSTIC ${plan.label}: $name`, { timeout: 300_000 }, async ({ name, project, baseline }) => {
      gcEntries.length = 0;
      const run = measure(plan, corpus, project, baseline);
      await summarize(plan, name, corpus, run);
      expect(typeof run.retained).toBe('string');
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
