// @vitest-environment jsdom

import { computeAccessibleName } from 'dom-accessibility-api';
import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pending = { data: undefined, isPending: true };
const analytics = vi.hoisted(() => ({ hook: vi.fn(), chart: vi.fn() }));
const queries = vi.hoisted(() => ({}) as Record<'project' | 'pages' | 'members' | 'deployments' | 'domains' | 'session' | 'content', unknown>);
const clipboard = vi.hoisted(() => ({ copy: vi.fn(), success: vi.fn(), error: vi.fn() }));
const translation = vi.hoisted(() => ({ real: false }));
/** The settings-access tests' name for the same mocked members and publishes. */
const navigation = queries;
/** Signed in as the `viewer` the settings-access tests give a role to. */
const viewer = { data: { user: { id: 'viewer' } }, isPending: false };
/** A site the server says has never gone live. */
const neverPublishedSite = { data: { id: 'project-1', name: 'Docs', slug: 'docs', readyPublishes: 0 }, isPending: false };

vi.mock('@nibleaf/i18n/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nibleaf/i18n/react')>();
  return {
    ...actual,
    useT: () => (key: Parameters<typeof actual.translateFn>[0], variables?: Record<string, string | number>) =>
      translation.real ? actual.translateFn(key, variables, 'en') : key,
  };
});
vi.mock('@/lib/invitations', () => ({ copyToClipboard: clipboard.copy }));
vi.mock('sonner', () => ({ toast: { success: clipboard.success, error: clipboard.error } }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useParams: () => ({ projectId: 'project-1' }) }),
  Link: ({
    children,
    className,
    search,
    to,
    params,
    'aria-label': ariaLabel,
    'data-testid': testId,
  }: {
    children?: ReactNode;
    className?: string;
    search?: { section?: string };
    to?: string;
    params?: Record<string, string>;
    'aria-label'?: string;
    'data-testid'?: string;
  }) => (
    <a
      aria-label={ariaLabel}
      className={className}
      data-params={params ? JSON.stringify(params) : undefined}
      data-testid={testId}
      data-to={to}
      href={search?.section ? `/settings?section=${search.section}` : '/link'}
    >
      {children}
    </a>
  ),
}));
vi.mock('@/env', () => ({ env: {} }));
vi.mock('@/services/auth-client', () => ({ useSession: () => queries.session }));
vi.mock('@/hooks/api', async () => ({
  ...(await vi.importActual<object>('@/hooks/api/domain-state')),
  friendlyErrorMessage: (_t: unknown, _error: unknown, key: string) => key,
  useDeployments: () => queries.deployments,
  useDomains: () => queries.domains,
  usePages: () => queries.pages,
  usePendingChanges: () => queries.content ?? pending,
  useProject: () => queries.project,
  useProjectMembers: () => queries.members,
  usePublishAnyway: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/api/analytics', () => ({ useProjectAnalytics: analytics.hook }));
vi.mock('@/hooks/api/analytics/query-options', () => ({
  analyticsTimezone: () => 'Asia/Riyadh',
  // Same key as the real factory (queryKeys.analytics.project).
  projectAnalyticsQueryOptions: (projectId: string, range: string, timezone: string) => ({
    queryKey: ['analytics', 'project', projectId, range, timezone],
  }),
}));
vi.mock('@/hooks/api/query-options', () => ({ domainsQueryOptions: vi.fn(), projectMembersQueryOptions: vi.fn() }));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: vi.fn() }));
vi.mock('@/components/analytics/views-area-chart', () => ({
  ViewsAreaChart: (props: { unavailable?: boolean }) => {
    analytics.chart(props);
    return null;
  },
}));

import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { canonicalSiteBase } from '@/lib/site-seo';
import { Route } from './index';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const SiteOverviewPage = Route.options.component as unknown as ComponentType;

