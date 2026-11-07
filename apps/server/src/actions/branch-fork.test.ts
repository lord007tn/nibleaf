import { describe, expect, it } from 'vitest';
import { analyzePromote, buildForkBaseline, forkPointOf, inheritForkBaseline, type PromotePageRow, previewFingerprint } from './branch-fork';

const FORK = new Date('2026-11-01T10:00:00.000Z');
const BEFORE = new Date('2026-10-30T10:00:00.000Z');
const AFTER = new Date('2026-11-02T10:00:00.000Z');
const codes = new Map([
  ['en', 'en'],
  ['ar', 'ar'],
]);

type Baseline = NonNullable<ReturnType<typeof forkPointOf>['baseline']>;

/** The content hash stands in for the SQL one: any field change changes it. */
const withHash = (p: Omit<PromotePageRow, 'hash'> & { hash?: string }): PromotePageRow => ({
  ...p,
  hash: JSON.stringify([p.kind, p.title, p.slug, p.icon, p.description, p.contentHash, p.configHash, p.translationKey, p.hidden]),
});
const bare = (id: string) => id.replace(/^v\d?-/, '');
/** A page row. Override `contentHash` to "edit its text". */
const page = (id: string, overrides: Partial<Omit<PromotePageRow, 'hash'>> = {}): PromotePageRow =>
  withHash({
    id,
    parentId: null,
    kind: 'PAGE',
    title: bare(id),
    slug: bare(id),
    path: bare(id),
    languageId: 'en',
    position: 0,
    updatedAt: BEFORE,
    icon: null,
    description: null,
    hidden: false,
    translationKey: null,
    contentHash: `text:${bare(id)}`,
    configHash: 'cfg',
    ...overrides,
  });
/** The version's copy of main page `p` (as `<prefix>-id`), parent remapped. */
const copyOf = (p: PromotePageRow, overrides: Partial<Omit<PromotePageRow, 'hash'>> = {}, prefix = 'v'): PromotePageRow =>
  withHash({ ...p, id: `${prefix}-${p.id}`, parentId: p.parentId ? `${prefix}-${p.parentId}` : null, updatedAt: FORK, ...overrides });
/** Rename `<from>-x` ids to `<to>-x` (a version forked from a version). */
const rename = (p: PromotePageRow, from: string, to: string) =>
  withHash({ ...p, id: p.id.replace(`${from}-`, `${to}-`), parentId: p.parentId?.replace(`${from}-`, `${to}-`) ?? null });

const parse = (forkBaseline: unknown): Baseline => {
  const { baseline } = forkPointOf({ createdAt: FORK, forkedAt: FORK, forkBaseline: forkBaseline as never });
  if (!baseline) throw new Error('baseline did not parse');
  return baseline;
};
/** Fork `main`: the baseline maps `x` to `<prefix>-x`. */
const forkOf = (main: PromotePageRow[], prefix = 'v'): Baseline =>
  parse(
    buildForkBaseline(main, (id) => {
      const row = main.find((p) => p.id === id) as PromotePageRow;
      return { id: `${prefix}-${id}`, hash: row.hash, configHash: row.configHash };
    }),
  );
/** Fork a version (`pages`, ids `<from>-x`) into `<to>-x`, copies identical. */
const forkVersion = (source: Baseline, pages: PromotePageRow[], from: string, to: string): Baseline =>
  parse(
    inheritForkBaseline(source, pages, (id) => {
      const row = pages.find((p) => p.id === id);
      return row ? { id: id.replace(`${from}-`, `${to}-`), hash: row.hash, configHash: row.configHash } : undefined;
    }),
  );
/** The same baseline as #334 records it: no per-field values. */
const withoutFields = (baseline: Baseline): Baseline =>
  ({
    version: 2,
    pages: Object.fromEntries(Object.entries(baseline.pages).map(([k, { fields: _fields, ...e }]) => [k, e])),
  }) as Baseline;
const analyze = (main: PromotePageRow[], version: PromotePageRow[], baseline: Baseline) => analyzePromote(main, version, baseline, codes);
const at = <T>(list: T[], i: number) => list[i] as T;

