import { describe, expect, it } from 'vitest';
import { type OverviewDeployment, type OverviewDomain, recentPages, type SiteOverviewInput, siteOverview } from './overview';

type Attempt = OverviewDeployment & { id: string };

const attempt = (id: string, status: Attempt['status']): Attempt => ({ id, status });

/** Everything loaded: a live site with one publish, two pages, one member and some traffic. */
const loaded = (overrides: Partial<SiteOverviewInput<Attempt>> = {}): SiteOverviewInput<Attempt> => ({
  project: { readyPublishes: 1 },
  projectPending: false,
  pages: [
    { kind: 'PAGE', updatedAt: '2026-11-01T00:00:00.000Z' },
    { kind: 'GROUP', updatedAt: '2026-11-02T00:00:00.000Z' },
    { kind: 'PAGE', updatedAt: '2026-11-03T00:00:00.000Z' },
  ],
  pagesError: false,
  members: { members: [{}] },
  membersError: false,
  deployments: [attempt('v1', 'READY')],
  deploymentsPending: false,
  deploymentsError: false,
  domains: [],
  analytics: { availability: 'available', totalViews: 120, comparableTotalViews: 120, previousTotalViews: 100 },
  analyticsError: false,
  viewOnly: false,
  ...overrides,
});

/** Nothing has answered yet. */
const loading: Partial<SiteOverviewInput<Attempt>> = {
  project: undefined,
  projectPending: true,
  pages: undefined,
  members: undefined,
  deployments: undefined,
  deploymentsPending: true,
  domains: undefined,
  analytics: undefined,
};

const domain = (name: string, state: Partial<OverviewDomain> = {}): OverviewDomain => ({
  domain: name,
  isPrimary: false,
  verified: true,
  dnsStatus: 'VERIFIED',
  sslStatus: 'ACTIVE',
  ...state,
});
const connecting = { verified: false, dnsStatus: 'PENDING', sslStatus: 'PENDING' };

describe('siteOverview: publishing state', () => {
  it('reads a never-published site as never published only once the site says 0, and offers its reserved address', () => {
    const overview = siteOverview(loaded({ project: { readyPublishes: 0 }, deployments: [] }));
    expect(overview).toMatchObject({ publishing: 'neverPublished', liveCard: 'reserved', publishCount: 0, showFirstPublishNudge: true });
  });

  it('keeps the publishing state unknown, not "never published" or 0, while the site loads', () => {
    const overview = siteOverview(loaded(loading));
    expect(overview).toMatchObject({ publishing: 'unknown', liveCard: 'loading', publishCount: null, showFirstPublishNudge: false });
  });

  it('stays unknown, with no count and no checklist, when the site fails to load', () => {
    const overview = siteOverview(loaded({ project: undefined, deployments: [] }));
    expect(overview).toMatchObject({ publishing: 'unknown', liveCard: 'loadError', publishCount: null, showFirstPublishNudge: false });
  });

  it('treats an older live publish beyond the attempt list as live', () => {
    const overview = siteOverview(loaded({ project: { readyPublishes: 12 }, deployments: [attempt('v60', 'FAILED')] }));
    expect(overview).toMatchObject({ publishing: 'live', liveCard: 'live', publishCount: 12 });
  });

  it('goes live as soon as the polled list shows READY, before the site is read again', () => {
    const overview = siteOverview(loaded({ project: { readyPublishes: 0 }, deployments: [attempt('v1', 'READY')] }));
    expect(overview).toMatchObject({ publishing: 'live', liveCard: 'live', showFirstPublishNudge: false });
    // The count still comes from the site until it is read again.
    expect(overview.publishCount).toBe(0);
  });

  it('goes live from a READY attempt even while the site itself is still loading', () => {
    const overview = siteOverview(loaded({ ...loading, deployments: [attempt('v1', 'READY')], deploymentsPending: false }));
    expect(overview).toMatchObject({ publishing: 'live', liveCard: 'live', publishCount: null });
  });

  it('reserves the address for a never-published site while its attempt list still loads', () => {
    const overview = siteOverview(loaded({ project: { readyPublishes: 0 }, deployments: undefined, deploymentsPending: true }));
    expect(overview).toMatchObject({ publishing: 'neverPublished', liveCard: 'reserved' });
    // The checklist waits for the attempt list: the last attempt may have failed.
    expect(overview.showFirstPublishNudge).toBe(false);
  });

  it('shows a placeholder, not an error, while a known-published state still waits on the attempt list', () => {
    const overview = siteOverview(loaded({ project: undefined, projectPending: false, deployments: undefined, deploymentsPending: true }));
    expect(overview.liveCard).toBe('loading');
  });
});

