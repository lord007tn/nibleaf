import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './query-keys';
import type { Deployment, Project } from './types';

type DeploymentReceipt = Pick<Deployment, 'id' | 'status' | 'version'>;

/** The parts of the "what the next publish changes" answer that published-state UI reads. */
interface PendingChangesLike {
  hasBaseline: boolean;
  lastVersion: number | null;
  changes: ReadonlyArray<{ id: string; status: string }>;
}

/** The live-only deployments list (publishes that went live, newest first). Kept
 *  here, not in ./query-keys, which ships with published docs: dashboard-only. */
export const liveDeploymentsKey = (projectId: string) => [...queryKeys.deployments.all(projectId), 'live'] as const;

/** The Publishes page's reads (history list and each version's detail), dashboard-only too. */
export const publishHistoryKey = (projectId: string) => [...queryKeys.deployments.all(projectId), 'history'] as const;

type LiveCandidate = Pick<Deployment, 'id' | 'status' | 'version'>;

/** Every READY row of the polled list (newest 50 attempts) and the live-only list, newest first, once each. */
const liveRows = <T extends LiveCandidate>(attempts: readonly T[] | undefined, live: readonly T[] | undefined): T[] => {
  const byId = new Map<string, T>();
  for (const row of [...(attempts ?? []), ...(live ?? [])]) if (row.status === 'READY' && !byId.has(row.id)) byId.set(row.id, row);
  return [...byId.values()].sort((left, right) => right.version - left.version);
};

/** What's live now: the newest READY publish in either list. The polled list sees a
 *  just-finished publish first; the live-only list still has the live version
 *  after more than 50 failed attempts. */
export const newestLiveDeployment = <T extends LiveCandidate>(attempts: readonly T[] | undefined, live: readonly T[] | undefined): T | undefined =>
  liveRows(attempts, live)[0];

/** The version a rollback from `current` returns to: the newest READY publish older than it. */
export const rollbackTarget = <T extends LiveCandidate>(
  attempts: readonly T[] | undefined,
  live: readonly T[] | undefined,
  current: LiveCandidate | undefined,
): T | undefined => liveRows(attempts, live).find((row) => row.id !== current?.id && (!current || row.version < current.version));

export const isDeploymentInFlight = (status?: string): boolean => status === 'PENDING' || status === 'BUILDING';

type AttemptState = { status: string; completedAt: string | null };

/** A failed attempt BullMQ will retry: the worker records FAILED with no completion
 *  time while a retry remains (the reaper completes one left that way too long). */
export const isPublishRetrying = (attempt: AttemptState | undefined): boolean => attempt?.status === 'FAILED' && attempt.completedAt === null;

/** Queued, building, or failed with an automatic retry still to come. */
export const isPublishInProgress = (attempt: AttemptState | undefined): boolean =>
  isDeploymentInFlight(attempt?.status) || isPublishRetrying(attempt);

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
  if (!ready) {
    // The first read describes the past, but it can still contradict the site's
    // publish facts: a publish (the starter's, a colleague's) went live between
    // reading the site and reading this list. Re-read the site, or "Times
    // published" stays 0 — nothing polls once every attempt has settled.
    if (!previous && next.some((deployment) => deployment.status === 'READY')) {
      const detailKey = queryKeys.projects.detail(projectId);
      if (queryClient.getQueryData<Project>(detailKey)?.readyPublishes === 0) {
        void queryClient.invalidateQueries({ queryKey: detailKey, exact: true });
      }
    }
    return false;
  }
  void queryClient.resetQueries({ queryKey: queryKeys.deployments.changes(projectId), exact: true });
  void queryClient.invalidateQueries({ queryKey: queryKeys.deployments.latest(projectId) });
  void queryClient.invalidateQueries({ queryKey: liveDeploymentsKey(projectId), exact: true });
  // A newer live version moves the Publishes page's "Live" marker and Restore.
  void queryClient.invalidateQueries({ queryKey: publishHistoryKey(projectId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all(), exact: true });
  // The site's own publish facts (how many went live, whether one is exportable).
  void queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId), exact: true });
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
