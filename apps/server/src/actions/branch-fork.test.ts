import { describe, expect, it } from 'vitest';
import { analyzePromote, buildForkBaseline, type ForkPoint, forkPointOf, inheritForkBaseline, type PromotePageRow } from './branch-fork';

const FORK = new Date('2026-11-01T10:00:00.000Z');
const BEFORE = new Date('2026-10-30T10:00:00.000Z');
const AFTER = new Date('2026-11-02T10:00:00.000Z');
const codes = new Map([
  ['en', 'en'],
  ['ar', 'ar'],
]);

/** A page row. `hash` stands for its content; change it to "edit" the page. */
const page = (id: string, overrides: Partial<PromotePageRow> = {}): PromotePageRow => ({
  id,
  parentId: null,
  kind: 'PAGE',
  title: id,
  slug: id.replace(/^v\d?-/, ''),
  path: id.replace(/^v\d?-/, ''),
  languageId: 'en',
  position: 0,
  createdAt: BEFORE,
  updatedAt: BEFORE,
  hash: `h:${id.replace(/^v\d?-/, '')}`,
  ...overrides,
});
/** The version's copy of main page `id` (as `v-id`), parent remapped. */
const copyOf = (p: PromotePageRow, overrides: Partial<PromotePageRow> = {}, prefix = 'v'): PromotePageRow =>
  page(`${prefix}-${p.id}`, {
    ...p,
    id: `${prefix}-${p.id}`,
    parentId: p.parentId ? `${prefix}-${p.parentId}` : null,
    updatedAt: FORK,
    ...overrides,
  });

/** Fork `main`: the baseline maps `x` to `<prefix>-x`; both hash as at the fork. */
const forkOf = (main: PromotePageRow[], prefix = 'v'): ForkPoint => {
  const hashes = new Map(main.flatMap((p) => [[p.id, p.hash] as const, [`${prefix}-${p.id}`, p.hash] as const]));
  const forkBaseline = buildForkBaseline(
    main,
    (id) => `${prefix}-${id}`,
    (id) => hashes.get(id) ?? '',
  );
  return forkPointOf({ createdAt: FORK, forkedAt: FORK, forkBaseline: forkBaseline as never });
};
const legacy: ForkPoint = forkPointOf({ createdAt: FORK, forkedAt: null, forkBaseline: null });
const analyze = (main: PromotePageRow[], version: PromotePageRow[], fork: ForkPoint) => analyzePromote(main, version, fork, codes);

