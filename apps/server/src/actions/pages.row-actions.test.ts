import { createHash } from 'node:crypto';
import { MAX_PAGE_CONTENT_BYTES } from '@nibleaf/shared/page-limits';
import { pageStructureRevisionSource } from '@nibleaf/shared/page-moves';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The page tree's row menu (AUTH-38) on the server: Duplicate, Hide/Show in
 * navigation (a page update with its revision precondition) and Move to… (the
 * drag's move intent with the tree's structure revision). One in-memory site;
 * the transaction client only has the models these actions may touch, so
 * copying comments, history or reader grants would fail loudly.
 */

type Row = {
  id: string;
  projectId: string;
  branchId: string;
  languageId: string;
  parentId: string | null;
  kind: 'PAGE' | 'GROUP';
  title: string;
  slug: string;
  path: string;
  icon: string | null;
  description: string | null;
  content: string;
  config: unknown;
  translationKey: string | null;
  position: number;
  hidden: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const site = vi.hoisted(() => ({
  pages: [] as Row[],
  languages: new Map<string, string>(),
  locks: [] as string[],
  shifted: [] as Array<{ id: string; position: number }>,
  created: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
}));

// Address-link upkeep (redirects, rewritten links) has its own suites. Every
// export of the real module is stubbed, so a new one added there fails here
// loudly instead of reaching an incomplete database mock.
vi.mock('@/lib/page-address-changes', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/page-address-changes')>();
  const stubs = {
    prepareAddressLinks: async () => undefined,
    assertAddressLinkRevisions: async () => undefined,
    prepareReorderAddressLinks: async () => ({ assertRevisions: async () => undefined }),
    preservePageAddresses: async () => ({ redirectsAdded: 0, linksUpdated: 0, documentsSkipped: 0 }),
  };
  const unstubbed = Object.keys(real).filter((name) => !(name in stubs));
  if (unstubbed.length > 0) throw new Error(`Stub these page-address-changes exports for the row-action tests: ${unstubbed.join(', ')}`);
  return stubs;
});
vi.mock('@/lib/page-history', () => ({ snapshotPage: vi.fn(async () => 'throttled') }));
vi.mock('./platform-events', () => ({ logFirstContentEdit: vi.fn() }));
vi.mock('./branches', () => ({ assertBranchInProject: async (_p: string, id: string) => ({ id }), getDefaultBranch: async () => ({ id: 'main' }) }));
vi.mock('./languages', () => ({ assertLanguageInProject: vi.fn(), getDefaultLanguage: vi.fn() }));

vi.mock('@nibleaf/database', () => {
  const matches = (page: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'id' && value && typeof value === 'object' && 'not' in value) return page.id !== (value as { not: string }).not;
      if (key === 'updatedAt') return page.updatedAt.getTime() === (value as Date).getTime();
      return (page as Record<string, unknown>)[key] === value;
    });
  const pick = (page: Row, select?: Record<string, boolean>) =>
    select ? Object.fromEntries(Object.keys(select).map((key) => [key, (page as Record<string, unknown>)[key]])) : { ...page };
  const page = {
    findFirst: async ({ where, include, select }: { where: Record<string, unknown>; include?: unknown; select?: Record<string, boolean> }) => {
      const found = site.pages.find((candidate) => matches(candidate, where));
      if (!found) return null;
      return include ? { ...found, language: { code: site.languages.get(found.languageId) } } : pick(found, select);
    },
    findFirstOrThrow: async ({ where }: { where: Record<string, unknown> }) => {
      const found = site.pages.find((candidate) => matches(candidate, where));
      if (!found) throw new Error('not found');
      return { ...found };
    },
    findMany: async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, boolean> }) =>
      site.pages
        .filter((candidate) => matches(candidate, where))
        .sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime())
        .map((candidate) => pick(candidate, select)),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      site.created.push(data);
      const created = { id: `copy-${site.created.length}`, createdAt: new Date(), updatedAt: new Date(), translationKey: null, ...data } as Row;
      site.pages.push(created);
      return { ...created };
    },
    update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      site.updates.push({ where, data });
      const found = site.pages.find((candidate) => matches(candidate, where));
      if (!found) throw Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
      Object.assign(found, data);
      return { ...found };
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      site.updates.push({ where, data });
      const found = site.pages.filter((candidate) => matches(candidate, where));
      for (const candidate of found) Object.assign(candidate, data);
      return { count: found.length };
    },
  };
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      site.locks.push(strings.join('?').replace(/\s+/g, ' ').trim());
      return [];
    },
    $executeRaw: async (strings: TemplateStringsArray, position: number, id: string) => {
      expect(strings.join('?')).toContain('UPDATE "page" SET position');
      site.shifted.push({ id, position });
      const found = site.pages.find((candidate) => candidate.id === id);
      if (found) found.position = position;
      return 1;
    },
    page,
    language: { findMany: async () => [...site.languages.keys()].map((id) => ({ id })) },
  };
  // The bare client has the same models as the transaction client: a reorder
  // plans once outside its lock (#525) and again inside it, so both must see
  // the same site, and a model added to one can't be missing from the other.
  const { $queryRaw: _lock, $executeRaw: _shift, ...models } = tx;
  return { Prisma: { JsonNull: null }, prisma: { ...models, $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx) } };
});

