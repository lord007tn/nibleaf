import { describe, expect, it } from 'vitest';
import { buildForkBaseline, diffMainSinceFork, type ForkPoint, forkPointOf, type MainPageRow, planPromote, type VersionPageRow } from './branch-fork';

const FORK = new Date('2026-11-01T10:00:00.000Z');
const BEFORE = new Date('2026-10-30T10:00:00.000Z');
const AFTER = new Date('2026-11-02T10:00:00.000Z');
const codes = new Map([
  ['en', 'en'],
  ['ar', 'ar'],
]);

const main = (id: string, overrides: Partial<MainPageRow> = {}): MainPageRow => ({
  id,
  parentId: null,
  kind: 'PAGE',
  title: id,
  path: id,
  languageId: 'en',
  createdAt: BEFORE,
  updatedAt: BEFORE,
  ...overrides,
});
const copy = (id: string, overrides: Partial<VersionPageRow> = {}): VersionPageRow => ({
  id,
  parentId: null,
  languageId: 'en',
  path: id.replace(/^v-/, ''),
  updatedAt: FORK,
  ...overrides,
});

/** A fork of `pages` where main page `x` is copied as `v-x`. */
const forkOf = (pages: MainPageRow[]): ForkPoint =>
  forkPointOf({ createdAt: FORK, forkedAt: FORK, forkBaseline: buildForkBaseline(pages, (id) => `v-${id}`) as never });
const legacy: ForkPoint = forkPointOf({ createdAt: FORK, forkedAt: null, forkBaseline: null });

describe('diffMainSinceFork', () => {
  const atFork = [main('billing'), main('guide', { kind: 'GROUP' }), main('intro', { parentId: 'guide', path: 'guide/intro' })];

  it('reports nothing when main is untouched', () => {
    expect(diffMainSinceFork(atFork, forkOf(atFork), codes)).toEqual({ changedOnMainSinceFork: [], baselineComplete: true });
  });

  it('lists modified, added and deleted pages sorted by path', () => {
    const fork = forkOf(atFork);
    const now = [
      main('billing', { title: 'Billing fixed', updatedAt: AFTER }),
      main('guide', { kind: 'GROUP' }),
      main('refunds', { languageId: 'ar', createdAt: AFTER, updatedAt: AFTER }),
    ];
    expect(diffMainSinceFork(now, fork, codes)).toEqual({
      baselineComplete: true,
      changedOnMainSinceFork: [
        { pageId: 'billing', title: 'Billing fixed', path: 'billing', languageCode: 'en', change: 'modified', updatedAt: AFTER.toISOString() },
        { pageId: 'intro', title: 'intro', path: 'guide/intro', languageCode: 'en', change: 'deleted', updatedAt: BEFORE.toISOString() },
        { pageId: 'refunds', title: 'refunds', path: 'refunds', languageCode: 'ar', change: 'added', updatedAt: AFTER.toISOString() },
      ],
    });
  });

  it('ignores a group whose title and path are unchanged, but lists a renamed one', () => {
    const fork = forkOf(atFork);
    const reordered = atFork.map((p) => (p.id === 'guide' ? { ...p, updatedAt: AFTER } : p));
    expect(diffMainSinceFork(reordered, fork, codes).changedOnMainSinceFork).toEqual([]);
    const renamed = atFork.map((p) => (p.id === 'guide' ? { ...p, title: 'Guides', updatedAt: AFTER } : p));
    expect(diffMainSinceFork(renamed, fork, codes).changedOnMainSinceFork).toMatchObject([{ pageId: 'guide', change: 'modified' }]);
  });

  it('falls back to the version createdAt without a baseline and cannot see deletions', () => {
    const now = [main('billing', { updatedAt: AFTER }), main('refunds', { createdAt: AFTER, updatedAt: AFTER }), main('old')];
    expect(diffMainSinceFork(now, legacy, codes)).toEqual({
      baselineComplete: false,
      changedOnMainSinceFork: [
        expect.objectContaining({ pageId: 'billing', change: 'modified' }),
        expect.objectContaining({ pageId: 'refunds', change: 'added' }),
      ],
    });
  });

  it('treats a malformed baseline as legacy rather than trusting it', () => {
    const fork = forkPointOf({ createdAt: FORK, forkedAt: FORK, forkBaseline: { version: 1, pages: { a: { copyId: 1 } } } });
    expect(fork.baseline).toBeNull();
    expect(fork.forkedAt).toEqual(FORK);
  });
});

describe('planPromote', () => {
  it('replaces every forked main page when nothing changed', () => {
    const atFork = [main('billing'), main('intro')];
    expect(planPromote(atFork, [copy('v-billing'), copy('v-intro')], forkOf(atFork))).toEqual({
      deleteMainIds: ['billing', 'intro'],
      dropVersionIds: [],
      reparent: [],
    });
  });

  it('keeps pages added on main and re-homes them under the version copy of their parent', () => {
    const atFork = [main('guide', { kind: 'GROUP' }), main('billing')];
    const now = [...atFork, main('refunds', { parentId: 'guide', path: 'guide/refunds', createdAt: AFTER }), main('faq', { createdAt: AFTER })];
    const plan = planPromote(now, [copy('v-guide'), copy('v-billing')], forkOf(atFork));
    expect(plan.deleteMainIds).toEqual(['guide', 'billing']);
    expect(plan.reparent).toEqual([{ id: 'refunds', parentId: 'v-guide' }]);
  });

  it('moves a kept page up when the version deleted its parent', () => {
    const atFork = [main('root', { kind: 'GROUP' }), main('guide', { kind: 'GROUP', parentId: 'root' })];
    const now = [...atFork, main('refunds', { parentId: 'guide', createdAt: AFTER })];
    // The version kept "root" but deleted "guide".
    expect(planPromote(now, [copy('v-root')], forkOf(atFork)).reparent).toEqual([{ id: 'refunds', parentId: 'v-root' }]);
    // The version deleted both: top level.
    expect(planPromote(now, [], forkOf(atFork)).reparent).toEqual([{ id: 'refunds', parentId: null }]);
  });

  it('keeps a page deleted on main deleted unless the version edited it', () => {
    const atFork = [main('old'), main('edited'), main('stays')];
    const now = [main('stays')];
    const version = [copy('v-old'), copy('v-edited', { updatedAt: AFTER }), copy('v-stays')];
    expect(planPromote(now, version, forkOf(atFork))).toEqual({ deleteMainIds: ['stays'], dropVersionIds: ['v-old'], reparent: [] });
  });

  it('keeps an unedited deleted group when a kept version page still lives under it', () => {
    const atFork = [main('guide', { kind: 'GROUP' }), main('intro', { parentId: 'guide' })];
    const version = [copy('v-guide'), copy('v-intro', { parentId: 'v-guide' }), copy('v-new', { parentId: 'v-guide', updatedAt: AFTER })];
    // Main deleted the whole group; the version added a page inside it.
    expect(planPromote([], version, forkOf(atFork)).dropVersionIds).toEqual(['v-intro']);
  });

  it('keeps pages created on main after a legacy fork and replaces the rest', () => {
    const now = [main('guide', { kind: 'GROUP' }), main('refunds', { parentId: 'guide', createdAt: AFTER })];
    const plan = planPromote(now, [copy('v-guide', { path: 'guide' })], legacy);
    expect(plan).toEqual({ deleteMainIds: ['guide'], dropVersionIds: [], reparent: [{ id: 'refunds', parentId: 'v-guide' }] });
  });
});
