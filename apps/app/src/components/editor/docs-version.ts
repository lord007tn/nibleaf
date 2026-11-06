import { publishedVersionSlugs } from '@nibleaf/shared/site';
import type { Branch } from '@/hooks/api/types';

/**
 * The web-address prefix a branch gets on the published site, or `undefined` for
 * the default version (which lives at the site root). Uses the same slug rules as
 * publishing, applied in the same order (default first, then oldest first).
 */
export const publishedVersionSlugFor = (
  branches: readonly Pick<Branch, 'id' | 'name' | 'isDefault' | 'createdAt'>[] | undefined,
  branchId: string | null | undefined,
): string | undefined => {
  if (!branches || !branchId) return undefined;
  const branch = branches.find((item) => item.id === branchId);
  if (!branch || branch.isDefault) return undefined;
  const ordered = [...branches].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return publishedVersionSlugs(ordered).get(branchId);
};

export type DeepLinkBranchDecision = { kind: 'wait' } | { kind: 'done' } | { kind: 'switch'; branchId: string };

/**
 * A page opened from a `?page=` link (command palette, overview…) may belong to
 * another docs version than the one the editor shows. Once that page has loaded,
 * decide whether the editor must switch to the page's version so the page tree,
 * the version switcher and edits agree:
 *  - `wait`   the deep-linked page (or the version list) hasn't loaded yet;
 *  - `done`   nothing to do (no deep link, same version, or unknown version);
 *  - `switch` move the editor to `branchId`.
 */
export const deepLinkBranchDecision = (input: {
  deepLinkedPageId: string | null;
  page: { id: string; branchId?: string } | undefined;
  activeBranchId: string | null;
  branches: readonly Pick<Branch, 'id'>[] | undefined;
}): DeepLinkBranchDecision => {
  const { deepLinkedPageId, page, activeBranchId, branches } = input;
  if (!deepLinkedPageId) return { kind: 'done' };
  if (!page || page.id !== deepLinkedPageId) return { kind: 'wait' };
  if (!page.branchId || page.branchId === activeBranchId) return { kind: 'done' };
  if (!branches) return { kind: 'wait' };
  return branches.some((branch) => branch.id === page.branchId) ? { kind: 'switch', branchId: page.branchId } : { kind: 'done' };
};
