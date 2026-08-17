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

    const scopedIndex = await getCachedIndex('private-project', deploymentKey, 'en', [allowed], new Set(['allowed']));
    expect(await searchDocs(scopedIndex, 'classified')).toEqual([]);
  });
});
