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

/** What the pending-changes answer must look like right after a publish went live:
 *  the site has a published version and what was waiting is now live. A refetch
 *  replaces this projection with the server's answer moments later. */
export const projectPublishedChanges = <T extends PendingChangesLike>(old: T | undefined, version: number): T | undefined =>
  old ? { ...old, hasBaseline: true, lastVersion: Math.max(old.lastVersion ?? 0, version), changes: [] as unknown as T['changes'] } : old;

/**
 * Called with every fresh read of the deployments list. Once a publish reaches
 * READY, the cached "unpublished changes" answer still describes the previous
 * published version (it is only refetched when something invalidates it), so
 * badges, the first-publish banner and the address-follows-title rule would keep
 * treating live pages as never published. Project the receipt at once, then
 * refetch the real answer (cancelling any older request still in flight).
 */
export const syncPublishReceipt = (
  queryClient: QueryClient,
  projectId: string,
  previous: readonly DeploymentReceipt[] | undefined,
  next: readonly DeploymentReceipt[],
): boolean => {
  const ready = newlyReadyDeployment(previous, next);
  if (!ready) return false;
  queryClient.setQueryData<PendingChangesLike>(queryKeys.deployments.changes(projectId), (old) => projectPublishedChanges(old, ready.version));
  void queryClient.invalidateQueries({ queryKey: queryKeys.deployments.changes(projectId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.deployments.latest(projectId) });
  return true;
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
