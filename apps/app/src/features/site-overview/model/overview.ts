/**
 * Site Overview, as pure logic: page and team counts, whether the site is live,
 * never published or not yet known, which address to link, which first-publish
 * and failure messages show, and the page-views comparison. Rendered by
 * `routes/app/projects/$projectId/index.tsx`; tested in `overview.test.ts`.
 *
 * The inputs are structural copies of the API's shapes (hooks/api/types.ts), so
 * the model takes plain values and imports nothing from the data layer.
 */
import { type DomainServingState, pickLiveDomain } from '@nibleaf/shared/domains';

/** The fields of a page this model reads. */
export type OverviewPage = { kind: 'PAGE' | 'GROUP'; updatedAt: string };

/** The fields of a publish attempt this model reads. The list is newest first. */
export type OverviewDeployment = { status: 'PENDING' | 'BUILDING' | 'READY' | 'FAILED' };

/** The fields of a custom domain this model reads. Domains are in creation order (oldest first). */
export type OverviewDomain = DomainServingState & { domain: string; isPrimary: boolean };

/** The page-views answer, as far as the Overview reads it. */
type OverviewAnalytics = {
  availability?: string;
  totalViews?: number | null;
  comparableTotalViews?: number | null;
  previousTotalViews?: number | null;
};

/**
 * Each value is the query's data (undefined while it loads or after a failure
 * with nothing cached) and whether that query has failed.
 */
export interface SiteOverviewInput<D extends OverviewDeployment> {
  project: { readyPublishes?: number } | undefined;
  projectPending: boolean;
  pages: readonly OverviewPage[] | undefined;
  pagesError: boolean;
  members: { members: readonly unknown[] } | undefined;
  membersError: boolean;
  deployments: readonly D[] | undefined;
  deploymentsPending: boolean;
  deploymentsError: boolean;
  domains: readonly OverviewDomain[] | undefined;
  analytics: OverviewAnalytics | undefined;
  analyticsError: boolean;
  /** Viewers read the site: nothing here offers them a publish. */
  viewOnly: boolean;
}

/**
 * Whether the site has a live version:
 * - `live`: the site counts a publish, or the polled list already shows a READY one;
 * - `neverPublished`: the site itself says it has none;
 * - `unknown`: neither is known yet (loading, or the site failed to load).
 */
type PublishingState = 'live' | 'neverPublished' | 'unknown';

/**
 * The "Live site" card:
 * - `live`: link the address;
 * - `loading`: a placeholder while the answer is still coming;
 * - `loadError`: the answer failed, so say nothing about whether it's live;
 * - `reserved`: never published, so show the address it will go live at.
 */
type LiveCardState = 'live' | 'loading' | 'loadError' | 'reserved';

export interface SiteOverview<D extends OverviewDeployment> {
  /**
   * A request failed with nothing cached: unknown, never "no pages", "0 members"
   * or "no publishes", which read as lost content. A failed background refetch
   * keeps showing the cached data.
   */
  pagesFailed: boolean;
  membersFailed: boolean;
  deploymentsFailed: boolean;
  /** Pages, not navigation groups. Null when the pages failed to load. */
  pageCount: number | null;
  /** Null when the team failed to load. */
  memberCount: number | null;
  /**
   * Publishes that went live, from the site itself. The deployments list is the
   * newest 50 attempts (failed and pending included), so it can't count them.
   * Null until the site answers.
   */
  publishCount: number | null;
  publishing: PublishingState;
  liveCard: LiveCardState;
  /** The newest attempt, whatever its status. */
  latestDeployment: D | undefined;
  /** The newest attempt when it failed: the failure card explains it. */
  failedDeployment: D | undefined;
  /** The first-publish checklist: never published, the publish list loaded, the last attempt didn't fail, and not a Viewer. */
  showFirstPublishNudge: boolean;
  /** The custom domain that opens the docs (DNS and HTTPS both work); otherwise the default address is used. */
  liveDomain: string | undefined;
  /** A custom domain still being set up, when none is live yet. */
  connectingDomain: string | undefined;
  /** A failed page-views request or an analytics outage: unknown, never "no traffic". */
  analyticsUnknown: boolean;
  totalViews: number | null;
  /** This window against the equal window before it; null when analytics is unknown. */
  viewsComparison: { value: number | null; previous: number | null } | null;
}

export function siteOverview<D extends OverviewDeployment>(input: SiteOverviewInput<D>): SiteOverview<D> {
  const { project, deployments, domains, analytics } = input;
  const pagesFailed = input.pagesError && !input.pages;
  const membersFailed = input.membersError && !input.members;

  // A publish that just went live shows in the (polled) list before the site is re-read.
  const live = (project?.readyPublishes ?? 0) > 0 || (deployments ?? []).some((deployment) => deployment.status === 'READY');
  // "Never published" only once the site itself says so; until then it's unknown.
  const neverPublished = !live && project?.readyPublishes === 0;
  const publishing: PublishingState = live ? 'live' : neverPublished ? 'neverPublished' : 'unknown';

  const latestDeployment = deployments?.[0];
  const failedDeployment = latestDeployment?.status === 'FAILED' ? latestDeployment : undefined;

  // Only a domain whose DNS and HTTPS both work opens the docs; one still connecting
  // (or broken) would greet the owner with a browser error, so link the default address.
  const primaryDomain = pickLiveDomain(domains ?? []);

  const analyticsUnknown = input.analyticsError || analytics?.availability === 'unavailable';

  return {
    pagesFailed,
    membersFailed,
    deploymentsFailed: input.deploymentsError && !deployments,
    pageCount: pagesFailed ? null : (input.pages ?? []).filter((page) => page.kind !== 'GROUP').length,
    memberCount: membersFailed ? null : (input.members?.members.length ?? 0),
    publishCount: project?.readyPublishes ?? null,
    publishing,
    liveCard: live
      ? 'live'
      : input.projectPending || (input.deploymentsPending && !neverPublished)
        ? 'loading'
        : neverPublished
          ? 'reserved'
          : 'loadError',
    latestDeployment,
    failedDeployment,
    // The failure card leads while the latest attempt is FAILED.
    showFirstPublishNudge: deployments !== undefined && neverPublished && !failedDeployment && !input.viewOnly,
    liveDomain: primaryDomain?.domain,
    connectingDomain: primaryDomain ? undefined : domains?.[0]?.domain,
    analyticsUnknown,
    totalViews: analytics?.totalViews ?? null,
    viewsComparison: analyticsUnknown ? null : { value: analytics?.comparableTotalViews ?? null, previous: analytics?.previousTotalViews ?? null },
  };
}

/** The pages Overview lists under "Recent pages": pages only (no groups), most recently updated first. */
export function recentPages<P extends OverviewPage>(pages: readonly P[] | undefined, limit = 6): P[] {
  return (pages ?? [])
    .filter((page) => page.kind === 'PAGE')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limit);
}