import { duplicatePage, pageStructureRevision, reorderPages, updatePage } from './pages';

let clock = Date.parse('2026-11-01T00:00:00.000Z');
const page = (overrides: Partial<Row> & Pick<Row, 'id'>): Row => {
  clock += 1000;
  return {
    projectId: 'site',
    branchId: 'main',
    languageId: 'en',
    parentId: null,
    kind: 'PAGE',
    title: overrides.id,
    slug: overrides.id,
    path: overrides.id,
    icon: null,
    description: null,
    content: '',
    config: null,
    translationKey: null,
    position: 0,
    hidden: false,
    createdAt: new Date(clock),
    updatedAt: new Date(clock),
    ...overrides,
  };
};

beforeEach(() => {
  site.languages = new Map([
    ['en', 'en'],
    ['ar', 'ar'],
    ['it', 'it'],
  ]);
  site.locks = [];
  site.shifted = [];
  site.created = [];
  site.updates = [];
  site.pages = [
    page({ id: 'welcome', position: 0 }),
    page({
      id: 'install',
      title: 'Install',
      slug: 'install',
      path: 'install',
      position: 1,
      icon: 'download',
      description: 'Set up the CLI.',
      content: '# Install\n\nRun the installer.',
      config: { sidebarTitle: 'Setup', seo: { noindex: true } },
      translationKey: 'install',
      hidden: true,
    }),
    page({ id: 'install-2', slug: 'install-2', path: 'install-2', position: 2 }),
    page({ id: 'faq', position: 9 }),
    page({ id: 'guides', kind: 'GROUP', position: 10 }),
    page({ id: 'guide-a', parentId: 'guides', path: 'guides/guide-a', position: 0 }),
    page({ id: 'intro-ar', languageId: 'ar', title: 'مقدمة', slug: 'مقدمة', path: 'مقدمة' }),
    page({ id: 'intro-it', languageId: 'it', title: 'Introduzione', slug: 'introduzione', path: 'introduzione' }),
  ];
});

