import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './query-keys';
import type { Deployment } from './types';

type DeploymentReceipt = Pick<Deployment, 'id' | 'status' | 'version'>;

/** The parts of the "what the next publish changes" answer that published-state UI reads. */
interface PendingChangesLike {
  hasBaseline: boolean;
  lastVersion: number | null;
  changes: ReadonlyArray<{ id: string; status: string }>;
}

export const isDeploymentInFlight = (status?: string): boolean => status === 'PENDING' || status === 'BUILDING';

/** True while any publish of the site is queued or being prepared. */
const hasPublishInFlight = (deployments: readonly Pick<Deployment, 'status'>[] | undefined): boolean =>
  Boolean(deployments?.some((deployment) => isDeploymentInFlight(deployment.status)));

/**
 * The deployment that became READY between two reads of the deployments list:
 * one that was in flight before, or that was not listed yet (a fast worker can
 * finish before the first poll). Nothing on the very first read, which only
 * describes the past.
 */
export const newlyReadyDeployment = <T extends DeploymentReceipt>(
  previous: readonly DeploymentReceipt[] | undefined,
  next: readonly T[],
): T | null => {
  if (!previous) return null;
  const before = new Map(previous.map((deployment) => [deployment.id, deployment.status]));
  return next.find((deployment) => deployment.status === 'READY' && before.get(deployment.id) !== 'READY') ?? null;
};

/**
 * Called with every fresh read of the deployments list. Once a publish reaches
 * READY, the cached "unpublished changes" answer describes the previous published
 * version, so badges, the first-publish banner and the address-follows-title rule
 * would keep treating live pages as never published.
 *
 * READY only proves that the snapshot the worker captured is live, not that the
 * current draft equals it: an edit saved after the capture (here or by a
 * colleague) is still unpublished. So the old answer is dropped rather than
 * guessed at — until the server's new answer arrives, publish state is unknown:
 * no "Published" claim, no change count, and addresses stop following titles
 * (see {@link addressMayFollowTitle}). Active screens refetch at once (cancelling
 * any older request); if that fails, the state stays unknown instead of a false
 * "Published".
 */
export const syncPublishReceipt = (
  queryClient: QueryClient,
  projectId: string,
  previous: readonly DeploymentReceipt[] | undefined,
  next: readonly DeploymentReceipt[],
): boolean => {
  const ready = newlyReadyDeployment(previous, next);
  if (!ready) return false;
  void queryClient.resetQueries({ queryKey: queryKeys.deployments.changes(projectId), exact: true });
  void queryClient.invalidateQueries({ queryKey: queryKeys.deployments.latest(projectId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all(), exact: true });
  return true;
};

/**
 * The open page's publish state in words, or null while unknown (the
 * pending-changes answer hasn't arrived, or was dropped when a publish went live
 * and couldn't be re-read). A page is unpublished before the site's first publish
 * or while the check lists it as changed.
 */
export const pagePublishState = (pageId: string, pending: PendingChangesLike | undefined): 'unpublished' | 'published' | null => {
  if (!pending) return null;
  return !pending.hasBaseline || pending.changes.some((change) => change.id === pageId) ? 'unpublished' : 'published';
};

/** True only when we know the page has never been published: the site was never
 *  published, or the pending-changes check lists the page as new. */
export const pageNeverPublished = (pageId: string, pending: PendingChangesLike | undefined): boolean =>
  Boolean(pending && (!pending.hasBaseline || pending.changes.some((change) => change.id === pageId && change.status === 'added')));

/**
 * Whether a page's web address may still follow its title. Only for a page known
 * to be unpublished, and never while a publish is running: that publish may be
 * about to make the page live under its current address.
 */
export const addressMayFollowTitle = (
  pageId: string,
  pending: PendingChangesLike | undefined,
  deployments: readonly Pick<Deployment, 'status'>[] | undefined,
): boolean => !hasPublishInFlight(deployments) && pageNeverPublished(pageId, pending);