describe('siteOverview: failure and first-publish messages', () => {
  it('explains a failed recent attempt while an older publish stays live', () => {
    const failed = attempt('v8', 'FAILED');
    const overview = siteOverview(loaded({ project: { readyPublishes: 7 }, deployments: [failed, attempt('v7', 'READY')] }));
    expect(overview).toMatchObject({ publishing: 'live', liveCard: 'live', publishCount: 7, showFirstPublishNudge: false });
    expect(overview.failedDeployment).toBe(failed);
    expect(overview.latestDeployment).toBe(failed);
  });

  it('only explains the newest attempt: an older failure that a later publish replaced is not shown', () => {
    const overview = siteOverview(loaded({ deployments: [attempt('v2', 'READY'), attempt('v1', 'FAILED')] }));
    expect(overview.failedDeployment).toBeUndefined();
    expect(overview.latestDeployment?.id).toBe('v2');
  });

  it('lets the failure card lead instead of the checklist when the first publish failed', () => {
    const failed = attempt('v1', 'FAILED');
    const overview = siteOverview(loaded({ project: { readyPublishes: 0 }, deployments: [failed] }));
    expect(overview).toMatchObject({ publishing: 'neverPublished', failedDeployment: failed, showFirstPublishNudge: false });
  });

  it('keeps the checklist for an in-flight first attempt', () => {
    const overview = siteOverview(loaded({ project: { readyPublishes: 0 }, deployments: [attempt('v1', 'BUILDING')] }));
    expect(overview).toMatchObject({ publishing: 'neverPublished', failedDeployment: undefined, showFirstPublishNudge: true });
  });

  it('never offers Viewers the first-publish checklist', () => {
    const overview = siteOverview(loaded({ project: { readyPublishes: 0 }, deployments: [], viewOnly: true }));
    expect(overview.showFirstPublishNudge).toBe(false);
  });

  it('reports a failed attempt list with nothing cached, but keeps a cached one after a background failure', () => {
    expect(siteOverview(loaded({ deployments: undefined, deploymentsError: true })).deploymentsFailed).toBe(true);
    expect(siteOverview(loaded({ deploymentsError: true })).deploymentsFailed).toBe(false);
  });

  it('still reads the site as live when the attempt list fails to load', () => {
    const overview = siteOverview(loaded({ deployments: undefined, deploymentsError: true }));
    expect(overview).toMatchObject({ publishing: 'live', liveCard: 'live', latestDeployment: undefined, failedDeployment: undefined });
  });
});

describe('siteOverview: address', () => {
  it('falls back to the default address, naming the domain still connecting, when no custom domain is live', () => {
    const overview = siteOverview(loaded({ domains: [domain('docs.acme.test', { isPrimary: true, ...connecting })] }));
    expect(overview).toMatchObject({ liveDomain: undefined, connectingDomain: 'docs.acme.test' });
  });

  it('uses the live primary domain, with no connecting note', () => {
    const overview = siteOverview(loaded({ domains: [domain('old.acme.test'), domain('docs.acme.test', { isPrimary: true })] }));
    expect(overview).toMatchObject({ liveDomain: 'docs.acme.test', connectingDomain: undefined });
  });

  it('prefers any live domain over a primary that is still connecting', () => {
    const overview = siteOverview(loaded({ domains: [domain('new.acme.test', { isPrimary: true, ...connecting }), domain('docs.acme.test')] }));
    expect(overview).toMatchObject({ liveDomain: 'docs.acme.test', connectingDomain: undefined });
  });

  it('treats DNS that works without HTTPS as still connecting', () => {
    const overview = siteOverview(loaded({ domains: [domain('docs.acme.test', { sslStatus: 'PROVISIONING' })] }));
    expect(overview).toMatchObject({ liveDomain: undefined, connectingDomain: 'docs.acme.test' });
  });

  it('uses the default address with no note when there are no domains, or they are not loaded yet', () => {
    for (const domains of [[], undefined]) {
      expect(siteOverview(loaded({ domains }))).toMatchObject({ liveDomain: undefined, connectingDomain: undefined });
    }
  });
});

