import { AssetReferenceBudget, buildAssetReferencesSync, legacyReaderReferencesAsset, pageReferencesAsset } from '@nibleaf/shared/asset-references';
import type { SiteSnapshot, SnapshotPage } from '@nibleaf/shared/site';
import { describe, expect, it, vi } from 'vitest';
import { AssetReferenceAccess } from './asset-reference-access';

const key = (leaf: string) => `projects/project-1/assets/${leaf}`;
const page = (id: string, content = key('image.png'), parentId: string | null = null): SnapshotPage => ({
  id,
  parentId,
  content,
  title: id,
  slug: id,
  path: id,
  kind: 'PAGE',
  versionId: 'v',
  languageCode: 'en',
  updatedAt: '',
  icon: null,
  description: null,
  config: null,
  translationKey: null,
  position: 0,
  hidden: false,
});
const snapshot = (pages = [page('child')], projectId = 'project-1'): SiteSnapshot => ({
  project: { id: projectId, name: 'Docs', slug: 'docs', config: {}, icon: null, description: null, languages: [], versions: [] },
  pages,
  generatedAt: '',
});
const indexed = (source: SiteSnapshot) => buildAssetReferencesSync(source, () => undefined);
const options = { schedule: async (work: () => ReturnType<typeof indexed>) => work(), buildCapacity: 256 * 1024 * 1024, buildPerSecond: 0 };
const input = (source: SiteSnapshot, id: string, asset = key('image.png')) => ({
  projectId: source.project.id,
  deploymentId: id,
  key: asset,
  grants: new Set(['child']),
  chromeStamp: null,
  legacy: source,
  index: null,
  chrome: () => source.project,
});

