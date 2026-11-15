import type { PublishedAssetReferences } from '@nibleaf/shared/asset-references';
import type { SiteSnapshot } from '@nibleaf/shared/site';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), updateMany: vi.fn(), dimensions: vi.fn() }));
vi.mock('@nibleaf/database', () => ({ prisma: { asset: { findMany: mocks.findMany, updateMany: mocks.updateMany } } }));
vi.mock('@nibleaf/storage', () => ({ storedImageDimensions: mocks.dimensions }));

import { addPublishedImageDimensions } from './publish-image-dimensions';

const key = 'projects/p/assets/a.png';
const fixture = () => ({
  snapshot: {
    project: { id: 'p' },
    pages: [
      { id: 'one', content: `![](/api/public/assets/${key})` },
      { id: 'two', content: '' },
    ],
  } as SiteSnapshot,
  references: { pageIds: ['one', 'two'], entries: [[key, [0], []]] } as unknown as PublishedAssetReferences,
});

describe('publish image dimensions', () => {
  beforeEach(() => vi.resetAllMocks());

  it('copies captured dimensions only to referencing pages, scoped to project and exact keys', async () => {
    const { snapshot, references } = fixture();
    mocks.findMany.mockResolvedValue([{ key, url: `/api/public/assets/${key}`, width: 950, height: 600 }]);
    await addPublishedImageDimensions(snapshot, references);
    expect(snapshot.pages[0]?.imageDimensions).toEqual({ [`/api/public/assets/${key}`]: { width: 950, height: 600 } });
    expect(snapshot.pages[1]?.imageDimensions).toBeUndefined();
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'p', key: { in: [key] }, contentType: { startsWith: 'image/' } } }),
    );
    expect(mocks.dimensions).not.toHaveBeenCalled();
  });

  it('backfills legacy metadata from storage and leaves failed headers unsized', async () => {
    const { snapshot, references } = fixture();
    mocks.findMany.mockResolvedValue([{ key, url: `/api/public/assets/${key}`, width: null, height: null }]);
    mocks.dimensions.mockResolvedValueOnce({ width: 1313, height: 900 }).mockResolvedValueOnce(null);
    await addPublishedImageDimensions(snapshot, references);
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { key, projectId: 'p', width: null, height: null }, data: { width: 1313, height: 900 } });
    const failed = fixture();
    await addPublishedImageDimensions(failed.snapshot, failed.references);
    expect(failed.snapshot.pages[0]?.imageDimensions).toBeUndefined();
  });

  it('limits legacy probes to 32 and ignores references without an owned asset row', async () => {
    const { snapshot, references } = fixture();
    references.entries = Array.from({ length: 40 }, (_, n) => [`projects/p/assets/${n}.png`, [0], []]);
    mocks.findMany.mockResolvedValue(
      references.entries.slice(0, 39).map(([key]) => ({ key, url: `/api/public/assets/${key}`, width: null, height: null })),
    );
    mocks.dimensions.mockResolvedValue(null);
    await addPublishedImageDimensions(snapshot, references);
    expect(mocks.dimensions).toHaveBeenCalledTimes(32);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
