// @vitest-environment jsdom

import { act, type ComponentType, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  members: vi.fn(),
  project: vi.fn(),
  prefetch: vi.fn(),
  section: 'general' as string | undefined,
  appearanceSection: undefined as 'branding' | 'redirects' | undefined,
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
  Link: ({ children, to, search }: { children: ReactNode; to: string; search?: { section?: string } }) => (
    <a href={`${to.replace('$projectId', 'project-1')}${search?.section ? `?section=${search.section}` : ''}`}>{children}</a>
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
vi.mock('@/components/project-settings/domain-section', () => ({ DomainSection: () => null }));
vi.mock('@/components/project-settings/exports-section', () => ({ ExportsSection: () => null }));
vi.mock('@/components/project-settings/general-section', async () => {
  const { DirtyStateReporter } = await import('@/components/project-settings/shared');
  return {
    GeneralSection: () => (
      <div data-testid="general-settings">
        <DirtyStateReporter dirty={mocks.dirty} />
      </div>
    ),
  };
});
vi.mock('@/components/project-settings/languages-section', () => ({ LanguagesSection: () => <div data-testid="language-settings" /> }));
vi.mock('@/components/project-settings/members-section', () => ({ MembersSection: () => null }));
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

  it('validates the redirects deep link and ignores unsupported subsections', () => {
    const validate = Route.options.validateSearch as (search: Record<string, unknown>) => Record<string, unknown>;
    expect(validate({ section: 'appearance', appearanceSection: 'redirects' })).toEqual({ section: 'appearance', appearanceSection: 'redirects' });
    expect(validate({ section: 'appearance', appearanceSection: 'arbitrary' })).toEqual({ section: 'appearance' });
    expect(validate({ section: 'general', appearanceSection: 'redirects' })).toEqual({ section: 'general' });
  });

  it('opens Redirects for an Admin, including a deep link after Appearance is mounted', async () => {
    mocks.section = 'appearance';
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'admin' }] }, isPending: false });
    await act(async () => root.render(<SettingsPage />));
    expect(container.querySelector('[data-testid="appearance-subsection"]')?.textContent).toBe('branding');
    mocks.appearanceSection = 'redirects';
    await act(async () => root.render(<SettingsPage />));
    expect(container.querySelector('[data-testid="appearance-subsection"]')?.textContent).toBe('redirects');
  });

  it('keeps the subsection URL current and preserves the unsaved-change guard', async () => {
    mocks.section = 'appearance';
    mocks.appearanceSection = 'redirects';
    mocks.dirty = true;
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'admin' }] }, isPending: false });
    await act(async () => root.render(<SettingsPage />));
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Choose Branding')?.click());
    expect(mocks.navigate).toHaveBeenCalledWith({ search: { section: 'appearance', appearanceSection: 'branding' } });
    const blocker = mocks.blocker.mock.lastCall?.[0];
    expect(blocker.enableBeforeUnload()).toBe(true);
    mocks.confirm.mockResolvedValueOnce(false);
    await expect(blocker.shouldBlockFn()).resolves.toBe(true);
    expect(container.querySelector('[data-testid="appearance-subsection"]')?.textContent).toBe('redirects');
    mocks.confirm.mockResolvedValueOnce(true);
    await expect(blocker.shouldBlockFn()).resolves.toBe(false);
    mocks.appearanceSection = 'branding';
    await act(async () => root.render(<SettingsPage />));
    expect(container.querySelector('[data-testid="appearance-subsection"]')?.textContent).toBe('branding');
  });

  it('keeps Appearance restricted to Admins when an Editor follows a subsection deep link', async () => {
    mocks.section = 'appearance';
    mocks.appearanceSection = 'redirects';
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

  it('uses cached editor permissions to redirect the default entry even after a background member failure', async () => {
    mocks.section = undefined;
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'member' }] }, isPending: false, isError: true });
    await act(async () => root.render(<SettingsPage />));
    expect(mocks.navigate).toHaveBeenCalledWith({ search: { section: 'languages' }, replace: true });
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

  it("redirects the default entry to the editor's first permitted section", async () => {
    mocks.section = undefined;
    await act(async () => root.render(<SettingsPage />));
    expect(mocks.navigate).toHaveBeenCalledWith({ search: { section: 'languages' }, replace: true });
    expect(container.textContent).not.toContain('settings.permissions.title');
  });

  it.each(['general', 'danger', 'smartAi'])('explains an explicit restricted %s link without redirecting', async (section) => {
    mocks.section = section;
    await act(async () => root.render(<SettingsPage />));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(container.textContent).toContain('settings.permissions.title');
    expect(container.textContent).toContain('settings.permissions.body');
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

  it('groups sections as Website, Publishing, Team & access, Usage and Advanced', async () => {
    mocks.orgRole = 'owner';
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'owner' }] }, isPending: false });
    await act(async () => root.render(<SettingsPage />));
    const nav = container.querySelector('nav')?.textContent ?? '';
    const order = [
      'settings.group.website',
      'settings.group.publishing',
      'settings.group.team',
      'settings.group.usage',
      'settings.group.advanced',
    ].map((key) => nav.indexOf(key));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
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
