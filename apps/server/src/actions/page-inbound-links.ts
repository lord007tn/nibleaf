import { findInboundPageLinks } from '@nibleaf/shared/publish-checks';
import { notFound } from '@/errors';
import { getCurrentSnapshot } from './deployments';

/** Read-only advisory: use the publish preflight's exact draft route graph,
 * including interpolated content and generated slug redirects in config.
 * There are no per-page queries. Trashed pages are absent from this snapshot. */
export const getPageInboundLinks = async (projectId: string, id: string) => {
  const snapshot = await getCurrentSnapshot(projectId);
  if (!snapshot.pages.some((page) => page.id === id)) throw notFound('page', { id });
  return findInboundPageLinks(snapshot, id);
};
