import { randomUUID } from 'node:crypto';
import { type Prisma, prisma } from '@nibleaf/database';
import { afterAll, describe, expect, it } from 'vitest';
import type { PublishRetention } from '@/lib/activation-metrics';
import { getPublishRetention } from './platform-events';

const NOW = new Date('2026-10-30T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR);
const daysAgo = (days: number) => hoursAgo(days * 24);

type EventRow = Prisma.PlatformEventCreateManyInput;

/** A `recordPublishReady` row: replaying the same deployment reuses its ID. */
const receipt = (projectId: string, createdAt: Date, overrides: Partial<EventRow> = {}): EventRow => ({
  id: `publish-ready:${randomUUID()}`,
  type: 'publish_ready',
  userId: 'synthetic-author',
  projectId,
  metadata: { auto: false, version: 1 },
  createdAt,
  ...overrides,
});
/** Rows from before receipts: same shape, random ID, so retries can't be told apart. */
const legacy = (projectId: string, createdAt: Date): EventRow => receipt(projectId, createdAt, { id: randomUUID() });
const project = () => `project-${randomUUID()}`;

class Rollback extends Error {}

/** Each scenario runs in a rolled-back transaction, leaving nothing behind. */
async function retentionFor(rows: EventRow[], days = 30): Promise<PublishRetention> {
  let result: PublishRetention | undefined;
  await prisma
    .$transaction(async (tx) => {
      await tx.platformEvent.createMany({ data: rows, skipDuplicates: true });
      result = await getPublishRetention(days, NOW, tx);
      throw new Rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
  if (!result) throw new Error('retention query did not run');
  return result;
}

/** Projects past the measuring window that never published again. */
const matureCohort = (count = 5) => Array.from({ length: count }, (_, index) => receipt(project(), daysAgo(10 + index)));

// Explicit opt-in: CI supplies its disposable migrated PostgreSQL service.
describe.skipIf(process.env.ACTIVATION_INTEGRATION !== '1')('publishing retention in PostgreSQL', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('reports Unknown, not zero, when there are no qualifying events', async () => {
    await expect(retentionFor([])).resolves.toEqual({
      firstManualPublishes: null,
      cohortSize: null,
      retained: null,
      rate: null,
      observationStart: null,
      computedAt: NOW.toISOString(),
    });
  });

  it('reports Unknown when only legacy rows exist', async () => {
    const result = await retentionFor([legacy(project(), daysAgo(10))]);
    expect(result).toMatchObject({ firstManualPublishes: null, cohortSize: null, retained: null, rate: null, observationStart: null });
  });

  it('counts a retried receipt once, so a retry is never a second publish', async () => {
    const id = project();
    const first = receipt(id, daysAgo(10));
    const result = await retentionFor([first, first, { ...first, createdAt: daysAgo(9) }]);
    expect(result).toMatchObject({ firstManualPublishes: 1, cohortSize: 1, retained: 0 });
  });

  it('does not mistake duplicated legacy rows for a second publish or a new project', async () => {
    const id = project();
    const result = await retentionFor([
      legacy(id, daysAgo(50)),
      legacy(id, daysAgo(50)),
      receipt(id, daysAgo(10)),
      receipt(id, daysAgo(8)),
      receipt(project(), daysAgo(12)),
    ]);
    expect(result).toMatchObject({ firstManualPublishes: 1, cohortSize: 1, retained: 0, observationStart: daysAgo(12).toISOString() });
  });

  it('counts a project once when two authors publish it', async () => {
    const id = project();
    const result = await retentionFor([receipt(id, daysAgo(10), { userId: 'author-a' }), receipt(id, daysAgo(8), { userId: 'author-b' })]);
    expect(result).toMatchObject({ firstManualPublishes: 1, cohortSize: 1, retained: 1 });
  });

  it('excludes Git, failed, identifier-free, and missing-metadata publishes', async () => {
    const id = project();
    const result = await retentionFor([
      receipt(id, daysAgo(10)),
      receipt(id, daysAgo(8), { metadata: { auto: true, version: 2 } }),
      receipt(id, daysAgo(8), { metadata: { auto: 'false', version: 3 } }),
      receipt(id, daysAgo(8), { type: 'publish_failed' }),
      receipt(id, daysAgo(8), { type: 'first_manual_publish_ready' }),
      receipt(project(), daysAgo(9), { metadata: { auto: true } }),
      receipt(project(), daysAgo(9), { metadata: { source: 'rtl_readiness_grader' } }),
      { id: `publish-ready:${randomUUID()}`, type: 'publish_ready', projectId: project(), createdAt: daysAgo(9) },
      receipt(project(), daysAgo(9), { projectId: null }),
    ]);
    expect(result).toMatchObject({ firstManualPublishes: 1, cohortSize: 1, retained: 0, observationStart: daysAgo(10).toISOString() });
  });

  it('does not count a project whose first publish predates the windows', async () => {
    const id = project();
    const result = await retentionFor([receipt(id, daysAgo(60)), receipt(id, daysAgo(10)), receipt(id, daysAgo(9))]);
    expect(result).toMatchObject({ firstManualPublishes: 0, cohortSize: 0, retained: 0, observationStart: daysAgo(60).toISOString() });
  });

  it.each([
    ['one millisecond before 24 hours', 24 * HOUR - 1, 0],
    ['exactly 24 hours', 24 * HOUR, 1],
    ['exactly 168 hours', 168 * HOUR, 1],
    ['one millisecond after 168 hours', 168 * HOUR + 1, 0],
  ])('applies the retained boundary at %s', async (_label, gap, retained) => {
    const id = project();
    const first = daysAgo(10);
    const result = await retentionFor([receipt(id, first), receipt(id, new Date(first.getTime() + gap))]);
    expect(result).toMatchObject({ cohortSize: 1, retained });
  });

  it('keeps a same-day second publish out of retention even with a later third', async () => {
    const id = project();
    const first = daysAgo(10);
    const result = await retentionFor([receipt(id, first), receipt(id, new Date(first.getTime() + 2 * HOUR)), receipt(id, daysAgo(7))]);
    expect(result).toMatchObject({ cohortSize: 1, retained: 0 });
  });

  it('applies the cohort window at its exact edges and excludes immature projects', async () => {
    const insideOldest = project();
    const insideNewest = project();
    const result = await retentionFor([
      receipt(project(), new Date(daysAgo(37).getTime() - 1)),
      receipt(insideOldest, daysAgo(37)),
      receipt(insideNewest, daysAgo(7)),
      receipt(project(), new Date(daysAgo(7).getTime() + 1)),
    ]);
    expect(result).toMatchObject({ firstManualPublishes: 2, cohortSize: 2 });
  });

  it('keeps the cohort Unknown while no receipt is old enough to measure', async () => {
    const result = await retentionFor([receipt(project(), daysAgo(6)), receipt(project(), daysAgo(1))]);
    expect(result).toMatchObject({
      firstManualPublishes: 2,
      cohortSize: null,
      retained: null,
      rate: null,
      observationStart: daysAgo(6).toISOString(),
    });
  });

  it('hides the rate below five projects and reports it from five', async () => {
    const small = await retentionFor(matureCohort(4));
    expect(small).toMatchObject({ cohortSize: 4, retained: 0, rate: null });

    const id = project();
    const full = await retentionFor([...matureCohort(4), receipt(id, daysAgo(10)), receipt(id, daysAgo(8))]);
    expect(full).toMatchObject({ cohortSize: 5, retained: 1, rate: 0.2 });
  });

  it('honours the funnel window length', async () => {
    const result = await retentionFor([receipt(project(), daysAgo(10)), receipt(project(), daysAgo(20))], 15);
    expect(result).toMatchObject({ firstManualPublishes: 1, cohortSize: 2 });
  });

  it('returns aggregates with no identifiers', async () => {
    const id = project();
    const result = await retentionFor([receipt(id, daysAgo(10), { userId: 'synthetic-author' }), receipt(id, daysAgo(8))]);
    expect(Object.keys(result).sort()).toEqual(['cohortSize', 'computedAt', 'firstManualPublishes', 'observationStart', 'rate', 'retained']);
    expect(JSON.stringify(result)).not.toMatch(/project-|synthetic-author|publish-ready:/);
  });
});