describe('analyzePromote: preview', () => {
  const atFork = [page('billing'), page('guide', { kind: 'GROUP' }), page('intro', { parentId: 'guide', path: 'guide/intro' })];
  const untouchedVersion = atFork.map((p) => copyOf(p));

  it('reports nothing and writes nothing but the fold when neither side changed', () => {
    const { preview, plan } = analyze(atFork, untouchedVersion, forkOf(atFork));
    expect(preview).toEqual({ changedOnMainSinceFork: [], baselineComplete: true, fingerprint: previewFingerprint([]) });
    expect(plan).toMatchObject({
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
      page('billing', { title: 'Billing fixed', updatedAt: AFTER }),
      page('guide', { kind: 'GROUP' }),
      page('refunds', { languageId: 'ar', updatedAt: AFTER }),
    ];
    expect(analyze(now, untouchedVersion, forkOf(atFork)).preview.changedOnMainSinceFork).toEqual([
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
    ]);
  });

  it('says the version replaces a field both sides edited, and removes a page the version deleted', () => {
    const now = [
      page('billing', { title: 'Main title', updatedAt: AFTER }),
      ...atFork.slice(1).map((p) => withHash({ ...p, contentHash: 'main-edit', updatedAt: AFTER })),
    ];
    const version = [copyOf(at(atFork, 0), { title: 'Version title' }), copyOf(at(atFork, 1))];
    expect(analyze(now, version, forkOf(atFork)).preview.changedOnMainSinceFork.map((c) => [c.pageId, c.change, c.onPromote])).toEqual([
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

  it('fingerprints exactly what was listed, so a later edit on main changes it', () => {
    const edited = [page('billing', { contentHash: 'one', updatedAt: AFTER }), ...atFork.slice(1)];
    const first = analyze(edited, untouchedVersion, forkOf(atFork)).preview;
    expect(first.fingerprint).toBe(previewFingerprint(first.changedOnMainSinceFork));
    const again = [page('billing', { contentHash: 'two', updatedAt: new Date(AFTER.getTime() + 1000) }), ...atFork.slice(1)];
    expect(analyze(again, untouchedVersion, forkOf(atFork)).preview.fingerprint).not.toBe(first.fingerprint);
  });

  it('treats a malformed or unreleased v1 baseline, or none, as no baseline', () => {
    expect(forkPointOf({ createdAt: FORK, forkedAt: FORK, forkBaseline: { version: 2, pages: { a: { copyId: 1 } } } }).baseline).toBeNull();
    expect(forkPointOf({ createdAt: FORK, forkedAt: FORK, forkBaseline: { version: 1, pages: {} } }).baseline).toBeNull();
    expect(forkPointOf({ createdAt: FORK, forkedAt: null, forkBaseline: null }).baseline).toBeNull();
  });
});

describe('analyzePromote: field-by-field merge', () => {
  it("keeps main's rename and hiding when the version only fixed the text", () => {
    const atFork = [page('pricing')];
    const now = [page('pricing', { slug: 'plans', path: 'plans', hidden: true, updatedAt: AFTER })];
    const version = [copyOf(at(atFork, 0), { contentHash: 'typo fixed' })];
    const { preview, plan } = analyze(now, version, forkOf(atFork));
    expect(plan.mainUpdates).toEqual([{ id: 'pricing', contentFrom: 'v-pricing', data: {} }]);
    expect(preview.changedOnMainSinceFork).toEqual([expect.objectContaining({ pageId: 'pricing', change: 'modified', onPromote: 'merged' })]);
    // The slug still comes from main: no address arrives from the version.
    expect(plan.incoming).toEqual([]);
  });

  it('lets the version win a field both sides changed, and keeps the others from main', () => {
    const atFork = [page('pricing')];
    const now = [page('pricing', { title: 'Main title', icon: 'star', updatedAt: AFTER })];
    const version = [copyOf(at(atFork, 0), { title: 'Version title', configHash: 'version settings' })];
    const { preview, plan } = analyze(now, version, forkOf(atFork));
    expect(plan.mainUpdates).toEqual([{ id: 'pricing', configFrom: 'v-pricing', data: { title: 'Version title' } }]);
    expect(preview.changedOnMainSinceFork).toEqual([expect.objectContaining({ onPromote: 'replaced' })]);
  });

  it('without per-field values (#334 baselines), replaces a page both sides changed as a listed change, never silently', () => {
    const atFork = [page('pricing'), page('faq')];
    const now = [page('pricing', { slug: 'plans', path: 'plans', updatedAt: AFTER }), page('faq')];
    const version = [copyOf(at(atFork, 0), { contentHash: 'typo fixed' }), copyOf(at(atFork, 1), { title: 'FAQ' })];
    const { preview, plan } = analyze(now, version, withoutFields(forkOf(atFork)));
    expect(preview.changedOnMainSinceFork).toEqual([expect.objectContaining({ pageId: 'pricing', change: 'modified', onPromote: 'replaced' })]);
    expect(plan.mainUpdates).toEqual([
      { id: 'pricing', contentFrom: 'v-pricing', data: { slug: 'pricing' } },
      // Main did not touch "faq": taking the copy whole reverts nothing.
      { id: 'faq', data: { title: 'FAQ' } },
    ]);
  });
});

describe('analyzePromote: plan', () => {
  it('updates main pages in place, taking only what the version changed', () => {
    const atFork = [page('guide', { kind: 'GROUP' }), page('billing', { position: 1 }), page('faq', { position: 2 })];
    const now = [at(atFork, 0), page('billing', { position: 1, contentHash: 'main-edit', updatedAt: AFTER }), page('faq', { position: 5 })];
    const version = [
      copyOf(at(atFork, 0)),
      copyOf(at(atFork, 1), { title: 'Billing v2' }),
      copyOf(at(atFork, 2), { parentId: 'v-guide', position: 0 }),
    ];
    const { plan } = analyze(now, version, forkOf(atFork));
    expect(plan.mainUpdates).toEqual([
      { id: 'billing', data: { title: 'Billing v2' } },
      // Moved under the group in the version: parent and position from the version.
      { id: 'faq', data: { position: 0, parentId: 'guide' } },
    ]);
    expect(plan.moves).toEqual([]);
    expect(plan.deleteMainIds).toEqual([]);
  });

  it("takes the version's order after a drag there, without treating the copies as edited", () => {
    const atFork = [page('a', { position: 0 }), page('b', { position: 1 }), page('gone', { position: 2 })];
    const now = [page('a', { position: 0 }), page('b', { position: 1 })];
    const version = atFork.map((p, i) => copyOf(p, { position: 2 - i, updatedAt: AFTER }));
    const { preview, plan } = analyze(now, version, forkOf(atFork));
    expect(plan.mainUpdates).toEqual([{ id: 'a', data: { position: 2 } }]);
    expect(plan.dropVersionIds).toEqual(['v-gone']);
    expect(plan.moves).toEqual([]);
    expect(preview.changedOnMainSinceFork).toMatchObject([{ pageId: 'gone', change: 'deleted', onPromote: 'removed' }]);
  });

  it('moves new version pages in under the main page their parent folds into', () => {
    const atFork = [page('guide', { kind: 'GROUP' })];
    const version = [copyOf(at(atFork, 0)), page('v-new', { parentId: 'v-guide', path: 'guide/new' })];
    expect(analyze(atFork, version, forkOf(atFork)).plan.moves).toEqual([{ id: 'v-new', data: { parentId: 'guide' } }]);
  });

  it('keeps pages added on main, moving them up when the version deleted their parent, and says so', () => {
    const atFork = [page('root', { kind: 'GROUP' }), page('guide', { kind: 'GROUP', parentId: 'root', path: 'root/guide' })];
    const now = [...atFork, page('refunds', { parentId: 'guide', path: 'root/guide/refunds', updatedAt: AFTER })];
    const keptRoot = analyze(now, [copyOf(at(atFork, 0))], forkOf(atFork));
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

  it('gives a re-homed page a numbered address when its new place is taken', () => {
    const atFork = [page('billing'), page('guide', { kind: 'GROUP' })];
    // Main added guide/billing; the version deleted the guide folder.
    const now = [...atFork, page('guide-billing', { slug: 'billing', parentId: 'guide', path: 'guide/billing', updatedAt: AFTER })];
    const { preview, plan } = analyze(now, [copyOf(at(atFork, 0))], forkOf(atFork));
    // The existing /billing keeps its address; the moved page becomes billing-2.
    expect(plan.mainUpdates).toEqual([{ id: 'guide-billing', data: { parentId: null, slug: 'billing-2' } }]);
    expect(preview.changedOnMainSinceFork).toContainEqual(
      expect.objectContaining({ pageId: 'guide-billing', change: 'conflict', onPromote: 'renamed', newPath: 'billing-2' }),
    );
    expect(preview.changedOnMainSinceFork).toContainEqual(expect.objectContaining({ pageId: 'guide-billing', change: 'added', onPromote: 'moved' }));
  });

  it('brings back a page deleted on main only when the version edited it, or keeps a page under it', () => {
    const atFork = [page('old'), page('edited'), page('guide', { kind: 'GROUP' }), page('intro', { parentId: 'guide' })];
    const version = [
      copyOf(at(atFork, 0)),
      copyOf(at(atFork, 1), { contentHash: 'edited-2' }),
      copyOf(at(atFork, 2)),
      copyOf(at(atFork, 3)),
      page('v-new', { parentId: 'v-guide' }),
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

  it('keeps page identity across successive promotions of versions forked together', () => {
    const atFork = [page('intro'), page('billing')];
    const v3 = forkOf(atFork, 'v3');
    // V2 edited intro and was promoted: main's ids stay, intro now has V2's text.
    const afterV2 = [page('intro', { contentHash: 'v2 text', updatedAt: AFTER }), page('billing')];
    const v3Pages = [copyOf(at(atFork, 0), { contentHash: 'v3 text' }, 'v3'), copyOf(at(atFork, 1), {}, 'v3')];
    const { preview, plan } = analyze(afterV2, v3Pages, v3);
    expect(preview.changedOnMainSinceFork).toMatchObject([{ pageId: 'intro', change: 'modified', onPromote: 'replaced' }]);
    expect(plan.moves).toEqual([]);
    expect(plan.mainUpdates).toEqual([{ id: 'intro', contentFrom: 'v3-intro', data: {} }]);
  });

  it('gives a version page a numbered slug when it would land on the address of a page on main', () => {
    const atFork = [page('billing')];
    const now = [...atFork, page('refunds', { updatedAt: AFTER })];
    const version = [copyOf(at(atFork, 0)), page('v-refunds-new', { slug: 'refunds', path: 'refunds' })];
    const { preview, plan } = analyze(now, version, forkOf(atFork));
    expect(preview.changedOnMainSinceFork).toEqual([
      expect.objectContaining({ pageId: 'refunds', change: 'added', onPromote: 'kept' }),
      expect.objectContaining({ pageId: 'v-refunds-new', path: 'refunds', change: 'conflict', onPromote: 'renamed', newPath: 'refunds-2' }),
    ]);
    expect(plan.moves).toEqual([{ id: 'v-refunds-new', data: { parentId: null, slug: 'refunds-2' } }]);
    expect(plan.incoming).toEqual([{ languageId: 'en', path: 'refunds-2' }]);
  });

  it('settles duplicates that come only from the version, keeping the lowest id', () => {
    const atFork = [page('g', { kind: 'GROUP' })];
    const version = [
      copyOf(at(atFork, 0)),
      page('v-b', { parentId: 'v-g', slug: 'x', path: 'g/x' }),
      page('v-a', { parentId: 'v-g', slug: 'x', path: 'g/x' }),
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
    const now = [
      ...atFork,
      page('docs', { kind: 'GROUP', updatedAt: AFTER }),
      page('intro', { parentId: 'docs', path: 'docs/intro', updatedAt: AFTER }),
    ];
    const version = [
      copyOf(at(atFork, 0)),
      page('v-docs', { kind: 'GROUP', slug: 'docs', path: 'docs' }),
      page('v-intro', { parentId: 'v-docs', slug: 'intro', path: 'docs/intro' }),
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
    const version = [copyOf(at(atFork, 0), { contentHash: 'a text' }), page('v-new', { slug: 'a', path: 'a' })];
    const { preview, plan } = analyze(atFork, version, forkOf(atFork));
    expect(plan.mainUpdates).toEqual([{ id: 'a', contentFrom: 'v-a', data: {} }]);
    expect(plan.moves).toEqual([{ id: 'v-new', data: { parentId: null, slug: 'a-2' } }]);
    expect(preview.changedOnMainSinceFork).toEqual([expect.objectContaining({ pageId: 'v-new', change: 'conflict', newPath: 'a-2' })]);
  });

  it('refuses a plan that would put two pages inside each other', () => {
    const atFork = [page('a'), page('b')];
    const now = [page('a', { parentId: 'b', path: 'b/a', updatedAt: AFTER }), page('b')];
    const version = [copyOf(at(atFork, 0)), copyOf(at(atFork, 1), { parentId: 'v-a', path: 'a/b' })];
    const { preview, plan } = analyze(now, version, forkOf(atFork));
    expect(plan.blocked).toBe(true);
    expect(preview.changedOnMainSinceFork.filter((c) => c.change === 'conflict')).toEqual([
      expect.objectContaining({ pageId: 'b', path: 'b', onPromote: 'blocked' }),
      expect.objectContaining({ pageId: 'a', path: 'b/a', onPromote: 'blocked' }),
    ]);
  });
});

describe('inheritForkBaseline (a version made from another version)', () => {
  // main: guide/intro, old. V2 forks it, edits intro, deletes old, adds guide/faq.
  const main = [page('guide', { kind: 'GROUP' }), page('intro', { parentId: 'guide', path: 'guide/intro' }), page('old')];
  const v2Baseline = forkOf(main, 'v2');
  const v2Pages = [
    copyOf(at(main, 0), {}, 'v2'),
    copyOf(at(main, 1), { contentHash: 'v2 text' }, 'v2'),
    page('v2-faq', { parentId: 'v2-guide', slug: 'faq', path: 'guide/faq', contentHash: 'faq text' }),
  ];
  const v3Baseline = forkVersion(v2Baseline, v2Pages, 'v2', 'v3');
  const v3Pages = v2Pages.map((p) => rename(p, 'v2', 'v3'));

  it("records the source's own pages, keyed by their source id, and remaps the rest", () => {
    expect(v3Baseline.pages['v2-faq']).toMatchObject({ copyId: 'v3-faq', origin: 'version', parentId: 'guide' });
    expect(v3Baseline.pages.intro).toMatchObject({ copyId: 'v3-intro', aka: ['v2-intro'] });
    // V2 deleted "old": its entry points at no copy, so it reads as deleted in the version.
    expect(v3Baseline.pages.old?.copyId).toBe('v2-old');
  });

  it("promotes before the source: the source's edits, deletions and pages count as its own", () => {
    const { preview, plan } = analyze(main, v3Pages, v3Baseline);
    expect(preview.changedOnMainSinceFork).toEqual([]);
    expect(plan.mainUpdates).toEqual([{ id: 'intro', contentFrom: 'v3-intro', data: {} }]);
    expect(plan.deleteMainIds).toEqual(['old']);
    expect(plan.moves).toEqual([{ id: 'v3-faq', data: { parentId: 'guide' } }]);
  });

  it('promotes after the source without duplicating the pages the source created', () => {
    // V2 was promoted: intro took its text, old is gone, faq moved onto main as v2-faq.
    const afterV2 = [
      at(main, 0),
      withHash({ ...at(main, 1), contentHash: 'v2 text', updatedAt: AFTER }),
      withHash({ ...at(v2Pages, 2), parentId: 'guide', updatedAt: AFTER }),
    ];
    const { preview, plan } = analyze(afterV2, v3Pages, v3Baseline);
    expect(plan.moves).toEqual([]);
    expect(plan.consumed).toContainEqual({ copyId: 'v3-faq', mainId: 'v2-faq' });
    expect(plan.mainUpdates).toEqual([]);
    expect(preview.changedOnMainSinceFork.filter((c) => c.change === 'added' || c.change === 'conflict')).toEqual([]);
  });

  it('finds a page the source restored onto main under its copy id', () => {
    // Main deleted "old"; V2 edited its copy, so promoting V2 restored it as v2-old.
    const mainWithoutOld = main.slice(0, 2);
    const v2Edited = [...v2Pages, copyOf(at(main, 2), { contentHash: 'v2 rewrote old' }, 'v2')];
    const baseline = forkVersion(v2Baseline, v2Edited, 'v2', 'v3');
    const v3 = v2Edited.map((p) => rename(p, 'v2', 'v3'));
    const afterV2 = [...mainWithoutOld, withHash({ ...at(v2Edited, 2), parentId: 'guide' }), at(v2Edited, 3)];
    const { plan } = analyze(afterV2, v3, baseline);
    expect(plan.consumed).toContainEqual({ copyId: 'v3-old', mainId: 'v2-old' });
    expect(plan.moves).toEqual([]);
  });
});
