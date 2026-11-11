import { searchDocs } from '@nibleaf/search';
import type { SnapshotPage } from '@nibleaf/shared/site';
import { describe, expect, it } from 'vitest';
import { getCachedIndex } from './search-cache';

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
});
