import { growthMsAsync, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
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

import { pageDescriptionText } from '@nibleaf/shared/markdown-text';
import { getPageSearchDescription, SEARCH_DESCRIPTION_SOURCE_LIMIT } from './pages';

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
const contentReads = () => database.pageFindFirst.mock.calls.filter(([query]) => query.select.content).length;

beforeEach(() => {
  database.pageFindFirst.mockReset();
  database.projectFindUnique.mockReset();
  vi.mocked(pageDescriptionText).mockClear();
});

describe('getPageSearchDescription', () => {
  it("generates from the saved content with the project's variables resolved, ignoring the page's own descriptions", async () => {
    const { id } = stored('# Setup\n\nInstall {{ product }} in a minute.', { variables: [{ key: 'product', value: 'Nibleaf' }] });
    const result = await getPageSearchDescription('project-1', id);
    expect(result).toEqual({
      description: pageDescriptionText({ content: '# Setup\n\nInstall Nibleaf in a minute.', description: null }),
      revision: PAGE_REVISION.toISOString(),
    });
    expect(result.description).toContain('Install Nibleaf in a minute.');
  });

  it('expands variables only within a bounded window: a 1 MB body of long variables stays fast and small', async () => {
    const variables = [{ key: 'x', value: 'word '.repeat(100) }];
    const { id } = stored('{{x}}'.repeat(200_000), { variables });
    const result = await getPageSearchDescription('project-1', id);
    const parsed = vi.mocked(pageDescriptionText).mock.calls[0]?.[0].content ?? '';
    expect(parsed.length).toBeLessThanOrEqual(SEARCH_DESCRIPTION_SOURCE_LIMIT);
    // The full generated text (the editor cuts the preview), bounded by the 4 KB the description is read from.
    expect(result.description.length).toBeLessThanOrEqual(4096);
    expect(result.description.startsWith('word word')).toBe(true);
    // Unbounded, this expanded to 100 MB; the bounds above pin the output. 4x the
    // body costs at most about 4x (testing/growth). Each run stores a new page, so
    // the description cache never answers for it.
    const generate = (content: string) => getPageSearchDescription('project-1', stored(content, { variables }).id);
    const [small, large] = await growthMsAsync(generate, '{{x}}'.repeat(50_000), '{{x}}'.repeat(200_000));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  it('starts the window after a long frontmatter block, so the prose is still found', async () => {
    const { id } = stored(`---\n${'key: value\n'.repeat(2000)}---\n\nThe prose after the frontmatter.`);
    expect((await getPageSearchDescription('project-1', id)).description).toBe('The prose after the frontmatter.');
  });

  it('caches per page and project revision, without reading the body again', async () => {
    const { id, row } = stored('First version of the page.');
    expect((await getPageSearchDescription('project-1', id)).description).toBe('First version of the page.');
    expect((await getPageSearchDescription('project-1', id)).description).toBe('First version of the page.');
    expect(contentReads()).toBe(1);
    expect(pageDescriptionText).toHaveBeenCalledTimes(1);

    // A save moves the revision: the new body is read and the new revision returned.
    row.content = 'Second version of the page.';
    row.updatedAt = new Date('2026-11-10T09:00:00.000Z');
    expect(await getPageSearchDescription('project-1', id)).toEqual({
      description: 'Second version of the page.',
      revision: '2026-11-10T09:00:00.000Z',
    });
    expect(contentReads()).toBe(2);

    // A project change (its variables) recomputes too.
    database.projectFindUnique.mockResolvedValue({ config: { variables: [] }, updatedAt: new Date('2026-11-10T10:00:00.000Z') });
    await getPageSearchDescription('project-1', id);
    expect(contentReads()).toBe(3);
  });

  it('is not found for a missing page and for a page of another project', async () => {
    const { id } = stored('Body.');
    await expect(getPageSearchDescription('project-1', 'missing')).rejects.toMatchObject({ code: 'database:not_found' });
    await expect(getPageSearchDescription('project-2', id)).rejects.toMatchObject({ code: 'database:not_found' });
  });
});
