// @vitest-environment jsdom

import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  members: vi.fn(),
  section: 'general',
  navigate: vi.fn(),
  refetch: vi.fn(),
  blocker: vi.fn(),
  confirm: vi.fn(),
  dirty: false,
}));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useParams: () => ({ projectId: 'project-1' }),
    useSearch: () => ({ section: mocks.section }),
  }),
  useNavigate: () => mocks.navigate,
  useBlocker: mocks.blocker,
  Link: ({ children }: { children: ReactNode }) => <a href="/app/projects/project-1/editor">{children}</a>,
}));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('@/components/editor/site-config-panel', () => ({ ConfigSectionList: () => null, ConfigSection: () => null }));
vi.mock('@/hooks/api', () => ({
  useProject: () => ({ data: { id: 'project-1', name: 'Docs' } }),
  useProjectMembers: mocks.members,
}));
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
vi.mock('@/components/project-settings/plan-section', () => ({ PlanSection: () => null }));
vi.mock('@/components/project-settings/search-section', () => ({ SearchSection: () => null }));
vi.mock('@/components/settings/api-keys-tab', () => ({ ApiKeysTab: () => null }));
vi.mock('@/components/settings/git-tab', () => ({ GitTab: () => null }));
vi.mock('@/components/settings/import-tab', () => ({ ImportTab: () => null }));
vi.mock('@/components/settings/integrations-tab', () => ({ IntegrationsTab: () => null }));
vi.mock('@/components/settings/notifications-tab', () => ({ NotificationsTab: () => null }));
vi.mock('@/components/settings/usage-tab', () => ({ UsageTab: () => null }));

import { Route } from './settings';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const SettingsPage = Route.options.component as unknown as ComponentType;

describe('site settings permissions', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.section = 'general';
    mocks.dirty = false;
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

  it('explains a restricted direct link and provides working alternatives to an editor', async () => {
    mocks.section = 'danger';
    await act(async () => root.render(<SettingsPage />));

    expect(container.querySelector('[data-testid="danger-settings"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('settings.permissions.title');
    expect(container.querySelector('nav')?.textContent).not.toContain('settings.danger');
    expect(container.querySelector('a[href="/app/projects/project-1/editor"]')).not.toBeNull();
    const usage = container.querySelector<HTMLButtonElement>('[role="status"] button');
    await act(async () => usage?.click());
    expect(mocks.navigate).toHaveBeenCalledWith({ search: { section: 'usage' }, replace: true });
  });

  it('lets an editor manage content languages', async () => {
    mocks.section = 'languages';
    await act(async () => root.render(<SettingsPage />));

    expect(container.querySelector('[data-testid="language-settings"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('keeps administrator settings available to a site administrator', async () => {
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'admin' }] }, isPending: false });
    await act(async () => root.render(<SettingsPage />));

    expect(container.querySelector('[data-testid="general-settings"]')).not.toBeNull();
    expect(container.querySelector('nav')?.textContent).toContain('settings.danger');
  });

  it('blocks dirty navigation when editing is kept and permits explicit discard', async () => {
    mocks.dirty = true;
    mocks.members.mockReturnValue({ data: { members: [{ user: { id: 'user-1' }, role: 'admin' }] }, isPending: false });
    await act(async () => root.render(<SettingsPage />));
    const blocker = mocks.blocker.mock.lastCall?.[0];
    expect(blocker.enableBeforeUnload).toBe(true);
    mocks.confirm.mockResolvedValueOnce(false);
    await expect(blocker.shouldBlockFn()).resolves.toBe(true);
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ cancelLabel: 'settings.unsaved.keep', destructive: true }));
    mocks.confirm.mockResolvedValueOnce(true);
    await expect(blocker.shouldBlockFn()).resolves.toBe(false);
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