describe('duplicatePage', () => {
  it('copies the content and settings right after the original, with a free address and no translation link', async () => {
    const copy = await duplicatePage('site', 'install', 'en');

    expect(site.created).toEqual([
      {
        projectId: 'site',
        branchId: 'main',
        languageId: 'en',
        parentId: null,
        kind: 'PAGE',
        title: 'Install (copy)',
        // `install` is the original and `install-2` a sibling: the helper's next free suffix.
        slug: 'install-3',
        path: 'install-3',
        icon: 'download',
        description: 'Set up the CLI.',
        content: '# Install\n\nRun the installer.',
        config: { sidebarTitle: 'Setup', seo: { noindex: true } },
        hidden: true,
        position: 2,
      },
    ]);
    expect(copy).toMatchObject({ title: 'Install (copy)', translationKey: null });
    // Only the siblings in the way move down, in order; `faq` already sits further on.
    expect(site.shifted).toEqual([{ id: 'install-2', position: 3 }]);
    expect(site.pages.filter((row) => row.parentId === null && row.languageId === 'en').map((row) => [row.id, row.position])).toEqual([
      ['welcome', 0],
      ['install', 1],
      ['install-2', 3],
      ['faq', 9],
      ['guides', 10],
      ['copy-1', 2],
    ]);
    // A sibling's revision is never touched, so an open editor on it never gets a conflict.
    expect(site.updates).toEqual([]);
  });

  it('takes the page-move lock order before reading anything', async () => {
    await duplicatePage('site', 'install', 'en');
    expect(site.locks).toEqual([
      'SELECT 1 FROM "project" WHERE id = ? FOR NO KEY UPDATE',
      'SELECT 1 FROM "page" WHERE "projectId" = ? ORDER BY id FOR NO KEY UPDATE',
    ]);
  });

  it('copies a group without the pages inside it', async () => {
    const copy = await duplicatePage('site', 'guides', 'en');
    expect(copy).toMatchObject({ kind: 'GROUP', title: 'guides (copy)', slug: 'guides-2', position: 11 });
    expect(site.created).toHaveLength(1);
    expect(site.pages.filter((row) => row.parentId === copy.id)).toEqual([]);
  });

  it('copies a page inside a group into the same group', async () => {
    const copy = await duplicatePage('site', 'guide-a', 'en');
    expect(copy).toMatchObject({ parentId: 'guides', path: 'guides/guide-a-2', position: 1 });
  });

  it("titles the copy in the page's language, else the writer's interface language", async () => {
    expect((await duplicatePage('site', 'intro-ar', 'en')).title).toBe('مقدمة (نسخة)');
    // Italian has no interface catalog: the writer's German interface names it.
    expect((await duplicatePage('site', 'intro-it', 'de')).title).toBe('Introduzione (Kopie)');
    expect((await duplicatePage('site', 'intro-it', 'xx')).title).toBe('Introduzione (copy)');
  });

  it.each([
    [
      { seo: { canonicalUrl: 'https://docs.example.com/install', noindex: true }, mode: 'wide' },
      { seo: { noindex: true }, mode: 'wide' },
    ],
    [{ seo: { canonicalUrl: 'https://docs.example.com/install' }, sidebarTitle: 'Setup' }, { sidebarTitle: 'Setup' }],
    [{ seo: { canonicalUrl: 'https://docs.example.com/install' } }, undefined],
  ])('leaves out the canonical URL, which names the original address (%j)', async (config, expected) => {
    site.pages.push(page({ id: 'canonical', config, position: 30 }));
    await duplicatePage('site', 'canonical', 'en');
    expect(site.created.at(-1)?.config).toEqual(expected);
  });

  it('keeps an untitled page untitled in its copy, not " (copy)"', async () => {
    site.pages.push(page({ id: 'untitled', title: '', slug: 'untitled', path: 'untitled', position: 40 }));
    const copy = await duplicatePage('site', 'untitled', 'en');
    expect(copy).toMatchObject({ title: '', slug: 'untitled-2' });
  });

  it('keeps the copied title within the 200-character limit', async () => {
    site.pages.push(page({ id: 'long', title: 'L'.repeat(200), position: 20 }));
    expect((await duplicatePage('site', 'long', 'en')).title).toHaveLength(200);
  });

  it('never cuts a character in half at the limit', async () => {
    // 199 units, then an emoji (two units) that the 200-unit cut would split.
    site.pages.push(page({ id: 'emoji', title: `${'L'.repeat(199)}😀`, position: 21 }));
    const { title } = await duplicatePage('site', 'emoji', 'en');
    expect(title).toBe('L'.repeat(199));
    expect(title).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  it('refuses to copy a page over the 2 MiB cap with a 413, before writing', async () => {
    site.pages.push(page({ id: 'huge', content: 'x'.repeat(MAX_PAGE_CONTENT_BYTES + 1), position: 30 }));
    await expect(duplicatePage('site', 'huge', 'en')).rejects.toMatchObject({ status: 413, code: 'page:too_large' });
    expect(site.created).toEqual([]);
    expect(site.shifted).toEqual([]);
  });

  it("answers not found for a missing page or another site's page", async () => {
    await expect(duplicatePage('site', 'missing', 'en')).rejects.toMatchObject({ status: 404 });
    await expect(duplicatePage('other-site', 'install', 'en')).rejects.toMatchObject({ status: 404 });
    expect(site.created).toEqual([]);
  });
});

describe('Hide / Show in navigation', () => {
  it('saves the hidden flag through the page update, under the page lock only, conditional on the revision', async () => {
    const revisionSeen = (site.pages.find((row) => row.id === 'welcome') as Row).updatedAt;
    const saved = await updatePage('site', 'welcome', { hidden: true, expectedUpdatedAt: revisionSeen.toISOString() }, 'writer');
    expect(saved.hidden).toBe(true);
    expect(site.locks).toEqual(['SELECT 1 FROM "page" WHERE id = ? AND "projectId" = ? FOR NO KEY UPDATE']);
    expect(site.updates[0]?.where).toEqual({ id: 'welcome', updatedAt: revisionSeen });
  });

  it('refuses a stale revision as a conflict, without writing', async () => {
    await expect(updatePage('site', 'welcome', { hidden: true, expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }, 'writer')).rejects.toMatchObject({
      code: 'page:revision_conflict',
    });
    expect(site.updates).toEqual([]);
  });
});

describe('Move to… (the move intent with the structure revision)', () => {
  const revision = () => pageStructureRevision(site.pages.filter((row) => row.branchId === 'main') as never);

  it('moves to the end of the chosen parent while the tree is unchanged', async () => {
    await reorderPages('site', { pageId: 'faq', parentId: 'guides', position: { at: 'end' }, expectedStructureRevision: revision() });
    expect(site.pages.find((row) => row.id === 'faq')).toMatchObject({ parentId: 'guides', position: 1, path: 'guides/faq' });
  });

  it('refuses with structure_changed once the tree moved on', async () => {
    const seen = revision();
    await reorderPages('site', { pageId: 'welcome', parentId: 'guides', position: { at: 'end' } });
    await expect(
      reorderPages('site', { pageId: 'faq', parentId: 'guides', position: { at: 'end' }, expectedStructureRevision: seen }),
    ).rejects.toMatchObject({
      status: 409,
      details: { reason: 'structure_changed' },
    });
  });

  it('refuses a move under the page itself or a page inside it', async () => {
    await expect(reorderPages('site', { pageId: 'guides', parentId: 'guide-a', position: { at: 'end' } })).rejects.toMatchObject({ status: 400 });
    await expect(reorderPages('site', { pageId: 'guides', parentId: 'guides', position: { at: 'end' } })).rejects.toMatchObject({ status: 400 });
  });

  it('hashes the shared, locale-independent revision source', () => {
    const rows = site.pages.filter((row) => row.branchId === 'main');
    expect(pageStructureRevision(rows as never)).toBe(
      createHash('sha256')
        .update(pageStructureRevisionSource(rows as never))
        .digest('hex'),
    );
  });
});
