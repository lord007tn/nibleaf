// @vitest-environment jsdom

import { act, type ComponentType, type ReactNode, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  members: vi.fn(),
  project: vi.fn(),
  prefetch: vi.fn(),
  section: 'general' as string | undefined,
  appearanceSection: undefined as string | undefined,
  navigate: vi.fn(),
  refetch: vi.fn(),
  blocker: vi.fn(),
  confirm: vi.fn(),
  dirty: false,
  orgRole: 'member' as 'owner' | 'admin' | 'member',
}));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useParams: () => ({ projectId: 'project-1' }),
    useSearch: () => ({ section: mocks.section, appearanceSection: mocks.appearanceSection }),
  }),
  useNavigate: () => mocks.navigate,
  useBlocker: mocks.blocker,
  Link: ({
    children,
    to,
    search,
    className,
    'aria-current': current,
  }: {
    children: ReactNode;
    to: string;
    search?: { section?: string };
    className?: string;
    'aria-current'?: 'page';
  }) => (
    <a
      aria-current={current}
      className={className}
      href={`${to.replace('$projectId', 'project-1')}${search?.section ? `?section=${search.section}` : ''}`}
    >
      {children}
    </a>
  ),
}));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('@/components/editor/site-config-panel', async () => {
  const { DirtyStateReporter } = await import('@/components/project-settings/shared');
  return {
    ConfigSectionList: ({ onSelect }: { onSelect: (section: 'branding' | 'redirects') => void }) => (
      <>
        <button onClick={() => onSelect('redirects')} type="button">
          Choose Redirects
        </button>
        <button onClick={() => onSelect('branding')} type="button">
          Choose Branding
        </button>
      </>
    ),
    ConfigSection: ({ section }: { section: string }) => (
      <div data-testid="appearance-subsection">
        {section}
        <DirtyStateReporter dirty={mocks.dirty} />
      </div>
    ),
  };
});
vi.mock('@/hooks/api', () => ({
  useProject: mocks.project,
  useProjectMembers: mocks.members,
  useOrganizationOfProject: () => ({ organization: { id: 'org-1', slug: 'acme', name: 'Acme Docs', logo: null, orgRole: mocks.orgRole } }),
}));
vi.mock('@/hooks/api/query-options', () =>
  Object.fromEntries(
    [
      'branches',
      'deployments',
      'project',
      'projectMembers',
      'domains',
      'languages',
      'projectAddons',
      'openApiConfiguration',
      'projectUsage',
      'workspaceSettings',
      'gitWorkflow',
      'readerAccess',
      'pages',
      'listExportRuns',
      'listExportSchedules',
      'apiKeys',
      'connectedApps',
      'integrations',
    ].map((name) => [`${name}QueryOptions`, (id: string) => ({ queryKey: [name, id] })]),
  ),
);
vi.mock('@/integrations/tanstack-query/query-client', () => ({ prefetchRouteData: mocks.prefetch }));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'user-1' } }, isPending: false }) }));
vi.mock('@/components/project-settings/addons-section', () => ({ AddonsSection: () => null }));
vi.mock('@/components/project-settings/authentication-section', () => ({ AuthenticationSection: () => null }));
vi.mock('@/components/project-settings/danger-section', () => ({ DangerSection: () => <div data-testid="danger-settings" /> }));
vi.mock('@/components/project-settings/domain-section', () => ({
  // Its heading mounts only after its data "loads", as real sections do.
  DomainSection: () => {
    const [ready, setReady] = useState(false);
    useEffect(() => {
      const id = setTimeout(() => setReady(true), 20);
      return () => clearTimeout(id);
    }, []);
    return ready ? <h1>Custom domain</h1> : <p>loading</p>;
  },
}));
vi.mock('@/components/project-settings/exports-section', () => ({ ExportsSection: () => null }));
vi.mock('@/components/project-settings/general-section', async () => {
  const { DirtyStateReporter } = await import('@/components/project-settings/shared');
  return {
    // Holds its own draft, as the real form does: a remount starts it afresh.
    GeneralSection: () => {
      const [edited, setEdited] = useState(false);
      return (
        <div data-edited={String(edited)} data-testid="general-settings">
          <h1>General</h1>
          <button onClick={() => setEdited(true)} type="button">
            Edit name
          </button>
          <DirtyStateReporter dirty={edited || mocks.dirty} />
        </div>
      );
    },
  };
});
vi.mock('@/components/project-settings/languages-section', () => ({
  LanguagesSection: () => (
    <div data-testid="language-settings">
      <h1>Languages</h1>
    </div>
  ),
}));
vi.mock('@/features/people/components/site-team-page', () => ({ SiteTeamPage: () => null }));
vi.mock('@/components/project-settings/openapi-section', () => ({ OpenApiSection: () => null }));
vi.mock('@/components/project-settings/search-section', () => ({ SearchSection: () => null }));
vi.mock('@/components/project-settings/smart-ai-section', () => ({ SmartAiSection: () => <div data-testid="smart-ai-settings" /> }));
vi.mock('@/components/settings/api-keys-tab', () => ({ ApiKeysTab: () => null }));
vi.mock('@/components/settings/git-tab', () => ({ GitTab: () => null }));
vi.mock('@/components/settings/import-tab', () => ({ ImportTab: () => null }));
vi.mock('@/components/settings/integrations-tab', () => ({ IntegrationsTab: () => null }));
vi.mock('@/components/settings/usage-tab', () => ({
  UsageTab: ({ organization }: { organization?: { canManage: boolean } }) => (
    <div data-can-manage={String(organization?.canManage)} data-testid="usage-settings" />
  ),
}));