describe('site overview first load', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    navigation.members = pending;
    navigation.deployments = pending;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    analytics.hook.mockReturnValue(pending);
    Object.assign(queries, { project: pending, pages: pending, members: pending, deployments: pending, domains: pending, session: viewer });
  });

  it.each(['member', 'admin', 'owner'])('keeps overview settings links within the %s role', async (role) => {
    navigation.members = { isPending: false, data: { members: [{ role, user: { id: 'viewer' } }] } };
    navigation.deployments = { isPending: false, data: [] };
    navigation.project = neverPublishedSite;
    await act(async () => root.render(<SiteOverviewPage />));
    const sections = [...container.querySelectorAll('a[href^="/settings"]')].map((link) =>
      new URL(link.getAttribute('href') ?? '', 'https://example.test').searchParams.get('section'),
    );
    if (role === 'member') {
      expect(sections).toContain('languages');
      expect(sections.every((section) => ['members', 'languages'].includes(section ?? ''))).toBe(true);
      expect(container.textContent).toContain('overview.settings.askAdmin');
    } else {
      expect(sections).toEqual(expect.arrayContaining(['members', 'integrations', 'plan', 'general', 'domain']));
    }
  });

  it('shows neutral placeholders until the role resolves without an Editor explanation', async () => {
    await act(async () => root.render(<SiteOverviewPage />));
    expect(container.textContent).not.toContain('overview.settings.askAdmin');
    expect(container.querySelector('a[href="/settings?section=languages"]')).toBeNull();
    navigation.members = { data: { members: [{ role: 'admin', user: { id: 'viewer' } }] } };
    await act(async () => root.render(<SiteOverviewPage />));
    expect(container.querySelector('a[href="/settings?section=general"]')).not.toBeNull();
  });
  it('offers Retry when permissions fail instead of an Editor explanation or settings link', async () => {
    const retry = vi.fn();
    navigation.members = { isError: true, refetch: retry };
    navigation.deployments = { data: [] };
    navigation.project = neverPublishedSite;
    await act(async () => root.render(<SiteOverviewPage />));
    expect(container.textContent).not.toContain('overview.settings.askAdmin');
    expect(container.querySelector('a[href="/settings?section=languages"]')).toBeNull();
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(alert?.closest('ol')).toBeNull();
    await act(async () => alert?.querySelector('button')?.click());
    expect(retry).toHaveBeenCalledOnce();
  });

  it('keeps checklist steps 1 and 2 usable while permissions load, gating only the optional domain step', async () => {
    navigation.deployments = { data: [], isPending: false };
    navigation.project = neverPublishedSite;
    navigation.members = pending;
    await act(async () => root.render(<SiteOverviewPage />));
    const checklist = container.querySelector('ol');
    expect(checklist).not.toBeNull();
    expect(checklist?.querySelector('a[aria-label="overview.nudge.step1"]')).not.toBeNull();
    expect(checklist?.querySelector('a[aria-label="overview.nudge.step2"]')).not.toBeNull();
    expect(checklist?.querySelector('a[aria-label="overview.nudge.step3"]')).toBeNull();
    expect(checklist?.textContent).toContain('overview.nudge.step3Desc');
    expect(checklist?.textContent).not.toContain('overview.settings.askAdmin');
    navigation.members = { data: { members: [{ role: 'admin', user: { id: 'viewer' } }] }, isPending: false };
    await act(async () => root.render(<SiteOverviewPage />));
    expect(container.querySelector('ol a[href="/settings?section=domain"]')).not.toBeNull();
  });

  it('keeps checklist steps 1 and 2 usable after a permission failure and offers Retry inside step 3', async () => {
    const retry = vi.fn();
    navigation.deployments = { data: [], isPending: false };
    navigation.project = neverPublishedSite;
    navigation.members = { isPending: false, isError: true, refetch: retry };
    await act(async () => root.render(<SiteOverviewPage />));
    const checklist = container.querySelector('ol');
    expect(checklist?.querySelector('a[aria-label="overview.nudge.step1"]')).not.toBeNull();
    expect(checklist?.querySelector('a[aria-label="overview.nudge.step2"]')).not.toBeNull();
    expect(checklist?.querySelector('a[aria-label="overview.nudge.step3"]')).toBeNull();
    const step3 = checklist?.querySelectorAll('li')[2];
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(step3?.querySelector('[role="alert"], [role="status"]')).toBeNull();
    expect(step3?.textContent).toContain('overview.nudge.step3Desc');
    expect(step3?.textContent).toContain('overview.nudge.permissionsError');
    expect(step3?.textContent).not.toContain('error.title');
    expect(step3?.textContent).not.toContain('error.unexpected');
    const retryButton = step3?.querySelector('button');
    expect(retryButton?.classList.contains('text-xs')).toBe(true);
    expect(retryButton?.classList.contains('px-0')).toBe(true);
    await act(async () => retryButton?.click());
    expect(retry).toHaveBeenCalledOnce();
    navigation.members = { data: { members: [{ role: 'admin', user: { id: 'viewer' } }] }, isPending: false };
    await act(async () => root.render(<SiteOverviewPage />));
    expect(container.querySelector('ol [role="alert"]')).toBeNull();
    expect(container.querySelector('ol')?.textContent).not.toContain('overview.nudge.permissionsError');
    expect(container.querySelector('ol a[href="/settings?section=domain"]')).not.toBeNull();
  });

  it.each(['member', 'admin', 'owner'])('retains cached %s settings rows and publish nudge after a background member failure', async (role) => {
    const data = { members: [{ role, user: { id: 'viewer' } }] };
    navigation.members = { data, isPending: false };
    navigation.deployments = { data: [] };
    navigation.project = neverPublishedSite;
    await act(async () => root.render(<SiteOverviewPage />));
    const settingsHref = `/settings?section=${role === 'member' ? 'languages' : 'general'}`;
    expect(container.querySelector(`a[href="${settingsHref}"]`)).not.toBeNull();
    expect(container.textContent).toContain('overview.nudge.title');
    navigation.members = { data, isPending: false, isError: true };
    await act(async () => root.render(<SiteOverviewPage />));
    expect(container.querySelector(`a[href="${settingsHref}"]`)).not.toBeNull();
    expect(container.textContent).toContain('overview.nudge.title');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    if (role !== 'member') expect(container.querySelector('a[href="/settings?section=integrations"]')).not.toBeNull();
  });

  it('prefetches the page views the overview opens with, in the loader', async () => {
    const queryClient = {};
    (Route.options.loader as (context: { context: { queryClient: unknown }; params: { projectId: string } }) => void)({
      context: { queryClient },
      params: { projectId: 'project-1' },
    });
    expect(prefetchRouteData).toHaveBeenCalledWith(queryClient, { queryKey: ['analytics', 'project', 'project-1', '30d', 'Asia/Riyadh'] });
    await act(async () => root.render(<SiteOverviewPage />));
    expect(analytics.hook).toHaveBeenCalledWith('project-1', '30d');
  });

  it('shows unknown page views, not zero, when analytics is unavailable', async () => {
    analytics.hook.mockReturnValue({ isPending: false, data: { availability: 'unavailable', totalViews: null, timeseries: [] } });
    await act(async () => root.render(<SiteOverviewPage />));
    const tiles = [...container.querySelectorAll('[data-slot="card"]')].filter((card) => card.textContent?.includes('overview.stats.pageviews'));
    expect(tiles).toHaveLength(1);
    expect(tiles[0]?.querySelector('[data-slot="card-title"]')?.textContent).toBe('—');
    // …and the chart says the views are unknown instead of "no traffic yet".
    expect(analytics.chart).toHaveBeenLastCalledWith(expect.objectContaining({ unavailable: true }));
  });

  it('treats a failed page-views request as unknown, not as no traffic', async () => {
    analytics.hook.mockReturnValue({ isPending: false, isError: true, data: undefined });
    await act(async () => root.render(<SiteOverviewPage />));
    expect(analytics.chart).toHaveBeenLastCalledWith(expect.objectContaining({ unavailable: true }));
  });

  it('announces loading once for the page and keeps the heading free of block elements', async () => {
    await act(async () => root.render(<SiteOverviewPage />));

    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    // The loading regions are still marked busy.
    expect(container.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThanOrEqual(2);
    const heading = container.querySelector('h1');
    expect(heading?.textContent).toBe('overview.title');
    expect(heading?.querySelector('div')).toBeNull();
    expect(heading?.querySelector('[data-slot="skeleton"]')?.tagName).toBe('SPAN');
  });
});