describe('siteOverview: counts and analytics', () => {
  it('counts pages, not navigation groups, and the team', () => {
    expect(siteOverview(loaded())).toMatchObject({ pageCount: 2, memberCount: 1, pagesFailed: false, membersFailed: false });
  });

  it('reads failed pages and members as unknown, never as zero', () => {
    const overview = siteOverview(loaded({ pages: undefined, pagesError: true, members: undefined, membersError: true }));
    expect(overview).toMatchObject({ pageCount: null, memberCount: null, pagesFailed: true, membersFailed: true });
  });

  it('keeps the cached counts after a failed background refetch', () => {
    const overview = siteOverview(loaded({ pagesError: true, membersError: true }));
    expect(overview).toMatchObject({ pageCount: 2, memberCount: 1, pagesFailed: false, membersFailed: false });
  });

  it('compares this window with the one before it', () => {
    expect(siteOverview(loaded())).toMatchObject({ analyticsUnknown: false, totalViews: 120, viewsComparison: { value: 120, previous: 100 } });
  });

  it('leaves out a side of the comparison the answer does not have', () => {
    const overview = siteOverview(loaded({ analytics: { availability: 'available', totalViews: 5 } }));
    expect(overview.viewsComparison).toEqual({ value: null, previous: null });
  });

  it.each([
    ['a failed request', { analytics: undefined, analyticsError: true }],
    ['an analytics outage', { analytics: { availability: 'unavailable', totalViews: 0, comparableTotalViews: 0, previousTotalViews: 0 } }],
  ])('reads %s as unknown traffic, never as no traffic', (_case, overrides) => {
    const overview = siteOverview(loaded(overrides));
    expect(overview.analyticsUnknown).toBe(true);
    expect(overview.viewsComparison).toBeNull();
  });

  it('has no views total while analytics loads', () => {
    expect(siteOverview(loaded(loading))).toMatchObject({ analyticsUnknown: false, totalViews: null });
  });
});

describe('recentPages', () => {
  const page = (id: string, updatedAt: string, kind: 'PAGE' | 'GROUP' = 'PAGE') => ({ id, kind, updatedAt });

  it('lists pages, not groups, most recently updated first, at most six', () => {
    const pages = [
      page('a', '2026-11-01T10:00:00.000Z'),
      page('group', '2026-11-09T00:00:00.000Z', 'GROUP'),
      page('b', '2026-11-08T00:00:00.000Z'),
      page('c', '2026-11-03T00:00:00.000Z'),
      page('d', '2026-11-07T00:00:00.000Z'),
      page('e', '2026-10-30T00:00:00.000Z'),
      page('f', '2026-11-05T00:00:00.000Z'),
      page('g', '2026-11-01T09:00:00.000Z'),
    ];
    expect(recentPages(pages).map((entry) => entry.id)).toEqual(['b', 'd', 'f', 'c', 'a', 'g']);
  });

  it('compares instants, not strings, so offsets order correctly', () => {
    const pages = [page('utc', '2026-11-01T10:00:00.000Z'), page('riyadh', '2026-11-01T12:30:00+03:00')];
    expect(recentPages(pages).map((entry) => entry.id)).toEqual(['utc', 'riyadh']);
  });

  it('keeps the list order for pages updated at the same moment, and leaves the input untouched', () => {
    const pages = [page('first', '2026-11-01T00:00:00.000Z'), page('second', '2026-11-01T00:00:00.000Z'), page('newer', '2026-11-02T00:00:00.000Z')];
    expect(recentPages(pages).map((entry) => entry.id)).toEqual(['newer', 'first', 'second']);
    expect(pages.map((entry) => entry.id)).toEqual(['first', 'second', 'newer']);
  });

  it('is empty while pages load or failed', () => {
    expect(recentPages(undefined)).toEqual([]);
  });
});