describe('analyzePromote: preview', () => {
  const atFork = [page('billing'), page('guide', { kind: 'GROUP' }), page('intro', { parentId: 'guide', path: 'guide/intro' })];
  const untouchedVersion = atFork.map((p) => copyOf(p));

  it('reports nothing and writes nothing but the fold when neither side changed', () => {
    const { preview, plan } = analyze(atFork, untouchedVersion, forkOf(atFork));
    expect(preview).toEqual({ changedOnMainSinceFork: [], baselineComplete: true });
    expect(plan).toEqual({
      mainUpdates: [],
      moves: [],
      consumed: atFork.map((p) => ({ copyId: `v-${p.id}`, mainId: p.id })),
      dropVersionIds: [],
      deleteMainIds: [],
      blocked: false,
    });
  });

  it('lists modified, added and deleted pages sorted by path, with what promote will do', () => {
    const now = [
      page('billing', { title: 'Billing fixed', hash: 'h:billing-2', updatedAt: AFTER }),
      page('guide', { kind: 'GROUP' }),
      page('refunds', { languageId: 'ar', createdAt: AFTER, updatedAt: AFTER }),
    ];
    expect(analyze(now, untouchedVersion, forkOf(atFork)).preview).toEqual({
      baselineComplete: true,
      changedOnMainSinceFork: [
        {
          pageId: 'billing',
          title: 'Billing fixed',
          path: 'billing',
          languageCode: 'en',
          change: 'modified',
          onPromote: 'kept',
          updatedAt: AFTER.toISOString(),
        },
        {
          pageId: 'intro',
          title: 'intro',
          path: 'guide/intro',
          languageCode: 'en',
          change: 'deleted',
          onPromote: 'removed',
          updatedAt: BEFORE.toISOString(),
        },
        {
          pageId: 'refunds',
          title: 'refunds',
          path: 'refunds',
          languageCode: 'ar',
          change: 'added',
          onPromote: 'kept',
          updatedAt: AFTER.toISOString(),
        },
      ],
    });
  });

  it('says the version replaces a page both sides edited, and removes one the version deleted', () => {
    const now = [
      page('billing', { hash: 'h:main-edit', updatedAt: AFTER }),
      ...atFork.slice(1).map((p) => ({ ...p, hash: `${p.hash}!`, updatedAt: AFTER })),
    ];
    const version = [copyOf(atFork[0] as PromotePageRow, { hash: 'h:version-edit' }), copyOf(atFork[1] as PromotePageRow)];
    const changed = analyze(now, version, forkOf(atFork)).preview.changedOnMainSinceFork;
    expect(changed.map((c) => [c.pageId, c.change, c.onPromote])).toEqual([
      ['billing', 'modified', 'replaced'],
      ['guide', 'modified', 'kept'],
      ['intro', 'modified', 'removed'],
    ]);
  });

  it('ignores a reorder on main: positions alone are not a change', () => {
    const reordered = atFork.map((p, i) => ({ ...p, position: 10 - i, updatedAt: AFTER }));
    const { preview, plan } = analyze(reordered, untouchedVersion, forkOf(atFork));
    expect(preview.changedOnMainSinceFork).toEqual([]);
    expect(plan.mainUpdates).toEqual([]);
  });

  it('falls back to the fork time without a baseline and cannot see deletions', () => {
    const now = [page('billing', { updatedAt: AFTER }), page('refunds', { createdAt: AFTER, updatedAt: AFTER }), page('old')];
    expect(analyze(now, [], legacy).preview).toEqual({
      baselineComplete: false,
      changedOnMainSinceFork: [
        expect.objectContaining({ pageId: 'billing', change: 'modified', onPromote: 'replaced' }),
        expect.objectContaining({ pageId: 'refunds', change: 'added', onPromote: 'kept' }),
      ],
    });
  });

  it('treats a malformed or unreleased v1 baseline as no baseline', () => {
    expect(forkPointOf({ createdAt: FORK, forkedAt: FORK, forkBaseline: { version: 2, pages: { a: { copyId: 1 } } } }).baseline).toBeNull();
    expect(forkPointOf({ createdAt: FORK, forkedAt: FORK, forkBaseline: { version: 1, pages: {} } }).baseline).toBeNull();
  });
});

describe('inheritForkBaseline', () => {
  it("remaps a version's baseline onto its own copies, keeping the first version's edits as its own", () => {
    const atFork = [page('intro'), page('billing'), page('old')];
    const v2 = forkOf(atFork, 'v2');
    if (!v2.baseline) throw new Error('no baseline');
    // V3 is forked from V2 (which edited intro and deleted old): v2-x → v3-x.
    const v3Baseline = inheritForkBaseline(v2.baseline, (id) => (id === 'v2-old' ? undefined : id.replace('v2-', 'v3-')));
    const v3 = forkPointOf({ createdAt: FORK, forkedAt: FORK, forkBaseline: v3Baseline as never });
    const v3Pages = [copyOf(atFork[0] as PromotePageRow, { hash: 'h:intro-v2' }, 'v3'), copyOf(atFork[1] as PromotePageRow, {}, 'v3')];
    const { preview, plan } = analyze(atFork, v3Pages, v3);
    expect(preview).toEqual({ changedOnMainSinceFork: [], baselineComplete: true });
    // Main keeps its ids: intro takes V2's (now V3's) text in place, old is deleted.
    expect(plan.mainUpdates).toEqual([{ id: 'intro', fromCopyId: 'v3-intro', data: {} }]);
    expect(plan.deleteMainIds).toEqual(['old']);
    expect(plan.moves).toEqual([]);
  });
});

