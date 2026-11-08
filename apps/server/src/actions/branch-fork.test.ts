import { describe, expect, it } from 'vitest';
import {
  addForkCounterparts,
  analyzePromote,
  baselineOf,
  buildForkBaseline,
  inheritForkBaseline,
  type PromotePageRow,
  previewFingerprint,
  recordLanded,
} from './branch-fork';

const FORK = new Date('2026-11-01T10:00:00.000Z');
const BEFORE = new Date('2026-10-30T10:00:00.000Z');
const AFTER = new Date('2026-11-02T10:00:00.000Z');
const codes = new Map([
  ['en', 'en'],
  ['ar', 'ar'],
]);

type Baseline = NonNullable<ReturnType<typeof baselineOf>>;

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
  const baseline = baselineOf({ forkedAt: FORK, forkBaseline: forkBaseline as never });
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
    pages: Object.fromEntries(Object.entries(baseline.pages).map(([k, e]) => [k, { ...e, fields: undefined }])),
  }) as Baseline;
const analyze = (main: PromotePageRow[], version: PromotePageRow[], baseline: Baseline) => {
  const result = analyzePromote(main, version, baseline, codes);
  if (!result) throw new Error('baseline matched nothing on main');
  return result;
};
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

  it('fingerprints what would be lost: a later edit to a page the version overwrites changes it', () => {
    const versionEdited = [copyOf(at(atFork, 0), { contentHash: 'version text' }), ...untouchedVersion.slice(1)];
    const edited = [page('billing', { contentHash: 'one', updatedAt: AFTER }), ...atFork.slice(1)];
    const first = analyze(edited, versionEdited, forkOf(atFork)).preview;
    expect(first.changedOnMainSinceFork).toEqual([
      expect.objectContaining({ pageId: 'billing', onPromote: 'replaced', replacedFields: ['content'] }),
    ]);
    expect(first.fingerprint).toBe(previewFingerprint(first.changedOnMainSinceFork));
    const again = [page('billing', { contentHash: 'two', updatedAt: new Date(AFTER.getTime() + 1000) }), ...atFork.slice(1)];
    expect(analyze(again, versionEdited, forkOf(atFork)).preview.fingerprint).not.toBe(first.fingerprint);
    // Main edits that promote keeps ('kept') don't invalidate a confirmation.
    const keptOnce = analyze(edited, untouchedVersion, forkOf(atFork)).preview.fingerprint;
    expect(analyze(again, untouchedVersion, forkOf(atFork)).preview.fingerprint).toBe(keptOnce);
  });

  it('refuses a baseline that knows none of main pages any more (main was replaced)', () => {
    const reimported = atFork.map((p) => withHash({ ...p, id: `new-${p.id}`, parentId: p.parentId ? `new-${p.parentId}` : null }));
    expect(analyzePromote(reimported, untouchedVersion, forkOf(atFork), codes)).toBeNull();
    // An empty main is not a replacement: everything just reads as deleted on main.
    expect(analyzePromote([], untouchedVersion, forkOf(atFork), codes)).not.toBeNull();
  });

  it('trusts only baselines this code wrote: both #334 shapes are refused, whatever the timing', () => {
    // #334 wrote the v2 shape without the provenance marker or the additive keys.
    const { provenance: _marker, ...fresh334 } = withoutFields(forkOf(atFork));
    expect(baselineOf({ forkedAt: FORK, forkBaseline: fresh334 as never })).toBeNull();
    // #334's inheritance: the same entries with copy ids remapped onto the new copies.
    const chained334 = {
      version: 2,
      pages: Object.fromEntries(Object.entries(fresh334.pages).map(([key, e]) => [key, { ...e, copyId: e.copyId.replace('v-', 'v3-') }])),
    };
    expect(baselineOf({ forkedAt: FORK, forkBaseline: chained334 as never })).toBeNull();
    // Even #334's shape with every additive key, but no marker, is refused.
    const { provenance: _also, ...unmarked } = forkOf(atFork);
    expect(baselineOf({ forkedAt: FORK, forkBaseline: unmarked as never })).toBeNull();
  });

  it('trusts every baseline this code writes: fresh, inherited from a version, and empty', () => {
    expect(forkOf(atFork)).toMatchObject({ version: 2, provenance: 'three-way' });
    const versionPages = untouchedVersion.map((p) => rename(p, 'v', 'v2'));
    const inherited = parse(
      inheritForkBaseline(forkOf(atFork), untouchedVersion, (id) => {
        const row = untouchedVersion.find((p) => p.id === id);
        return row ? { id: id.replace('v-', 'v2-'), hash: row.hash, configHash: row.configHash } : undefined;
      }),
    );
    expect(inherited).toMatchObject({ provenance: 'three-way' });
    expect(analyze(atFork, versionPages, inherited).preview.changedOnMainSinceFork).toEqual([]);
    // A fork of an empty main: the baseline has no pages, and still promotes.
    const empty = parse(buildForkBaseline([], () => ({ id: 'none', hash: '', configHash: '' })));
    expect(empty).toEqual({ version: 2, provenance: 'three-way', pages: {} });
    const { plan } = analyze([], [page('v-new')], empty);
    expect(plan.moves).toEqual([{ id: 'v-new', data: { parentId: null } }]);
  });

  it('treats a malformed or unreleased v1 baseline, or none, as no baseline', () => {
    expect(baselineOf({ forkedAt: FORK, forkBaseline: { version: 2, provenance: 'three-way', pages: { a: { copyId: 1 } } } })).toBeNull();
    expect(baselineOf({ forkedAt: FORK, forkBaseline: { version: 1, pages: {} } })).toBeNull();
    expect(baselineOf({ forkedAt: null, forkBaseline: null })).toBeNull();
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
      // Main did not touch "faq": taking the copy whole reverts nothing.
      { id: 'faq', data: { title: 'FAQ' } },
      { id: 'pricing', contentFrom: 'v-pricing', data: { slug: 'pricing' } },
    ]);
    expect(preview.changedOnMainSinceFork[0]?.replacedFields).toEqual(['content', 'slug']);
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

  it('says where a merged or replaced page lands when its folder also goes away (#348)', () => {
    const atFork = [page('folder', { kind: 'GROUP' }), page('article')];
    // After the fork, main moves Article into Folder and edits it; the version
    // edits Article's title and deletes Folder.
    const now = [at(atFork, 0), page('article', { parentId: 'folder', path: 'folder/article', title: 'Main title', updatedAt: AFTER })];
    const replaced = analyze(now, [copyOf(at(atFork, 1), { title: 'Version title' })], forkOf(atFork));
    expect(replaced.plan.deleteMainIds).toEqual(['folder']);
    expect(replaced.plan.mainUpdates).toEqual([{ id: 'article', data: { title: 'Version title', parentId: null } }]);
    expect(replaced.preview.changedOnMainSinceFork.filter((c) => c.pageId === 'article')).toEqual([
      {
        pageId: 'article',
        title: 'Main title',
        path: 'folder/article',
        languageCode: 'en',
        change: 'modified',
        onPromote: 'replaced',
        replacedFields: ['title'],
        newParentPath: null,
        updatedAt: AFTER.toISOString(),
      },
    ]);

    const nowIcon = [at(atFork, 0), page('article', { parentId: 'folder', path: 'folder/article', icon: 'star', updatedAt: AFTER })];
    const merged = analyze(nowIcon, [copyOf(at(atFork, 1), { title: 'Version title' })], forkOf(atFork));
    expect(merged.preview.changedOnMainSinceFork.filter((c) => c.pageId === 'article')).toEqual([
      {
        pageId: 'article',
        title: 'article',
        path: 'folder/article',
        languageCode: 'en',
        change: 'modified',
        onPromote: 'merged',
        newParentPath: null,
        updatedAt: AFTER.toISOString(),
      },
    ]);

    // A kept folder deeper up: the page lands under it, by its final address.
    const deep = [page('root', { kind: 'GROUP' }), page('folder', { kind: 'GROUP', parentId: 'root', path: 'root/folder' }), page('article')];
    const deepNow = [at(deep, 0), at(deep, 1), page('article', { parentId: 'folder', path: 'root/folder/article', icon: 'star', updatedAt: AFTER })];
    const deepMerged = analyze(deepNow, [copyOf(at(deep, 0)), copyOf(at(deep, 2), { title: 'Version title' })], forkOf(deep));
    expect(deepMerged.preview.changedOnMainSinceFork).toContainEqual(
      expect.objectContaining({ pageId: 'article', onPromote: 'merged', newParentPath: 'root' }),
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

describe('chained versions, promoted in either order', () => {
  // main: guide/intro. V2 forks main and creates guide/faq; V3 and V4 fork V2.
  const main = [page('guide', { kind: 'GROUP' }), page('intro', { parentId: 'guide', path: 'guide/intro' })];
  const v2Pages = [
    copyOf(at(main, 0), {}, 'v2'),
    copyOf(at(main, 1), {}, 'v2'),
    page('v2-faq', { parentId: 'v2-guide', slug: 'faq', path: 'guide/faq', contentHash: 'faq text' }),
  ];
  const copies = (to: string) => (id: string) => {
    const row = v2Pages.find((p) => p.id === id);
    return row ? { id: id.replace('v2-', `${to}-`), hash: row.hash, configHash: row.configHash } : undefined;
  };
  const v3Fork = parse(inheritForkBaseline(forkOf(main, 'v2'), v2Pages, copies('v3')));
  const v4Fork = parse(inheritForkBaseline(forkOf(main, 'v2'), v2Pages, copies('v4')));
  const v2Fork = parse(addForkCounterparts(forkOf(main, 'v2'), v2Pages, copies('v3')));
  const v3Pages = v2Pages.map((p) => rename(p, 'v2', 'v3'));
  const v4Pages = v2Pages.map((p) => rename(p, 'v2', 'v4'));
  const landed = (main: PromotePageRow[], pages: PromotePageRow[], baseline: Baseline) => analyze(main, pages, baseline).plan.landed;
  const after = (base: Baseline, landedPages: ReturnType<typeof landed>) => parse(recordLanded(base, landedPages) ?? base);

  it('V2 then V3: V3 folds into the FAQ V2 put on main', () => {
    const v2Landed = landed(main, v2Pages, v2Fork);
    expect(v2Landed).toEqual([{ id: 'v2-faq', lineage: ['v2-faq', 'v3-faq'] }]);
    const v3 = after(v3Fork, v2Landed);
    expect(v3.pages['v2-faq']).toMatchObject({ reachedMain: true });
    const mainAfterV2 = [...main, withHash({ ...at(v2Pages, 2), parentId: 'guide' })];
    const { plan, preview } = analyze(mainAfterV2, v3Pages, v3);
    expect(plan.moves).toEqual([]);
    expect(plan.consumed).toContainEqual({ copyId: 'v3-faq', mainId: 'v2-faq' });
    expect(preview.changedOnMainSinceFork).toEqual([]);
  });

  it('V2, then main deletes the FAQ, then V3: an untouched FAQ stays deleted, an edited one is listed as restored', () => {
    const v3 = after(v3Fork, landed(main, v2Pages, v2Fork));
    const untouched = analyze(main, v3Pages, v3);
    expect(untouched.plan.moves).toEqual([]);
    expect(untouched.plan.dropVersionIds).toEqual(['v3-faq']);
    expect(untouched.preview.changedOnMainSinceFork).toEqual([
      expect.objectContaining({ pageId: 'v2-faq', change: 'deleted', onPromote: 'removed' }),
    ]);
    const edited = v3Pages.map((p) => (p.id === 'v3-faq' ? withHash({ ...p, contentHash: 'v3 answers' }) : p));
    const restore = analyze(main, edited, v3);
    expect(restore.plan.moves).toEqual([{ id: 'v3-faq', data: { parentId: 'guide' } }]);
    expect(restore.preview.changedOnMainSinceFork).toEqual([expect.objectContaining({ pageId: 'v2-faq', change: 'deleted', onPromote: 'restored' })]);
  });

  it("V3 then V2: V2 folds into V3's FAQ and keeps V3's newer edits", () => {
    const v3Edited = v3Pages.map((p) => (p.id === 'v3-faq' ? withHash({ ...p, contentHash: 'v3 answers' }) : p));
    const v3Landed = landed(main, v3Edited, v3Fork);
    expect(v3Landed).toEqual([{ id: 'v3-faq', lineage: ['v3-faq', 'v2-faq'] }]);
    const v2 = after(v2Fork, v3Landed);
    const mainAfterV3 = [...main, withHash({ ...at(v3Edited, 2), parentId: 'guide' })];
    const { plan, preview } = analyze(mainAfterV3, v2Pages, v2);
    expect(plan.moves).toEqual([]);
    expect(plan.consumed).toContainEqual({ copyId: 'v2-faq', mainId: 'v3-faq' });
    // V2 didn't touch the FAQ after V3 forked: V3's text on main stays.
    expect(plan.mainUpdates).toEqual([]);
    expect(preview.changedOnMainSinceFork).toEqual([expect.objectContaining({ pageId: 'v3-faq', change: 'modified', onPromote: 'kept' })]);
  });

  it('lists a page another version put on main as added and removed when this version deleted it, in either order', () => {
    // V2 then V3, where V3 deleted its copy of the FAQ.
    const v3 = after(v3Fork, landed(main, v2Pages, v2Fork));
    const mainAfterV2 = [...main, withHash({ ...at(v2Pages, 2), parentId: 'guide' })];
    const v3First = analyze(mainAfterV2, v3Pages.slice(0, 2), v3);
    expect(v3First.plan.deleteMainIds).toEqual(['v2-faq']);
    expect(v3First.preview.changedOnMainSinceFork).toEqual([expect.objectContaining({ pageId: 'v2-faq', change: 'added', onPromote: 'removed' })]);
    // V3 then V2, where V2 deleted its own FAQ.
    const v2 = after(v2Fork, landed(main, v3Pages, v3Fork));
    const mainAfterV3 = [...main, withHash({ ...at(v3Pages, 2), parentId: 'guide' })];
    const v2Second = analyze(mainAfterV3, v2Pages.slice(0, 2), v2);
    expect(v2Second.plan.deleteMainIds).toEqual(['v3-faq']);
    expect(v2Second.preview.changedOnMainSinceFork).toEqual([expect.objectContaining({ pageId: 'v3-faq', change: 'added', onPromote: 'removed' })]);
  });

  it("two versions made from V2: the second folds into the first one's FAQ", () => {
    const v3Landed = landed(main, v3Pages, v3Fork);
    const v4 = after(v4Fork, v3Landed);
    expect(v4.pages['v2-faq']).toMatchObject({ aka: ['v3-faq'], reachedMain: true });
    const mainAfterV3 = [...main, withHash({ ...at(v3Pages, 2), parentId: 'guide' })];
    const { plan } = analyze(mainAfterV3, v4Pages, v4);
    expect(plan.moves).toEqual([]);
    expect(plan.consumed).toContainEqual({ copyId: 'v4-faq', mainId: 'v3-faq' });
  });
});
