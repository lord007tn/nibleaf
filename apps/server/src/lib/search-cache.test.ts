import { searchDocs } from '@nibleaf/search';
import type { SnapshotPage } from '@nibleaf/shared/site';
import { describe, expect, it, vi } from 'vitest';
import { estimateIndexBytes, getCachedIndex } from './search-cache';

// The real index builder, with a switch to make the next builds fail.
const builds = vi.hoisted(() => ({ failNext: 0, calls: 0 }));
vi.mock('@nibleaf/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nibleaf/search')>();
  return {
    ...actual,
    createDocIndex: (...args: Parameters<typeof actual.createDocIndex>) => {
      builds.calls += 1;
      if (builds.failNext > 0) {
        builds.failNext -= 1;
        return Promise.reject(new Error('index build failed'));
      }
      return actual.createDocIndex(...args);
    },
  };
});

const page = (id: string, content: string): SnapshotPage =>
  ({
    id,
    parentId: null,
    versionId: 'branch-main',
    languageCode: 'en',
    kind: 'PAGE',
    title: id,
    slug: id,
    path: id,
    icon: null,
    description: null,
    content,
    config: null,
    translationKey: null,
    position: 0,
    hidden: false,
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
  }) as SnapshotPage;

describe('authorization-scoped search indexes', () => {
  it('does not reuse a full-access warm cache for a page-scoped reader', async () => {
    const allowed = page('allowed', 'Public onboarding material.');
    const restricted = page('restricted', 'Classified acquisition details.');
    const deploymentKey = 'deployment-private:main';

    const fullIndex = await getCachedIndex('private-project', deploymentKey, 'en', [allowed, restricted], null);
    expect((await searchDocs(fullIndex, 'classified')).map((hit) => hit.id)).toContain('restricted');

    const scopedIndex = await getCachedIndex('private-project', deploymentKey, 'en', [allowed, restricted], new Set(['allowed']));
    expect(await searchDocs(scopedIndex, 'classified')).toEqual([]);
  });

  it('shares concurrent cold builds and changes indexes on a new deployment', async () => {
    const pages = [page('invoice', 'Download your invoice.')];
    const [first, second] = await Promise.all([
      getCachedIndex('single-flight', 'deploy-1:main', 'en', pages, null),
      getCachedIndex('single-flight', 'deploy-1:main', 'en', pages, null),
    ]);
    expect(second).toBe(first);
    const next = await getCachedIndex('single-flight', 'deploy-2:main', 'en', [page('commission', 'Agent commission.')], null);
    expect(next).not.toBe(first);
    expect(await searchDocs(next, 'invoice', { relevance: 'reader' })).toEqual([]);
    expect((await searchDocs(next, 'commission', { relevance: 'reader' }))[0]?.id).toBe('commission');
  });

  it('drops a rejected build so the next request retries instead of reusing the failure', async () => {
    const pages = [page('invoice', 'Download your invoice.')];
    builds.failNext = 1;
    builds.calls = 0;
    // Concurrent callers share the one failing build and all see its error.
    const failed = await Promise.allSettled([
      getCachedIndex('retry', 'deploy-1:main', 'en', pages, null),
      getCachedIndex('retry', 'deploy-1:main', 'en', pages, null),
    ]);
    expect(failed.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(builds.calls).toBe(1);

    const retried = await getCachedIndex('retry', 'deploy-1:main', 'en', pages, null);
    expect(builds.calls).toBe(2);
    expect((await searchDocs(retried, 'invoice', { relevance: 'reader' }))[0]?.id).toBe('invoice');
    // The successful rebuild is cached again.
    expect(await getCachedIndex('retry', 'deploy-1:main', 'en', pages, null)).toBe(retried);
    expect(builds.calls).toBe(2);
  });

  it('bounds cached indexes by estimated memory, evicting the coldest first', async () => {
    // About 1.3 M characters: an estimated 13 MB index, so 20 fill the 256 MB budget.
    const large = [page('large', 'Reservation guide. '.repeat(70_000))];
    builds.calls = 0;
    const first = await getCachedIndex('budget-0', 'deploy:main', 'en', large, null);
    for (let site = 1; site <= 20; site += 1) await getCachedIndex(`budget-${site}`, 'deploy:main', 'en', large, null);
    expect(builds.calls).toBe(21);
    // The first site was the coldest, so it was evicted and builds again.
    expect(await getCachedIndex('budget-0', 'deploy:main', 'en', large, null)).not.toBe(first);
    expect(builds.calls).toBe(22);
    // The most recent one is still cached.
    await getCachedIndex('budget-20', 'deploy:main', 'en', large, null);
    expect(builds.calls).toBe(22);
  }, 60_000);

  it('estimates index memory from the indexed text plus a fixed overhead', () => {
    const doc = { id: 'a', title: 'ab', path: 'a', description: 'cd', headings: 'ef', content: 'x'.repeat(1000) };
    expect(estimateIndexBytes([])).toBe(64 * 1024);
    expect(estimateIndexBytes([doc])).toBe(64 * 1024 + 10 * 1006);
  });
});