describe('analyzePromote: plan', () => {
  it('updates main pages in place, taking only what the version changed', () => {
    const atFork = [page('guide', { kind: 'GROUP' }), page('billing', { position: 1 }), page('faq', { position: 2 })];
    const now = [atFork[0] as PromotePageRow, page('billing', { position: 1, hash: 'h:main-edit', updatedAt: AFTER }), page('faq', { position: 5 })];
    const version = [
      copyOf(atFork[0] as PromotePageRow),
      copyOf(atFork[1] as PromotePageRow, { hash: 'h:version-edit' }),
      copyOf(atFork[2] as PromotePageRow, { parentId: 'v-guide', position: 0 }),
    ];
    const { plan } = analyze(now, version, forkOf(atFork));
    expect(plan.mainUpdates).toEqual([
      { id: 'billing', fromCopyId: 'v-billing', data: {} },
      // Moved under the group in the version: parent and position from the version.
      { id: 'faq', data: { position: 0, parentId: 'guide' } },
    ]);
    expect(plan.moves).toEqual([]);
    expect(plan.deleteMainIds).toEqual([]);
  });

  it("takes the version's order after a drag there, without treating the copies as edited", () => {
    const atFork = [page('a', { position: 0 }), page('b', { position: 1 }), page('gone', { position: 2 })];
    const now = [page('a', { position: 0 }), page('b', { position: 1 })];
    // A drag in the version rewrote every copy's position, nothing else.
    const version = atFork.map((p, i) => copyOf(p, { position: 2 - i, updatedAt: AFTER }));
    const { preview, plan } = analyze(now, version, forkOf(atFork));
    // Only positions that moved are written ("b" stayed at 1).
    expect(plan.mainUpdates).toEqual([{ id: 'a', data: { position: 2 } }]);
    // The page deleted on main stays deleted: a drag is not an edit.
    expect(plan.dropVersionIds).toEqual(['v-gone']);
    expect(plan.moves).toEqual([]);
    expect(preview.changedOnMainSinceFork).toMatchObject([{ pageId: 'gone', change: 'deleted', onPromote: 'removed' }]);
  });

  it('moves new version pages in under the main page their parent folds into', () => {
    const atFork = [page('guide', { kind: 'GROUP' })];
    const version = [copyOf(atFork[0] as PromotePageRow), page('v-new', { parentId: 'v-guide', path: 'guide/new', hash: 'h:new' })];
    expect(analyze(atFork, version, forkOf(atFork)).plan.moves).toEqual([{ id: 'v-new', data: { parentId: 'guide' } }]);
  });

  it('keeps pages added on main, moving them up when the version deleted their parent, and says so', () => {
    const atFork = [page('root', { kind: 'GROUP' }), page('guide', { kind: 'GROUP', parentId: 'root', path: 'root/guide' })];
    const now = [...atFork, page('refunds', { parentId: 'guide', path: 'root/guide/refunds', createdAt: AFTER, updatedAt: AFTER })];
    const keptRoot = analyze(now, [copyOf(atFork[0] as PromotePageRow)], forkOf(atFork));
    expect(keptRoot.plan.deleteMainIds).toEqual(['guide']);
    expect(keptRoot.plan.mainUpdates).toEqual([{ id: 'refunds', data: { parentId: 'root' } }]);
    expect(keptRoot.preview.changedOnMainSinceFork).toEqual([
      expect.objectContaining({ pageId: 'refunds', change: 'added', onPromote: 'moved', newParentPath: 'root' }),
    ]);
    const topLevel = analyze(now, [], forkOf(atFork));
    expect(topLevel.plan.mainUpdates).toEqual([{ id: 'refunds', data: { parentId: null } }]);
    expect(topLevel.preview.changedOnMainSinceFork).toContainEqual(
      expect.objectContaining({ pageId: 'refunds', onPromote: 'moved', newParentPath: null }),
    );
  });

  it('brings back a page deleted on main only when the version edited it, or keeps a page under it', () => {
    const atFork = [page('old'), page('edited'), page('guide', { kind: 'GROUP' }), page('intro', { parentId: 'guide' })];
    const version = [
      copyOf(atFork[0] as PromotePageRow),
      copyOf(atFork[1] as PromotePageRow, { hash: 'h:edited-2' }),
      copyOf(atFork[2] as PromotePageRow),
      copyOf(atFork[3] as PromotePageRow),
      page('v-new', { parentId: 'v-guide', hash: 'h:new' }),
    ];
    const { plan, preview } = analyze([], version, forkOf(atFork));
    expect(plan.moves.map((m) => m.id).sort()).toEqual(['v-edited', 'v-guide', 'v-new']);
    expect(plan.dropVersionIds.sort()).toEqual(['v-intro', 'v-old']);
    expect(preview.changedOnMainSinceFork.map((c) => [c.pageId, c.onPromote])).toEqual([
      ['edited', 'restored'],
      ['guide', 'restored'],
      ['intro', 'removed'],
      ['old', 'removed'],
    ]);
  });

  it('keeps page identity across successive promotions (no duplicate pages)', () => {
    const atFork = [page('intro'), page('billing')];
    const v2 = forkOf(atFork, 'v2');
    const v3 = forkOf(atFork, 'v3');
    // V2 edited intro and was promoted: main's ids stay, intro now has V2's text.
    const afterV2 = [page('intro', { hash: 'h:intro-v2', updatedAt: AFTER }), page('billing')];
    expect(
      analyze(atFork, [copyOf(atFork[0] as PromotePageRow, { hash: 'h:intro-v2' }, 'v2'), copyOf(atFork[1] as PromotePageRow, {}, 'v2')], v2).plan
        .mainUpdates,
    ).toEqual([{ id: 'intro', fromCopyId: 'v2-intro', data: {} }]);
    // V3 also edited intro.
    const v3Pages = [copyOf(atFork[0] as PromotePageRow, { hash: 'h:intro-v3' }, 'v3'), copyOf(atFork[1] as PromotePageRow, {}, 'v3')];
    const { preview, plan } = analyze(afterV2, v3Pages, v3);
    expect(preview.changedOnMainSinceFork).toMatchObject([{ pageId: 'intro', change: 'modified', onPromote: 'replaced' }]);
    expect(plan.moves).toEqual([]);
    expect(plan.deleteMainIds).toEqual([]);
    expect(plan.mainUpdates).toEqual([{ id: 'intro', fromCopyId: 'v3-intro', data: {} }]);
  });

  it('gives a version page a numbered slug when it would land on the address of a page on main', () => {
    const atFork = [page('billing')];
    const now = [...atFork, page('refunds', { createdAt: AFTER, updatedAt: AFTER })];
    const version = [copyOf(atFork[0] as PromotePageRow), page('v-refunds-new', { slug: 'refunds', path: 'refunds', hash: 'h:x' })];
    const { preview, plan } = analyze(now, version, forkOf(atFork));
    expect(preview.changedOnMainSinceFork).toEqual([
      expect.objectContaining({ pageId: 'refunds', change: 'added', onPromote: 'kept' }),
      expect.objectContaining({ pageId: 'v-refunds-new', path: 'refunds', change: 'conflict', onPromote: 'renamed', newPath: 'refunds-2' }),
    ]);
    expect(plan.moves).toEqual([{ id: 'v-refunds-new', data: { parentId: null, slug: 'refunds-2' } }]);
  });

  it('settles duplicates that come only from the version, keeping the lowest id', () => {
    const atFork = [page('g', { kind: 'GROUP' })];
    const version = [
      copyOf(atFork[0] as PromotePageRow),
      page('v-b', { parentId: 'v-g', slug: 'x', path: 'g/x', hash: 'h:b' }),
      page('v-a', { parentId: 'v-g', slug: 'x', path: 'g/x', hash: 'h:a' }),
    ];
    const { preview, plan } = analyze(atFork, version, forkOf(atFork));
    expect(plan.moves).toEqual([
      { id: 'v-a', data: { parentId: 'g' } },
      { id: 'v-b', data: { parentId: 'g', slug: 'x-2' } },
    ]);
    expect(preview.changedOnMainSinceFork).toEqual([expect.objectContaining({ pageId: 'v-b', path: 'g/x', change: 'conflict', newPath: 'g/x-2' })]);
  });

  it('renames a clashing folder once: its pages follow it instead of getting their own suffix', () => {
    const atFork = [page('billing')];
    // Main added folder "docs" with "intro"; the version added its own "docs" with "intro".
    const now = [
      ...atFork,
      page('docs', { kind: 'GROUP', createdAt: AFTER }),
      page('intro', { parentId: 'docs', path: 'docs/intro', createdAt: AFTER }),
    ];
    const version = [
      copyOf(atFork[0] as PromotePageRow),
      page('v-docs', { kind: 'GROUP', slug: 'docs', path: 'docs', hash: 'h:vdocs' }),
      page('v-intro', { parentId: 'v-docs', slug: 'intro', path: 'docs/intro', hash: 'h:vintro' }),
    ];
    const { preview, plan } = analyze(now, version, forkOf(atFork));
    expect(plan.moves).toEqual([
      { id: 'v-docs', data: { parentId: null, slug: 'docs-2' } },
      { id: 'v-intro', data: { parentId: 'v-docs' } },
    ]);
    expect(preview.changedOnMainSinceFork.filter((c) => c.change === 'conflict')).toEqual([
      expect.objectContaining({ pageId: 'v-docs', path: 'docs', newPath: 'docs-2' }),
    ]);
  });

  it('does not let a content-only edit decide who keeps an address', () => {
    const atFork = [page('a')];
    // The version only rewrote the text of "a", and added a new page with slug "a".
    const version = [copyOf(atFork[0] as PromotePageRow, { hash: 'h:a-text' }), page('v-new', { slug: 'a', path: 'a', hash: 'h:new' })];
    const { preview, plan } = analyze(atFork, version, forkOf(atFork));
    // Main's "a" keeps its address (its slug still comes from main); the new page is renamed.
    expect(plan.mainUpdates).toEqual([{ id: 'a', fromCopyId: 'v-a', data: {} }]);
    expect(plan.moves).toEqual([{ id: 'v-new', data: { parentId: null, slug: 'a-2' } }]);
    expect(preview.changedOnMainSinceFork).toEqual([expect.objectContaining({ pageId: 'v-new', change: 'conflict', newPath: 'a-2' })]);
  });

  it('refuses a plan that would put two pages inside each other', () => {
    const atFork = [page('a'), page('b')];
    // Main moved A under B; the version moved B under A.
    const now = [page('a', { parentId: 'b', path: 'b/a', updatedAt: AFTER }), page('b')];
    const version = [copyOf(atFork[0] as PromotePageRow), copyOf(atFork[1] as PromotePageRow, { parentId: 'v-a', path: 'a/b' })];
    const { preview, plan } = analyze(now, version, forkOf(atFork));
    expect(plan.blocked).toBe(true);
    expect(preview.changedOnMainSinceFork.filter((c) => c.change === 'conflict')).toEqual([
      expect.objectContaining({ pageId: 'b', path: 'b', onPromote: 'blocked' }),
      expect.objectContaining({ pageId: 'a', path: 'b/a', onPromote: 'blocked' }),
    ]);
  });

  it('without a baseline, replaces forked pages and re-homes added ones by address', () => {
    const now = [page('guide', { kind: 'GROUP' }), page('refunds', { parentId: 'guide', path: 'guide/refunds', createdAt: AFTER })];
    const { plan } = analyze(now, [page('v-guide', { kind: 'GROUP', path: 'guide' })], legacy);
    expect(plan.deleteMainIds).toEqual(['guide']);
    expect(plan.moves).toEqual([{ id: 'v-guide', data: { parentId: null } }]);
    expect(plan.mainUpdates).toEqual([{ id: 'refunds', data: { parentId: 'v-guide' } }]);
  });
});
