// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ pathname: '/app', locale: 'en', recordVisit: vi.fn() }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => `${mocks.locale}:${key}` }));
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: mocks.pathname } }),
  Link: ({
    to,
    params,
    children,
    activeOptions: _activeOptions,
    ...props
  }: {
    to: string;
    params?: { projectId: string };
    children: ReactNode;
    activeOptions?: unknown;
  }) => (
    <a href={to.replace('$projectId', params?.projectId ?? '')} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@nibleaf/design-system/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/components/app/org-sidebar', () => ({
  OrgSidebar: () => null,
  ORG_NAV: [
    { section: 'websites', labelKey: 'nav.websites' },
    { section: 'settings', labelKey: 'nav.settings' },
  ],
}));
vi.mock('@/components/app/project-sidebar', () => ({ ProjectSidebar: () => null }));
vi.mock('@/components/app/notifications-popover', () => ({ NotificationsPopover: () => null }));
vi.mock('@/components/app/org-switcher/organization-switcher', () => ({
  OrganizationSwitcher: ({ organization }: { organization?: { name: string } }) => (
    <button data-testid="org-switcher" type="button">
      {organization?.name ?? 'loading'}
    </button>
  ),
}));
vi.mock('@/components/app/org-switcher/website-switcher', () => ({
  WebsiteSwitcher: ({ project }: { project?: { name: string } }) => (
    <button data-testid="website-switcher" type="button">
      {project?.name ?? 'loading'}
    </button>
  ),
}));
vi.mock('@/components/project/deploy-pipeline', () => ({ DeployPipeline: () => null }));
vi.mock('@/components/project/publish-modal', () => ({ PublishModal: () => null }));
vi.mock('@/hooks/api', () => ({
  useProject: () => ({ data: { id: 'fixture', name: 'Long site name / دليل المنتج', organizationId: 'org-1' } }),
  useOrganizationOfProject: () => ({ organization: { id: 'org-1', slug: 'acme', name: 'Acme Docs', logo: null, orgRole: 'owner' } }),
  // The top bar's Publish.
  useDeployments: () => ({ data: [] }),
  usePendingChanges: () => ({ data: undefined }),
}));
vi.mock('@/hooks/use-record-visit', () => ({ useRecordVisitEffect: mocks.recordVisit }));
vi.mock('@/hooks/use-project-admin-status', () => ({ useProjectAdminStatus: () => ({ edit: 'edit' }) }));

import { OrganizationLayout } from './organization';
import { ProjectLayout } from './project';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});
const organization = { id: 'org-1', slug: 'acme', name: 'Acme Docs', logo: null, orgRole: 'owner' as const, canCreateWebsite: true };
async function render(path: string, project = true) {
  mocks.pathname = path;
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      project ? (
        <ProjectLayout projectId="fixture">Content</ProjectLayout>
      ) : (
        <OrganizationLayout organization={organization} orgSlug="acme">
          Content
        </OrganizationLayout>
      ),
    ),
  );
}

it.each([
  ['', null],
  ['/analytics', 'en:project.analytics'],
  ['/analytics/', 'en:project.analytics'],
  ['/analytics/pages', 'en:analytics.tab.pages'],
  ['/analytics/search', 'en:analytics.tab.search'],
  ['/analytics/feedback', 'en:analytics.tab.feedback'],
  ['/analytics/ai', 'en:analytics.tab.ai'],
  ['/analytics/performance', 'en:analytics.tab.performance'],
  ['/ai', 'en:dashboard.ai.title'],
  ['/settings', 'en:project.settings'],
  ['/preview', 'en:project.preview'],
])('reads [Org ▾] / [Website ▾] / section for the project route %s', async (path, label) => {
  mocks.locale = 'en';
  await render(`/app/projects/fixture${path}`);
  const nav = document.querySelector('[data-slot="breadcrumb"]');
  // Org and website are switchers, in that order, then the current section.
  const switchers = [...(nav?.querySelectorAll('[data-testid]') ?? [])].map((node) => node.getAttribute('data-testid'));
  expect(switchers).toEqual(['org-switcher', 'website-switcher']);
  expect(nav?.querySelector('[data-testid="org-switcher"]')?.textContent).toBe('Acme Docs');
  expect(nav?.querySelector('[data-testid="website-switcher"]')?.textContent).toBe('Long site name / دليل المنتج');
  const current = nav?.querySelectorAll('[aria-current="page"]');
  expect(current).toHaveLength(label ? 1 : 0);
  if (label) expect(current?.[0]?.textContent).toBe(label);
  if (path.startsWith('/analytics/') && path !== '/analytics/')
    expect(nav?.querySelector('a[href="/app/projects/fixture/analytics"]')?.textContent).toBe('en:project.analytics');
  expect(nav?.querySelector('li li')).toBeNull();
});

// P1-DASH-005: Publish lived only in the editor and the draft preview.
it.each([
  ['', true],
  ['/analytics', true],
  ['/publishes', true],
  ['/settings', true],
  // The draft preview has Publish in its own bar.
  ['/preview', false],
])('offers Publish in the site top bar on %j: %s', async (path, shown) => {
  mocks.locale = 'en';
  await render(`/app/projects/fixture${path}`);
  const publish = document.querySelector('header button[aria-label="en:project.publish"]');
  expect(Boolean(publish)).toBe(shown);
});

it('records the website (and so its org) as the last opened', async () => {
  mocks.recordVisit.mockClear();
  await render('/app/projects/fixture');
  expect(mocks.recordVisit).toHaveBeenCalledWith({ projectId: 'fixture' });
});

it('shows [Org ▾] then the page title at org level', async () => {
  mocks.locale = 'en';
  await render('/app/o/acme/settings', false);
  const nav = document.querySelector('[data-slot="breadcrumb"]');
  expect(nav?.querySelector('[data-testid="org-switcher"]')?.textContent).toBe('Acme Docs');
  expect(nav?.querySelector('[data-testid="website-switcher"]')).toBeNull();
  expect(nav?.querySelector('[aria-current="page"]')?.textContent).toBe('en:nav.settings');
});

it.each(['en', 'ar', 'de'])('passes the localized breadcrumb name in both shells (%s)', async (locale) => {
  mocks.locale = locale;
  await render('/app/o/acme/websites', false);
  const header = document.querySelector('header');
  const orgClass = header?.className;
  const searchClass = header?.querySelector(`button[aria-label="${locale}:dashboard.search.placeholder"]`)?.className;
  const search = header?.querySelector(`button[aria-label="${locale}:dashboard.search.placeholder"]`);
  expect(search).not.toBeNull();
  expect(search?.getAttribute('aria-label')).toBe(search?.querySelector('span')?.textContent);
  expect(document.querySelector('[data-slot="breadcrumb"]')?.getAttribute('aria-label')).toBe(`${locale}:nav.breadcrumb`);
  await act(async () => root.render(<ProjectLayout projectId="fixture">Content</ProjectLayout>));
  expect(document.querySelector('header')?.className).toBe(orgClass);
  expect(document.querySelector(`button[aria-label="${locale}:dashboard.search.placeholder"]`)?.className).toBe(searchClass);
  expect(document.querySelector('[data-slot="breadcrumb"]')?.getAttribute('aria-label')).toBe(`${locale}:nav.breadcrumb`);
});
