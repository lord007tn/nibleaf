import { prisma } from '@nibleaf/database';
import type { PublishedAssetReferences } from '@nibleaf/shared/asset-references';
import type { SiteSnapshot } from '@nibleaf/shared/site';
import { storedImageDimensions } from '@nibleaf/storage';

/** Metadata for new uploads is already recorded. For legacy assets, probe at
 * most 32 headers sequentially per publish (8 MiB, 5 s each). No public request
 * reads storage or fetches an external URL. Successful probes persist; failed
 * or unsupported headers remain unsized. */
export const addPublishedImageDimensions = async (snapshot: SiteSnapshot, references: PublishedAssetReferences): Promise<void> => {
  const projectId = snapshot.project.id;
  const pages = new Map(snapshot.pages.map((page) => [page.id, page]));
  let probes = 0;
  for (let offset = 0; offset < references.entries.length; offset += 500) {
    const entries = references.entries.slice(offset, offset + 500);
    const assets = await prisma.asset.findMany({
      where: { projectId, key: { in: entries.map(([key]) => key) }, contentType: { startsWith: 'image/' } },
      select: { key: true, url: true, width: true, height: true },
    });
    const byKey = new Map(assets.map((asset) => [asset.key, asset]));
    for (const [key, positions] of entries) {
      const asset = byKey.get(key);
      if (!asset) continue;
      let size = asset.width && asset.height ? { width: asset.width, height: asset.height } : null;
      if (!size && probes < 32) {
        probes++;
        size = await storedImageDimensions(key);
        if (size) await prisma.asset.updateMany({ where: { key, projectId, width: asset.width, height: asset.height }, data: size });
      }
      if (!size) continue;
      for (const position of positions) {
        const page = pages.get(references.pageIds[position] ?? '');
        if (!page) continue;
        page.imageDimensions ??= {};
        page.imageDimensions[`/api/public/assets/${key}`] = size;
        page.imageDimensions[asset.url] = size;
      }
    }
  }
};