const failed = () => ({ data: undefined, isPending: false, isError: true, isFetching: false, refetch: vi.fn() });
const loaded = (data: unknown) => ({ data, isPending: false, isError: false, isFetching: false, refetch: vi.fn() });
const readyDeployment = { id: 'dep-1', version: 3, status: 'READY', createdAt: '2026-11-01T00:00:00Z', completedAt: '2026-11-01T00:01:00Z' };
const domain = (patch: Record<string, unknown>) => ({
  id: 'domain-1',
  domain: 'docs.example.com',
  verified: true,
  isPrimary: true,
  dnsStatus: 'VERIFIED',
  sslStatus: 'ACTIVE',
  ...patch,
});

describe('first-publish checklist and reserved address', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    translation.real = true;
    vi.stubEnv('VITE_SITE_BASE_DOMAIN', '');
    window.localStorage.clear();
    clipboard.copy.mockResolvedValue(true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    analytics.hook.mockReturnValue(pending);
    Object.assign(queries, {
      project: neverPublishedSite,
      pages: loaded([]),
      content: loaded({ hasRealContent: false }),
      members: loaded({ members: [{ role: 'admin', user: { id: 'viewer' } }] }),
      deployments: loaded([]),
      domains: loaded([]),
      session: viewer,
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    translation.real = false;
    queries.content = undefined;
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it.each([
    { label: 'no pages', pages: [], edited: false, domains: [], done: 0 },
    { label: 'two starter pages', pages: [{ kind: 'PAGE' }, { kind: 'PAGE' }], edited: false, domains: [], done: 0 },
    { label: 'an edited page', pages: [{ kind: 'PAGE' }], edited: true, domains: [], done: 1 },
    {
      label: 'a connecting domain',
      pages: [{ kind: 'PAGE' }],
      edited: true,
      domains: [domain({ dnsStatus: 'PENDING', sslStatus: 'PENDING' })],
      done: 2,
    },
    { label: 'a live domain', pages: [{ kind: 'PAGE' }], edited: true, domains: [domain({})], done: 2 },
  ])('shows accessible completed steps and progress for $label', async (fixture) => {
    Object.assign(queries, {
      pages: loaded(fixture.pages.map((page, index) => ({ ...page, id: `page-${index}`, updatedAt: '2026-11-01T00:00:00Z' }))),
      content: loaded({ hasRealContent: fixture.edited }),
      domains: loaded(fixture.domains),
    });
    await act(async () => root.render(<SiteOverviewPage />));
    const steps = container.querySelectorAll('ol li');
    expect(steps).toHaveLength(3);
    expect(steps[0]?.querySelector('[role="img"]') !== null).toBe(fixture.edited);
    expect(steps[1]?.querySelector('[role="img"]')).toBeNull();
    expect(steps[2]?.querySelector('[role="img"]') !== null).toBe(fixture.domains.length > 0);
    // Each check names its own step, so a screen reader can tell which ones finished.
    for (const step of steps) {
      const check = step.querySelector('[role="img"]');
      if (check) expect(computeAccessibleName(check)).toBe(`Done: ${step.querySelector('.font-medium')?.textContent}`);
    }
    expect(steps[fixture.edited ? 1 : 0]?.getAttribute('aria-current')).toBe('step');
    expect(container.querySelector('ol a[aria-label="Edit a page"]')).not.toBeNull();
    expect(container.querySelector('ol a[aria-label="Connect a custom domain"]')).not.toBeNull();
    const progress = [...container.querySelectorAll('[role="status"]')].find((node) => node.textContent?.includes('of 3 done'));
    expect(progress?.textContent).toBe(`${fixture.done} of 3 done`);
    expect(progress?.getAttribute('aria-atomic')).toBe('true');
    expect(container.textContent?.includes('Connecting — finish domain setup.')).toBe(fixture.label === 'a connecting domain');
    // Re-rendering unchanged query data leaves the live-region text unchanged.
    const observer = vi.fn();
    const mutations = new MutationObserver(observer);
    if (progress) mutations.observe(progress, { childList: true, subtree: true, characterData: true });
    await act(async () => root.render(<SiteOverviewPage />));
    expect(observer).not.toHaveBeenCalled();
    mutations.disconnect();
  });

  it.each([
    { base: '', domains: [], expected: 'http://localhost:3000/sites/project-1' },
    { base: '*.docs.example.test.', domains: [], expected: 'https://docs.docs.example.test' },
    { base: 'docs.example.test', domains: [domain({ sslStatus: 'PROVISIONING' })], expected: 'https://docs.docs.example.test' },
    { base: 'docs.example.test', domains: [domain({})], expected: 'https://docs.example.com' },
  ])('uses the publish dialog address $expected without a premature live link, and copies it', async ({ base, domains, expected }) => {
    vi.stubEnv('VITE_SITE_BASE_DOMAIN', base);
    queries.domains = loaded(domains);
    await act(async () => root.render(<SiteOverviewPage />));
    // This is the resolver and input selection used by PublishModal.
    const primary = domains.find((item) => item.sslStatus === 'ACTIVE');
    expect(canonicalSiteBase('project-1', { slug: 'docs', primaryDomain: primary?.domain })).toBe(expected);
    expect(container.textContent).toContain(`Will be live at ⁨${expected}⁩`);
    expect(container.textContent).toContain('This address opens after the first publish.');
    expect(container.querySelector(`a[href="${expected}"]`)).toBeNull();
    const copy = container.querySelector<HTMLButtonElement>('button[aria-label="Copy address"]');
    expect(copy).not.toBeNull();
    await act(async () => copy?.click());
    expect(clipboard.copy).toHaveBeenCalledWith(expected);
    expect(clipboard.success).toHaveBeenCalledWith('URL copied');
  });

  it('reports a failed copy without a success toast', async () => {
    clipboard.copy.mockResolvedValue(false);
    await act(async () => root.render(<SiteOverviewPage />));
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Copy address"]')?.click());
    expect(clipboard.error).toHaveBeenCalledWith('Could not copy the link');
    expect(clipboard.success).not.toHaveBeenCalled();
  });

  it('withholds progress while content or domains are unknown, including failed requests', async () => {
    for (const state of [{ content: pending }, { content: failed() }, { content: loaded({ hasRealContent: false }), domains: failed() }]) {
      Object.assign(queries, state);
      await act(async () => root.render(<SiteOverviewPage />));
      expect(container.textContent).not.toContain('of 3 done');
    }
  });

  it('keeps the nudge hidden for viewers and asks non-admins to contact an admin', async () => {
    queries.members = loaded({ members: [{ role: 'member', user: { id: 'viewer' } }] });
    await act(async () => root.render(<SiteOverviewPage />));
    expect(container.querySelector('ol')?.textContent).toContain('Ask a site owner or Admin');
    expect(container.querySelector('ol a[aria-label="Connect a custom domain"]')).toBeNull();
    queries.members = loaded({ members: [{ role: 'viewer', user: { id: 'viewer' } }] });
    await act(async () => root.render(<SiteOverviewPage />));
    expect(container.querySelector('ol')).toBeNull();
  });

  it('hides the nudge after the first READY publish', async () => {
    queries.deployments = loaded([readyDeployment]);
    await act(async () => root.render(<SiteOverviewPage />));
    expect(container.querySelector('ol')).toBeNull();
  });
});

describe('site overview when something fails or is still connecting', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    analytics.hook.mockReturnValue({ isPending: false, data: { availability: 'available', totalViews: 0, timeseries: [] } });
    Object.assign(queries, {
      project: loaded({ id: 'project-1', name: 'Docs', slug: 'docs' }),
      pages: loaded([]),
      members: loaded({ members: [] }),
      deployments: loaded([readyDeployment]),
      domains: loaded([]),
      session: { data: { user: { id: 'user-1' } }, isPending: false },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  const tile = (label: string) =>
    [...container.querySelectorAll('[data-slot="card"]')].find((card) => card.textContent?.includes(label))?.querySelector('[data-slot="card-title"]')
      ?.textContent;
  const liveLink = () => container.querySelector<HTMLAnchorElement>('a[target="_blank"][href]:not([aria-label])');

  it('shows a retry, not "no pages yet" or zero counts, when pages and members fail to load', async () => {
    const pages = failed();
    Object.assign(queries, { pages, members: failed() });
    await act(async () => root.render(<SiteOverviewPage />));
    expect(container.textContent).not.toContain('overview.noPages');
    expect(tile('overview.stats.pages')).toBe('—');
    expect(tile('overview.stats.members')).toBe('—');
    // One Retry per failed request: the recent pages, then the settings links that need the team.
    const retry = [...container.querySelectorAll<HTMLButtonElement>('[role="alert"] button')];
    expect(retry).toHaveLength(2);
    await act(async () => retry[0]?.click());
    expect(pages.refetch).toHaveBeenCalled();
    await act(async () => retry[1]?.click());
    expect((queries.members as { refetch: () => void }).refetch).toHaveBeenCalled();
  });

  it('does not claim the site is unpublished when publishes fail to load', async () => {
    Object.assign(queries, { deployments: failed() });
    await act(async () => root.render(<SiteOverviewPage />));
    expect(container.textContent).not.toContain('overview.live.unavailable');
    expect(container.textContent).not.toContain('overview.activity.empty');
    expect(container.textContent).toContain('overview.live.loadError');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(tile('overview.stats.deploys')).toBe('—');
  });

  describe('publish facts come from the site, not the newest 50 attempts', () => {
    const failedAttempts = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ ...readyDeployment, id: `dep-f${index}`, version: 100 - index, status: 'FAILED' }));

    it('stays live, and counts every publish, when the live one is older than the list reaches', async () => {
      Object.assign(queries, {
        project: loaded({ id: 'project-1', name: 'Docs', slug: 'docs', readyPublishes: 2 }),
        deployments: loaded(failedAttempts(50)),
      });
      await act(async () => root.render(<SiteOverviewPage />));
      expect(liveLink()?.getAttribute('href')).toBe('http://localhost:3000/sites/project-1');
      expect(container.textContent).not.toContain('overview.live.unavailable');
      expect(container.textContent).not.toContain('overview.nudge.title');
      // Publishes that went live, not attempts listed.
      expect(tile('overview.stats.deploys')).toBe('2');
    });

    it('counts no publishes when every attempt failed', async () => {
      Object.assign(queries, {
        project: loaded({ id: 'project-1', name: 'Docs', slug: 'docs', readyPublishes: 0 }),
        deployments: loaded(failedAttempts(3)),
      });
      await act(async () => root.render(<SiteOverviewPage />));
      expect(tile('overview.stats.deploys')).toBe('0');
      expect(liveLink()).toBeNull();
      expect(container.textContent).toContain('overview.live.willBeLiveAt');
    });

    it('still links the live site when the publish list fails to load', async () => {
      Object.assign(queries, {
        project: loaded({ id: 'project-1', name: 'Docs', slug: 'docs', readyPublishes: 4 }),
        deployments: failed(),
      });
      await act(async () => root.render(<SiteOverviewPage />));
      expect(liveLink()?.getAttribute('href')).toBe('http://localhost:3000/sites/project-1');
      expect(container.textContent).not.toContain('overview.live.loadError');
      expect(tile('overview.stats.deploys')).toBe('4');
    });

    it('never labels a failed attempt "Published docs" in the activity list', async () => {
      Object.assign(queries, {
        project: loaded({ id: 'project-1', name: 'Docs', slug: 'docs', readyPublishes: 1 }),
        deployments: loaded([{ ...readyDeployment, id: 'dep-f', version: 4, status: 'FAILED' }, readyDeployment]),
      });
      await act(async () => root.render(<SiteOverviewPage />));
      const row = (version: string) =>
        [...container.querySelectorAll('span[dir="ltr"]')].find((tag) => tag.textContent === version)?.closest('.justify-between');
      const failedRow = row('v4');
      const readyRow = row('v3');
      expect(failedRow).toBeTruthy();
      expect(readyRow).toBeTruthy();
      expect(failedRow?.textContent).not.toContain('overview.activity.publish');
      expect(failedRow?.querySelector('[data-slot="badge"]')).not.toBeNull();
      expect(readyRow?.textContent).toContain('overview.activity.publish');
      expect(readyRow?.querySelector('[data-slot="badge"]')).toBeNull();
    });

    it('links each Activity line to its version and offers the full publish history', async () => {
      Object.assign(queries, {
        project: loaded({ id: 'project-1', name: 'Docs', slug: 'docs', readyPublishes: 1 }),
        deployments: loaded([{ ...readyDeployment, id: 'dep-f', version: 4, status: 'FAILED' }, readyDeployment]),
      });
      await act(async () => root.render(<SiteOverviewPage />));
      const rows = [...container.querySelectorAll('[data-testid="activity-row"]')];
      expect(rows.map((row) => [row.getAttribute('data-to'), JSON.parse(row.getAttribute('data-params') ?? '{}')])).toEqual([
        ['/app/projects/$projectId/publishes/$deploymentId', { projectId: 'project-1', deploymentId: 'dep-f' }],
        ['/app/projects/$projectId/publishes/$deploymentId', { projectId: 'project-1', deploymentId: readyDeployment.id }],
      ]);
      expect(rows[0]?.textContent).toContain('v4');
      const viewAll = container.querySelector('[data-testid="activity-view-all"]');
      expect(viewAll?.getAttribute('data-to')).toBe('/app/projects/$projectId/publishes');
      expect(viewAll?.textContent).toBe('overview.activity.viewAll');
    });

    it('shows a publish that just went live before the site is read again', async () => {
      Object.assign(queries, {
        project: loaded({ id: 'project-1', name: 'Docs', slug: 'docs', readyPublishes: 0 }),
        deployments: loaded([readyDeployment]),
      });
      await act(async () => root.render(<SiteOverviewPage />));
      expect(liveLink()?.getAttribute('href')).toBe('http://localhost:3000/sites/project-1');
      expect(container.textContent).not.toContain('overview.nudge.title');
    });
  });

  // P1-DASH-005: with unpublished edits, Overview said "Live · v1" and nothing else.
  describe('unpublished changes', () => {
    const page = (id: string, updatedAt: string) => ({ id, kind: 'PAGE', title: id, path: id, updatedAt, config: null });
    beforeEach(() => {
      Object.assign(queries, {
        project: loaded({ id: 'project-1', name: 'Docs', slug: 'docs', readyPublishes: 1 }),
        members: loaded({ members: [{ role: 'admin', user: { id: 'user-1' } }] }),
        deployments: loaded([{ ...readyDeployment, version: 1 }]),
        pages: loaded([page('edited', '2026-11-13T10:00:00Z'), page('fresh', '2026-11-13T09:00:00Z'), page('untouched', '2026-11-01T00:00:00Z')]),
        content: loaded({
          hasBaseline: true,
          lastVersion: 1,
          upToDate: false,
          changes: [
            { id: 'edited', status: 'modified' },
            { id: 'fresh', status: 'added' },
          ],
        }),
      });
    });

    it('says the live site is behind, with Review and publish', async () => {
      await act(async () => root.render(<SiteOverviewPage />));
      const notice = container.querySelector('[data-testid="pending-changes"]');
      expect(notice?.textContent).toContain('pending.count');
      expect(notice?.textContent).toContain('pending.readersStillSee');
      // Outside the site shell there is no top-bar sheet to open, so it links to the editor's.
      const review = [...(notice?.querySelectorAll('a') ?? [])].find((link) => link.textContent?.includes('pending.review'));
      expect(review?.getAttribute('data-to')).toBe('/app/projects/$projectId/editor');
    });

    it('gives each recent page its status against the live site', async () => {
      await act(async () => root.render(<SiteOverviewPage />));
      const statuses = [...container.querySelectorAll('[data-page-status]')].map((badge) => badge.getAttribute('data-page-status'));
      expect(statuses).toEqual(['changed', 'draft', 'live']);
    });

    it('offers Viewers the state without a publish action', async () => {
      queries.members = loaded({ members: [{ role: 'viewer', user: { id: 'user-1' } }] });
      await act(async () => root.render(<SiteOverviewPage />));
      const notice = container.querySelector('[data-testid="pending-changes"]');
      expect(notice?.textContent).toContain('pending.count');
      expect(notice?.textContent).not.toContain('pending.review');
    });

    it('says nothing once everything is live', async () => {
      queries.content = loaded({ hasBaseline: true, lastVersion: 1, upToDate: true, changes: [] });
      await act(async () => root.render(<SiteOverviewPage />));
      expect(container.querySelector('[data-testid="pending-changes"]')).toBeNull();
    });
  });

  it('links a custom domain only once its DNS and HTTPS both work', async () => {
    queries.domains = loaded([domain({})]);
    await act(async () => root.render(<SiteOverviewPage />));
    expect(liveLink()?.getAttribute('href')).toBe('https://docs.example.com');
    expect(container.textContent).not.toContain('overview.live.domainConnecting');
  });

  it.each([
    { dnsStatus: 'ERROR', sslStatus: 'PENDING' },
    { dnsStatus: 'VERIFIED', sslStatus: 'PROVISIONING' },
  ])('keeps readers on the default address while the domain is not ready: %o', async (status) => {
    queries.domains = loaded([domain(status)]);
    await act(async () => root.render(<SiteOverviewPage />));
    expect(liveLink()?.getAttribute('href')).toBe('http://localhost:3000/sites/project-1');
    expect(container.querySelector('[aria-label="overview.viewSite"]')?.getAttribute('href')).toBe('http://localhost:3000/sites/project-1');
    expect(container.textContent).toContain('overview.live.domainConnecting');
  });

  it('explains a failed publish in plain words and keeps the raw reason folded away', async () => {
    queries.deployments = loaded([
      { ...readyDeployment, id: 'dep-2', version: 4, status: 'FAILED', error: 'Published revision exceeds export limits.' },
    ]);
    await act(async () => root.render(<SiteOverviewPage />));
    expect(container.textContent).toContain('overview.publishFailed.unknown');
    const details = container.querySelector('details');
    expect(details?.querySelector('summary')?.textContent).toBe('overview.publishFailed.technicalDetails');
    expect(details?.textContent).toContain('Published revision exceeds export limits.');
  });

  describe('the "still connecting" note fits who is looking', () => {
    const connecting = () => loaded([domain({ sslStatus: 'PROVISIONING' })]);
    const team = (role: string) => loaded({ members: [{ user: { id: 'user-1' }, role }] });

    it('offers Admins the way to finish the setup', async () => {
      Object.assign(queries, { domains: connecting(), members: team('admin') });
      await act(async () => root.render(<SiteOverviewPage />));
      expect(container.textContent).toContain('overview.live.finishSetup');
      expect(container.textContent).not.toContain('overview.live.askAdmin');
    });

    it('asks Editors to involve an Admin instead of linking a section they cannot open', async () => {
      Object.assign(queries, { domains: connecting(), members: team('member') });
      await act(async () => root.render(<SiteOverviewPage />));
      expect(container.textContent).toContain('overview.live.askAdmin');
      expect(container.textContent).not.toContain('overview.live.finishSetup');
    });

    it.each([
      ['the session is loading', { session: { data: undefined, isPending: true } }],
      ['the team is loading', { members: pending }],
      ['the team failed to load', { members: failed() }],
    ])('stays neutral while %s', async (_label, state) => {
      Object.assign(queries, { domains: connecting(), members: team('admin'), ...state });
      await act(async () => root.render(<SiteOverviewPage />));
      expect(container.textContent).toContain('overview.live.domainConnecting');
      expect(container.textContent).not.toContain('overview.live.finishSetup');
      expect(container.textContent).not.toContain('overview.live.askAdmin');
    });
  });
});
