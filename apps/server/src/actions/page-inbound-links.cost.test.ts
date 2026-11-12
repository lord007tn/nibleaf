import { expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({ pageFindFirst: vi.fn(), pageFindMany: vi.fn(), projectFindUnique: vi.fn(), revision: vi.fn() }));
vi.mock('@nibleaf/database', () => ({
  prisma: {
    page: { findFirst: database.pageFindFirst, findMany: database.pageFindMany },
    project: { findUnique: database.projectFindUnique },
    $queryRaw: database.revision,
  },
}));
vi.mock('@/lib/site-host', () => ({ trustedSiteOrigins: () => ['https://docs.nibleaf.test'] }));

import { getPageInboundLinks } from './page-inbound-links';

const stamp = new Date('2026-11-11T12:00:00Z');
const project = {
  id: 'cost-project',
  name: 'Docs',
  slug: 'docs',
  description: null,
  icon: null,
  config: null,
  updatedAt: stamp,
  languages: [{ code: 'en', label: 'English', direction: 'LTR' as const, isDefault: true, config: null }],
  branches: [{ id: 'cost-main', name: 'main', isDefault: true }],
  domains: [],
  openApiDocument: null,
};
const rows = Array.from({ length: 2200 }, (_, i) => ({
  id: i === 2199 ? 'target' : `cost-${i}`,
  parentId: null,
  branchId: 'cost-main',
  languageCode: 'en',
  kind: 'PAGE' as const,
  title: `Topic ${i}`,
  slug: i === 2199 ? 'target' : `cost-${i}`,
  path: i === 2199 ? 'target' : `cost-${i}`,
  content: `# Topic ${i}\n\n[Target](/target#section)\n\n${'Reference documentation for this topic. '.repeat(30)}`,
  icon: null,
  description: null,
  config: null,
  translationKey: null,
  position: i,
  hidden: false,
  updatedAt: stamp.toISOString(),
}));

// For timings, run this file alone with --no-file-parallelism --maxWorkers=1
// --reporter=verbose --disableConsoleIntercept. Heartbeat gaps include snapshot
// setup and scheduler/GC pauses; report them, never use timing as a unit-test gate.
it('measures a 2,200-page branch and repeated dialogs', async () => {
  database.pageFindFirst.mockResolvedValue({ branchId: 'cost-main' });
  database.projectFindUnique.mockResolvedValue(project);
  database.pageFindMany.mockResolvedValue(rows.map((row) => ({ ...row, language: { code: 'en' }, createdAt: stamp, updatedAt: stamp })));
  database.revision.mockResolvedValue([{ revision: 'cost-revision', count: 2200 }]);
  const start = performance.now();
  const slices: number[] = [];
  let sliceStart = start;
  let heartbeat: NodeJS.Immediate;
  const tick = () => {
    const now = performance.now();
    slices.push(now - sliceStart);
    sliceStart = now;
    heartbeat = setImmediate(tick);
  };
  heartbeat = setImmediate(tick);
  try {
    expect((await getPageInboundLinks(project.id, 'target')).total).toBe(2199);
    slices.push(performance.now() - sliceStart);
  } finally {
    clearImmediate(heartbeat);
  }
  const cold = performance.now() - start;
  const repeatStart = performance.now();
  expect((await getPageInboundLinks(project.id, 'target')).total).toBe(2199);
  const repeat = performance.now() - repeatStart;
  expect((await getPageInboundLinks(project.id, 'cost-0')).total).toBe(0);
  expect(database.pageFindMany).toHaveBeenCalledTimes(1);
  slices.sort((a, b) => a - b);
  console.info(
    `inbound 2200: cold ${cold.toFixed(1)} ms, slice p50 ${slices[Math.floor(slices.length / 2)]?.toFixed(1)} ms, max ${slices.at(-1)?.toFixed(1)} ms, ${slices.length} slices, repeat ${repeat.toFixed(1)} ms`,
  );
}, 20_000);
