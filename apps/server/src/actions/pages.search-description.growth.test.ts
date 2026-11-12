import { growthMsAsync, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({ pageFindFirst: vi.fn(), projectFindUnique: vi.fn() }));
vi.mock('@nibleaf/database', () => ({
  Prisma: { JsonNull: null },
  prisma: { page: { findFirst: database.pageFindFirst }, project: { findUnique: database.projectFindUnique } },
}));
vi.mock('@/lib/page-address-changes', () => ({}));
vi.mock('./platform-events', () => ({}));
vi.mock('./branches', () => ({}));
// The real function, observed: the tests check how much text reaches the parser.
vi.mock('@nibleaf/shared/markdown-text', async (importActual) => {
  const actual = await importActual<typeof import('@nibleaf/shared/markdown-text')>();
  return { ...actual, pageDescriptionText: vi.fn(actual.pageDescriptionText) };
});

import { getPageSearchDescription } from './pages';

const PAGE_REVISION = new Date('2026-11-10T08:00:00.000Z');
const PROJECT_REVISION = new Date('2026-11-01T08:00:00.000Z');
let pageCounter = 0;

/** A page with its own id, so the module cache never carries one test into another. */
const stored = (content: string, { updatedAt = PAGE_REVISION, variables = [] as Array<{ key: string; value: string }> } = {}) => {
  pageCounter += 1;
  const id = `page-${pageCounter}`;
  const row = { content, updatedAt };
  database.pageFindFirst.mockImplementation(async ({ where, select }: { where: { id: string; projectId: string }; select: Record<string, true> }) => {
    if (where.id !== id || where.projectId !== 'project-1') return null;
    return select.content ? { content: row.content, updatedAt: row.updatedAt } : { updatedAt: row.updatedAt };
  });
  database.projectFindUnique.mockResolvedValue({ config: { variables }, updatedAt: PROJECT_REVISION });
  return { id, row };
};
beforeEach(() => {
  database.pageFindFirst.mockReset();
  database.projectFindUnique.mockReset();
});

// Timing bounds, run on their own (pnpm test:growth; see @nibleaf/shared/testing/growth).
describe.runIf(growthTestsEnabled)('getPageSearchDescription growth', () => {
  it('expands variables only within a bounded window: 4x the body costs at most about 4x', async () => {
    const variables = [{ key: 'x', value: 'word '.repeat(100) }];
    // Each run stores a new page, so the description cache never answers for it.
    const generate = (content: string) => getPageSearchDescription('project-1', stored(content, { variables }).id);
    const [small, large] = await growthMsAsync(generate, '{{x}}'.repeat(50_000), '{{x}}'.repeat(200_000));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });
});
