import type { QdrantScoredPoint } from '@nibleaf/qdrant';
import type { SearchScope } from '@nibleaf/search';
import { describe, expect, it } from 'vitest';
import { chunkFromPoint, filterForSearchScope } from './runtime';

const scope = (projectId = 'tenant-a', pages: string[] | null = ['page-a']): SearchScope => ({
  projectId,
  deploymentId: 'deployment-a',
  versionSlug: 'main',
  language: 'ar',
  visibility: 'private',
  allowedPageIds: pages === null ? null : new Set(pages),
});

const point = (overrides: Record<string, unknown> = {}): QdrantScoredPoint => ({
  id: 'chunk-a',
  score: 0.8,
  payload: {
    project_id: 'tenant-a',
    deployment_id: 'deployment-a',
    version_slug: 'main',
    language: 'ar',
    visibility: 'private',
    visible: true,
    page_id: 'page-a',
    ordinal: 0,
    title: 'خاص',
    path: 'private',
    description: '',
    heading: '',
    heading_path: [],
    content: 'محتوى مصرح',
    content_hash: 'hash',
    direction: 'rtl',
    ...overrides,
  },
});

describe('server-derived Qdrant scope', () => {
  it('requires tenant, deployment, version, language, visibility, visible, and page grants', () => {
    const filter = filterForSearchScope(scope());
    expect(filter?.must).toEqual(
      expect.arrayContaining([
        { key: 'project_id', match: { value: 'tenant-a' } },
        { key: 'deployment_id', match: { value: 'deployment-a' } },
        { key: 'version_slug', match: { value: 'main' } },
        { key: 'language', match: { value: 'ar' } },
        { key: 'visibility', match: { value: 'private' } },
        { key: 'visible', match: { value: true } },
        { key: 'page_id', match: { any: ['page-a'] } },
      ]),
    );
  });

  it('short-circuits a reader with no effective page grant', () => {
    expect(filterForSearchScope(scope('tenant-a', []))).toBeNull();
  });

  it.each([
    ['another tenant', { project_id: 'tenant-b' }],
    ['another deployment', { deployment_id: 'deployment-b' }],
    ['another language', { language: 'en' }],
    ['public/private mismatch', { visibility: 'public' }],
    ['hidden content', { visible: false }],
    ['unauthorized page', { page_id: 'page-b' }],
  ])('rejects %s payloads after retrieval', (_label, overrides) => {
    expect(chunkFromPoint(point(overrides), scope())).toBeNull();
  });

  it('returns only the authorized chunk and preserves RTL direction', () => {
    expect(chunkFromPoint(point(), scope())).toMatchObject({ chunk: { pageId: 'page-a', direction: 'rtl' }, score: 0.8 });
  });
});
