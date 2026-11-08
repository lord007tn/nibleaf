import type { SiteSnapshot } from '@nibleaf/shared/site';
import { canonicalHash } from './canonical-json';

/** Output-only digest: saves that change timestamps alone keep the review valid. */
export const reviewedSnapshotDigest = (snapshot: SiteSnapshot) =>
  canonicalHash({
    project: snapshot.project,
    openapi: snapshot.openapi,
    pages: [...snapshot.pages].sort((a, b) => a.id.localeCompare(b.id)).map(({ updatedAt: _updatedAt, ...page }) => page),
  });