describe('persisted asset-reference lookups', () => {
  it('checks a small posting list before thousands of unrelated grants and leaves chrome budget available', async () => {
    const pages = Array.from({ length: 10_000 }, (_, i) => page(`long-published-page-id-${i.toString().padStart(8, '0')}`, key(`asset-${i}.png`)));
    const source = snapshot(pages);
    const index = indexed(source);
    const grants = new Set(pages.slice(0, 9999).map((item) => item.id));
    const budget = new AssetReferenceBudget(10_000);
    expect(pageReferencesAsset(index, key('asset-9998.png'), grants, budget)).toBe(true);
    expect(pageReferencesAsset(index, key('asset-9999.png'), grants, budget)).toBe(false);
    expect(budget.remaining).toBeGreaterThan(0);
  });

  it('serves 32 grants in a 50000-page deployment without reading any page body on requests', async () => {
    const pages = Array.from({ length: 50_000 }, (_, position) => page(`page-${position}`, key(`image-${position}.png`), position ? 'page-0' : null));
    const source = snapshot(pages);
    const index = indexed(source);
    for (const item of pages)
      Object.defineProperty(item, 'content', {
        get: () => {
          throw new Error('Request read a page body');
        },
      });
    const runtime = new AssetReferenceAccess(options);
    const grants = new Set(Array.from({ length: 32 }, (_, i) => `page-${49_999 - i}`));
    for (let i = 0; i < 32; i++) {
      await expect(runtime.allows({ ...input(source, 'large', key(`image-${49_999 - i}.png`)), index, legacy: undefined, grants })).resolves.toBe(
        true,
      );
    }
    await expect(runtime.allows({ ...input(source, 'large', key('image-10.png')), index, legacy: undefined, grants })).resolves.toBe(false);
  }, 20_000);

  it('cannot turn varied keys into page scans', async () => {
    const source = snapshot();
    const index = indexed(source);
    Object.defineProperty(source.pages[0], 'content', {
      get: () => {
        throw new Error('Request body scan');
      },
    });
    const runtime = new AssetReferenceAccess(options);
    for (let i = 0; i < 150; i++)
      await expect(runtime.allows({ ...input(source, 'fixed', key(`missing-${i}.png`)), index, legacy: undefined })).resolves.toBe(false);
    await expect(runtime.allows({ ...input(source, 'fixed'), index, legacy: undefined })).resolves.toBe(true);
  });

  it('charges every lookup step and preserves navigation without ancestor body access', () => {
    const parent = { ...page('parent', key('private.png')), icon: key('nav.png') };
    const index = indexed(snapshot([parent, page('child', key('child.png'), 'parent')]));
    expect(pageReferencesAsset(index, key('nav.png'), new Set(['child']), new AssetReferenceBudget(10_000))).toBe(true);
    expect(pageReferencesAsset(index, key('private.png'), new Set(['child']), new AssetReferenceBudget(10_000))).toBe(false);
    expect(() => pageReferencesAsset(index, key('nav.png'), new Set(['child']), new AssetReferenceBudget(0))).toThrow();
  });

  it('pins unslugified extensions and sentence-ending periods', () => {
    const index = indexed(snapshot([page('child', `${key('a.png@2x')} ${key('sentence.png')}.`)]));
    const lookup = (asset: string) => pageReferencesAsset(index, key(asset), new Set(['child']), new AssetReferenceBudget(10_000));
    expect(lookup('a.png@2x')).toBe(true);
    expect(lookup('a.png')).toBe(false);
    expect(lookup('sentence.png')).toBe(false);
    expect(lookup('sentence.png.')).toBe(true);
  });

  it('counts the legacy rebuild cooldown from eviction, then uses a budgeted fallback', async () => {
    let now = 0;
    const source = snapshot();
    const size = indexed(source).weight;
    const schedule = vi.fn(async (work: () => ReturnType<typeof indexed>) => work());
    const runtime = new AssetReferenceAccess({ ...options, clock: () => now, cacheBytes: size + 1, projectBytes: size * 4, schedule });
    await expect(runtime.allows(input(source, 'old'))).resolves.toBe(true);
    now = 10 * 60_000;
    await expect(runtime.allows(input(source, 'other'))).resolves.toBe(true);
    expect(schedule).toHaveBeenCalledTimes(2);
    now++;
    await expect(runtime.allows(input(source, 'old'))).resolves.toBe(true);
    expect(schedule).toHaveBeenCalledTimes(2);
    now += 60_001;
    await expect(runtime.allows(input(source, 'old'))).resolves.toBe(true);
    expect(schedule).toHaveBeenCalledTimes(3);
  });

  it('re-admits compact persisted indexes immediately, with a quota for each project', async () => {
    const a = indexed(snapshot());
    const b = indexed(snapshot([page('child')], 'project-2'));
    const runtime = new AssetReferenceAccess({ ...options, cacheBytes: a.weight * 10, projectBytes: Math.max(a.weight, b.weight) + 1 });
    const loadA = vi.fn(async () => a);
    const loadB = vi.fn(async () => b);
    await runtime.load('project-1', 'one', a.weight, loadA);
    await runtime.load('project-1', 'two', a.weight, loadA);
    await runtime.load('project-2', 'three', b.weight, loadB);
    await runtime.load('project-1', 'one', a.weight, loadA);
    await runtime.load('project-2', 'three', b.weight, loadB);
    expect(loadA).toHaveBeenCalledTimes(3);
    expect(loadB).toHaveBeenCalledTimes(1);
  });

  it('cycles beyond the real pool capacity without rebuilding stored indexes or denying valid readers', async () => {
    const source = snapshot();
    const index = indexed(source);
    const runtime = new AssetReferenceAccess({ ...options, cacheBytes: index.weight * 2, projectBytes: index.weight * 2 });
    const loads = vi.fn(async () => index);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < 8; i++) {
        const loaded = await runtime.load('project-1', `deployment-${i}`, index.weight, loads);
        await expect(runtime.allows({ ...input(source, `deployment-${i}`), index: loaded, legacy: undefined })).resolves.toBe(true);
      }
    }
    expect(loads).toHaveBeenCalledTimes(16);
    const tooSmall = new AssetReferenceAccess({ ...options, cacheBytes: index.weight - 1, projectBytes: index.weight * 2 });
    const loaded = await tooSmall.load('project-1', 'over-whole-budget', index.weight, loads);
    await expect(tooSmall.allows({ ...input(source, 'over-whole-budget'), index: loaded, legacy: undefined })).resolves.toBe(true);
  });

  it('caps builds globally across projects rather than resetting the budget for each deployment', async () => {
    const a = snapshot();
    let cost = 0;
    buildAssetReferencesSync(a, (work) => {
      cost += work;
    });
    const runtime = new AssetReferenceAccess({ ...options, buildCapacity: cost * 2, buildPerSecond: 0 });
    await expect(runtime.allows(input(a, 'one'))).resolves.toBe(true);
    await expect(runtime.allows(input(snapshot(undefined, 'project-2'), 'two'))).resolves.toBe(true);
    await expect(runtime.allows(input(snapshot(undefined, 'project-3'), 'three'))).resolves.toBe(false);
  });

  it('collects legacy grants and ancestors in level-order passes and charges scanned characters', () => {
    const pages = Array.from({ length: 50_000 }, (_, i) => page(`page-${i}`, 'Body', i ? 'page-0' : null));
    pages[0] = { ...page('page-0'), icon: key('root-nav.png') };
    const source = snapshot(pages);
    const grants = new Set(Array.from({ length: 32 }, (_, i) => `page-${49_999 - i}`));
    expect(legacyReaderReferencesAsset(source, key('root-nav.png'), grants, new AssetReferenceBudget(4_500_000), () => undefined)).toBe(true);
    const large = snapshot([page('child', 'x'.repeat(10_000))]);
    expect(() =>
      legacyReaderReferencesAsset(large, key('missing.png'), new Set(['child']), new AssetReferenceBudget(500), () => undefined),
    ).toThrow();
  });
});