import { Route } from './settings';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const SettingsPage = Route.options.component as unknown as ComponentType;

describe('site settings permissions', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.project.mockReturnValue({ data: { id: 'project-1', name: 'Docs' }, isPending: false });
    mocks.section = 'general';
    mocks.appearanceSection = undefined;
    mocks.dirty = false;
    mocks.orgRole = 'member';
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'member' }] }, isPending: false });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('shows an accessible skeleton while settings permissions load', async () => {
    mocks.members.mockReturnValue({ isPending: true });
    await act(async () => root.render(<SettingsPage />));
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('common.loading');
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(3);
  });

  it('sends an old Appearance → Redirects link to the Redirects page and ignores unsupported subsections', () => {
    const validate = Route.options.validateSearch as (search: Record<string, unknown>) => Record<string, unknown>;
    expect(validate({ section: 'appearance', appearanceSection: 'redirects' })).toEqual({ section: 'redirects' });
    expect(validate({ section: 'appearance', appearanceSection: 'navbar' })).toEqual({ section: 'appearance', appearanceSection: 'navbar' });
    expect(validate({ section: 'appearance', appearanceSection: 'arbitrary' })).toEqual({ section: 'appearance' });
    expect(validate({ section: 'general', appearanceSection: 'redirects' })).toEqual({ section: 'general' });
  });

  it('opens an Appearance subsection for an Admin, including a deep link after Appearance is mounted', async () => {
    mocks.section = 'appearance';
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'admin' }] }, isPending: false });
    await act(async () => root.render(<SettingsPage />));
    expect(container.querySelector('[data-testid="appearance-subsection"]')?.textContent).toBe('branding');
    mocks.appearanceSection = 'navbar';
    await act(async () => root.render(<SettingsPage />));
    expect(container.querySelector('[data-testid="appearance-subsection"]')?.textContent).toBe('navbar');
  });

  it.each(['seo', 'redirects', 'variables'])('gives %s a page of its own for an Admin', async (section) => {
    mocks.section = section;
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'admin' }] }, isPending: false });
    await act(async () => root.render(<SettingsPage />));
    expect(container.querySelector('[data-testid="appearance-subsection"]')?.textContent).toBe(section);
    // A page, not a subsection: no Appearance list above it.
    expect(container.textContent).not.toContain('Choose Branding');
    expect(container.querySelector(`nav a[href$="?section=${section}"]`)?.getAttribute('aria-current')).toBe('page');
  });

  it('keeps the subsection URL current and preserves the unsaved-change guard', async () => {
    mocks.section = 'appearance';
    mocks.appearanceSection = 'navbar';
    mocks.dirty = true;
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'admin' }] }, isPending: false });
    await act(async () => root.render(<SettingsPage />));
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Choose Branding')?.click());
    expect(mocks.navigate).toHaveBeenCalledWith({ search: { section: 'appearance', appearanceSection: 'branding' } });
    const blocker = mocks.blocker.mock.lastCall?.[0];
    expect(blocker.enableBeforeUnload()).toBe(true);
    mocks.confirm.mockResolvedValueOnce(false);
    await expect(blocker.shouldBlockFn()).resolves.toBe(true);
    expect(container.querySelector('[data-testid="appearance-subsection"]')?.textContent).toBe('navbar');
    mocks.confirm.mockResolvedValueOnce(true);
    await expect(blocker.shouldBlockFn()).resolves.toBe(false);
    mocks.appearanceSection = 'branding';
    await act(async () => root.render(<SettingsPage />));
    expect(container.querySelector('[data-testid="appearance-subsection"]')?.textContent).toBe('branding');
  });

  it('keeps Appearance restricted to Admins when an Editor follows a subsection deep link', async () => {
    mocks.section = 'appearance';
    mocks.appearanceSection = 'navbar';
    await act(async () => root.render(<SettingsPage />));
    expect(container.querySelector('[data-testid="appearance-subsection"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('settings.permissions.title');
  });

  it('keeps loaded settings visible during background refresh', async () => {
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'admin' }] }, isPending: false, isFetching: true });
    mocks.project.mockReturnValue({ data: { id: 'project-1', name: 'Docs' }, isPending: false, isFetching: true });
    await act(async () => root.render(<SettingsPage />));
    expect(container.querySelector('[data-testid="general-settings"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
  });

  it.each([
    { role: 'admin', section: 'general', testId: 'general-settings' },
    { role: 'member', section: 'languages', testId: 'language-settings' },
  ])('keeps cached $role settings mounted when a member refetch fails', async ({ role, section, testId }) => {
    const data = { members: [{ user: { id: 'user-1' }, role }] };
    mocks.section = section;
    mocks.members.mockReturnValue({ data, isPending: false });
    await act(async () => root.render(<SettingsPage />));
    const form = container.querySelector(`[data-testid="${testId}"]`);
    expect(form).not.toBeNull();
    mocks.members.mockReturnValue({ data, isPending: false, isError: true });
    await act(async () => root.render(<SettingsPage />));
    expect(container.querySelector(`[data-testid="${testId}"]`)).toBe(form);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("uses cached editor permissions to open the editor's first page on the default entry, even after a background member failure", async () => {
    mocks.section = undefined;
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'member' }] }, isPending: false, isError: true });
    await act(async () => root.render(<SettingsPage />));
    expect(container.querySelector('[data-testid="language-settings"]')).not.toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('prefetches site, permissions and the selected domain section', () => {
    const queryClient = {};
    const loader = Route.options.loader as unknown as (args: unknown) => void;
    loader({ context: { queryClient }, params: { projectId: 'project-1' }, deps: { section: 'domain' } });
    expect(mocks.prefetch.mock.calls).toEqual([
      [queryClient, { queryKey: ['project', 'project-1'] }],
      [queryClient, { queryKey: ['projectMembers', 'project-1'] }],
      [queryClient, { queryKey: ['domains', 'project-1'] }],
    ]);
  });

  it("opens the editor's first permitted page on the default entry, without a redirect", async () => {
    mocks.section = undefined;
    await act(async () => root.render(<SettingsPage />));
    expect(container.querySelector('[data-testid="language-settings"]')).not.toBeNull();
    expect(container.querySelector('nav a[href$="?section=languages"]')?.getAttribute('aria-current')).toBe('page');
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('settings.permissions.title');
  });

  it('shows the list of pages on a phone when no page is chosen, and each page links back to it', async () => {
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'admin' }] }, isPending: false });
    mocks.section = undefined;
    await act(async () => root.render(<SettingsPage />));
    const navColumn = () => container.querySelector('nav')?.parentElement;
    const content = container.querySelector('[data-testid="general-settings"]')?.closest('[tabindex="-1"]');
    // Below md the list is the page and the content waits; from md both show.
    expect(navColumn()?.classList.contains('hidden')).toBe(false);
    expect(content?.className).toContain('hidden md:block');

    mocks.section = 'general';
    await act(async () => root.render(<SettingsPage />));
    expect(navColumn()?.className).toContain('hidden md:block');
    const back = [...container.querySelectorAll('a')].find((link) => link.textContent === 'settings.backToAll');
    expect(back?.getAttribute('href')).toBe('/app/projects/project-1/settings');
    expect(back?.className).toContain('md:hidden');
  });

  it('labels the nav, and makes every item a link to its page', async () => {
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'admin' }] }, isPending: false });
    await act(async () => root.render(<SettingsPage />));
    const nav = container.querySelector('nav');
    expect(nav?.getAttribute('aria-label')).toBe('settings.title');
    expect(nav?.querySelectorAll('button')).toHaveLength(0);
    expect(nav?.querySelector('a[href$="?section=general"]')?.getAttribute('aria-current')).toBe('page');
    expect(nav?.querySelector('a[href$="?section=domain"]')?.hasAttribute('aria-current')).toBe(false);
    // One scroll: the page scrolls, and the nav stays put below the site header.
    expect(container.innerHTML).not.toContain('h-[calc(100vh');
    expect(nav?.className).toContain('md:sticky');
  });

  // Council #456: Back to the list only hid the page, so a discarded draft stayed mounted.
  it('starts a page afresh after leaving it for the list, so a discarded draft is gone', async () => {
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'admin' }] }, isPending: false });
    await act(async () => root.render(<SettingsPage />));
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Edit name')?.click());
    expect(container.querySelector('[data-testid="general-settings"]')?.getAttribute('data-edited')).toBe('true');
    const blocker = () => mocks.blocker.mock.lastCall?.[0];
    expect(blocker().enableBeforeUnload()).toBe(true);

    // The guard asks on the way out; "Keep editing" stays, with the edit.
    mocks.confirm.mockResolvedValueOnce(false);
    await expect(blocker().shouldBlockFn()).resolves.toBe(true);
    expect(container.querySelector('[data-testid="general-settings"]')?.getAttribute('data-edited')).toBe('true');

    // "Discard" lets the Back link through to the list: the draft and the guard are gone.
    mocks.confirm.mockResolvedValueOnce(true);
    await expect(blocker().shouldBlockFn()).resolves.toBe(false);
    mocks.section = undefined;
    await act(async () => root.render(<SettingsPage />));
    expect(container.querySelector('[data-testid="general-settings"]')?.getAttribute('data-edited')).toBe('false');
    expect(blocker().enableBeforeUnload()).toBe(false);
  });

  it("starts an Editor's default page afresh too (Languages)", async () => {
    mocks.section = 'languages';
    await act(async () => root.render(<SettingsPage />));
    const before = container.querySelector('[data-testid="language-settings"]');
    mocks.section = undefined;
    await act(async () => root.render(<SettingsPage />));
    // Same page on a wide screen, but a new instance.
    expect(container.querySelector('[data-testid="language-settings"]')).not.toBe(before);
  });

  // Council #456: focus followed the resolved section, not navigation.
  it('leaves focus alone on a cold default entry while permissions resolve', async () => {
    mocks.section = undefined;
    mocks.members.mockReturnValue({ isPending: true });
    await act(async () => root.render(<SettingsPage />));
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'member' }] }, isPending: false });
    await act(async () => root.render(<SettingsPage />));
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'admin' }] }, isPending: false });
    await act(async () => root.render(<SettingsPage />));
    expect(document.activeElement).toBe(document.body);
  });

  it('focuses the page heading when opened from the list, and the list heading on the way back', async () => {
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'admin' }] }, isPending: false });
    mocks.section = undefined;
    await act(async () => root.render(<SettingsPage />));
    expect(document.activeElement).toBe(document.body);
    // General is the default page as well, so the section is the same; only the place changes.
    mocks.section = 'general';
    await act(async () => root.render(<SettingsPage />));
    expect(document.activeElement).toBe(container.querySelector('[data-testid="general-settings"] h1'));
    mocks.section = undefined;
    await act(async () => root.render(<SettingsPage />));
    expect(document.activeElement).toBe(container.querySelector('nav h2'));
  });

  it('waits for a page heading that mounts after its data loads', async () => {
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'admin' }] }, isPending: false });
    await act(async () => root.render(<SettingsPage />));
    mocks.section = 'domain';
    await act(async () => root.render(<SettingsPage />));
    expect(document.activeElement).toBe(document.body);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
    expect(document.activeElement?.textContent).toBe('Custom domain');
  });

  it("tells a site-only Admin that deleting is the organization's call", async () => {
    mocks.section = 'danger';
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'admin' }] }, isPending: false });
    await act(async () => root.render(<SettingsPage />));
    expect(container.querySelector('[data-testid="danger-settings"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('settings.permissions.dangerBody');
    expect(container.querySelector('[role="status"]')?.textContent).not.toContain('settings.permissions.body');
  });

  it.each([
    ['general', 'wide'],
    ['languages', 'default'],
  ])('lays %s out in the %s page column', async (section, width) => {
    mocks.section = section;
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'admin' }] }, isPending: false });
    await act(async () => root.render(<SettingsPage />));
    expect(container.querySelector('[data-slot="page-container"]')?.getAttribute('data-width')).toBe(width);
  });

  it("moves focus to the new page's heading when the page changes", async () => {
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'admin' }] }, isPending: false });
    await act(async () => root.render(<SettingsPage />));
    expect(document.activeElement).toBe(document.body);
    mocks.section = 'languages';
    await act(async () => root.render(<SettingsPage />));
    const heading = container.querySelector('[data-testid="language-settings"] h1');
    expect(document.activeElement).toBe(heading);
    expect(heading?.getAttribute('tabindex')).toBe('-1');
  });

  it.each(['general', 'danger', 'smartAi'])('explains an explicit restricted %s link without redirecting', async (section) => {
    mocks.section = section;
    await act(async () => root.render(<SettingsPage />));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(container.textContent).toContain('settings.permissions.title');
    // Deleting the website is the organization's call, so its denial says so.
    expect(container.textContent).toContain(section === 'danger' ? 'settings.permissions.dangerBody' : 'settings.permissions.body');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('settings.languages');
    expect(
      container.querySelector('[data-testid="general-settings"], [data-testid="danger-settings"], [data-testid="smart-ai-settings"]'),
    ).toBeNull();
  });

  it('keeps the distinction between absent and explicitly requested sections in search validation', () => {
    const validate = Route.options.validateSearch as (search: Record<string, unknown>) => { section?: string };
    expect(validate({})).toEqual({ section: undefined });
    expect(validate({ section: 'general' })).toEqual({ section: 'general' });
    expect(validate({ section: 'analytics' })).toEqual({ section: 'integrations' });
  });

  it('does not redirect while membership is unknown or its request failed', async () => {
    mocks.members.mockReturnValue({ isPending: true });
    await act(async () => root.render(<SettingsPage />));
    expect(mocks.navigate).not.toHaveBeenCalled();
    mocks.members.mockReturnValue({ isPending: false, isError: true, refetch: mocks.refetch });
    await act(async () => root.render(<SettingsPage />));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it.each([
    { section: 'danger', testId: 'danger-settings' },
    { section: 'smartAi', testId: 'smart-ai-settings' },
  ])('explains a restricted $section direct link and provides working alternatives to an editor', async ({ section, testId }) => {
    mocks.section = section;
    await act(async () => root.render(<SettingsPage />));

    expect(container.querySelector(`[data-testid="${testId}"]`)).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('settings.permissions.title');
    expect(container.querySelector('nav')?.textContent).not.toContain(`settings.${section}`);
    expect(container.querySelector('a[href="/app/projects/project-1/editor"]')).not.toBeNull();
    const firstAllowed = container.querySelector<HTMLAnchorElement>('[role="status"] a[href="/app/projects/project-1/settings?section=languages"]');
    expect(firstAllowed?.textContent).toBe('settings.languages');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('lets an editor manage content languages', async () => {
    mocks.section = 'languages';
    await act(async () => root.render(<SettingsPage />));

    expect(container.querySelector('[data-testid="language-settings"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it.each([
    { section: 'general', testId: 'general-settings' },
    { section: 'smartAi', testId: 'smart-ai-settings' },
  ])('keeps $section settings available to a site administrator', async ({ section, testId }) => {
    mocks.section = section;
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'admin' }] }, isPending: false });
    await act(async () => root.render(<SettingsPage />));

    expect(container.querySelector(`[data-testid="${testId}"]`)).not.toBeNull();
    // Deleting the website is for the organization's Owner/Admin only (§4.2), not a site Admin.
    expect(container.querySelector('nav')?.textContent).not.toContain('settings.danger');
  });

  it.each(['owner', 'admin'] as const)('offers the Danger zone to an organization %s', async (orgRole) => {
    mocks.orgRole = orgRole;
    mocks.section = 'danger';
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: orgRole }] }, isPending: false });
    await act(async () => root.render(<SettingsPage />));
    expect(container.querySelector('nav')?.textContent).toContain('settings.danger');
    expect(container.querySelector('[data-testid="danger-settings"]')).not.toBeNull();
  });

  it('groups pages as Website, Content, Publishing, AI, Team and Usage, with the Danger zone last', async () => {
    mocks.orgRole = 'owner';
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'owner' }] }, isPending: false });
    await act(async () => root.render(<SettingsPage />));
    const nav = container.querySelector('nav')?.textContent ?? '';
    const order = [
      'settings.group.website',
      'settings.group.content',
      'settings.group.publishing',
      'settings.group.ai',
      'settings.group.team',
      'settings.group.usage',
      'settings.danger',
    ].map((key) => nav.indexOf(key));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(nav).not.toContain('settings.group.advanced');
    // Plan and Notifications moved to the organization and Account.
    expect(nav).not.toContain('settings.plan');
    expect(nav).not.toContain('settings.notifications');
  });

  it.each(['plan', 'notifications'])('turns an old ?section=%s link into a pointer above Usage', async (section) => {
    mocks.section = section;
    await act(async () => root.render(<SettingsPage />));
    expect(container.querySelector(`[data-moved-section="${section}"]`)).not.toBeNull();
    expect(container.querySelector('[data-testid="usage-settings"]')).not.toBeNull();
  });

  it.each([
    ['member', 'false'],
    ['admin', 'true'],
  ] as const)('links billing from website usage only for org Owner/Admin (%s)', async (orgRole, canManage) => {
    mocks.orgRole = orgRole;
    mocks.section = 'usage';
    await act(async () => root.render(<SettingsPage />));
    expect(container.querySelector('[data-testid="usage-settings"]')?.getAttribute('data-can-manage')).toBe(canManage);
  });

  it('blocks dirty navigation when editing is kept and permits explicit discard', async () => {
    mocks.dirty = true;
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'admin' }] }, isPending: false });
    await act(async () => root.render(<SettingsPage />));
    const blocker = mocks.blocker.mock.lastCall?.[0];
    expect(blocker.enableBeforeUnload()).toBe(true);
    mocks.confirm.mockResolvedValueOnce(false);
    await expect(blocker.shouldBlockFn()).resolves.toBe(true);
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ cancelLabel: 'settings.unsaved.keep', destructive: true }));
    mocks.confirm.mockResolvedValueOnce(true);
    await expect(blocker.shouldBlockFn()).resolves.toBe(false);
  });

  it('clears the unload guard synchronously before a successful email reload', async () => {
    mocks.dirty = true;
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'admin' }] }, isPending: false });
    await act(async () => root.render(<SettingsPage />));
    expect(mocks.blocker.mock.lastCall?.[0].enableBeforeUnload()).toBe(true);
    const installedUnloadGuard = mocks.blocker.mock.lastCall?.[0].enableBeforeUnload;
    act(() => {
      mocks.dirty = false;
      flushSync(() => root.render(<SettingsPage />));
      // The reload runs here, with no passive-effect tick or await in between.
      expect(installedUnloadGuard()).toBe(false);
    });
  });

  it('offers recovery when permission lookup fails instead of mounting editable settings', async () => {
    mocks.members.mockReturnValue({ isPending: false, isError: true, refetch: mocks.refetch });
    await act(async () => root.render(<SettingsPage />));

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="general-settings"]')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});

describe('site settings data loading', () => {
  type Loader = (args: { context: { queryClient: unknown }; deps: { section: string }; params: { projectId: string } }) => void;
  const loader = Route.options.loader as unknown as Loader;
  const loaderDeps = Route.options.loaderDeps as unknown as (args: { search: { section: string } }) => { section: string };

  it('prefetches AI assistant keys and connected apps for that section', () => {
    const queryClient = {};
    mocks.prefetch.mockClear();
    expect(loaderDeps({ search: { section: 'apiKeys' } })).toEqual({ section: 'apiKeys' });
    loader({ context: { queryClient }, deps: { section: 'apiKeys' }, params: { projectId: 'project-1' } });
    expect(mocks.prefetch.mock.calls).toEqual([
      [queryClient, { queryKey: ['project', 'project-1'] }],
      [queryClient, { queryKey: ['projectMembers', 'project-1'] }],
      [queryClient, { queryKey: ['apiKeys', 'project-1'] }],
      [queryClient, { queryKey: ['connectedApps', 'project-1'] }],
    ]);
  });
});
