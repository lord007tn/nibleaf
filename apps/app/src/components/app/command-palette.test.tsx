/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useProjects: vi.fn(),
  usePages: vi.fn(),
  params: {} as { projectId?: string },
  t: vi.fn((key: string) => key),
  organizations: [] as Array<{ id: string; slug: string; name: string; logo: null; orgRole: string; canCreateWebsite: boolean }>,
  openSwitcher: vi.fn(),
  openCreateOrganization: vi.fn(),
}));

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => mocks.t }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useRouterState: ({ select }: { select: (state: { matches: Array<{ params: unknown }> }) => unknown }) =>
    select({ matches: [{ params: {} }, { params: mocks.params }] }),
}));
// The palette is scoped to the current org: its websites come from the switcher's per-org list.
vi.mock('@/hooks/api', () => ({
  useOrganizationSwitcherProjects: mocks.useProjects,
  usePages: mocks.usePages,
  useSwitcher: () => ({ data: { organizations: mocks.organizations } }),
}));
vi.mock('./org-switcher/switcher-context', () => ({
  useSwitcherControls: () => ({
    current: { organizationId: 'org-1' },
    openSwitcher: mocks.openSwitcher,
    openCreateOrganization: mocks.openCreateOrganization,
  }),
}));
vi.mock('@/components/interface-language-dialog', () => ({ InterfaceLanguageDialog: () => null }));

import { contiguousFirstFilter } from '@nibleaf/design-system/components/ui/command';
import { CommandPalette, CommandPaletteProvider } from './command-palette';
import { ShellSearchButton } from './shell-search-button';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const roots: Array<ReturnType<typeof createRoot>> = [];

/** Base UI's dialog popup and cmdk's list rely on browser APIs jsdom does not implement. */
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  mocks.t.mockImplementation((key: string) => key);
  mocks.params = {};
  mocks.organizations = [
    { id: 'org-1', slug: 'acme', name: 'Acme Docs', logo: null, orgRole: 'owner', canCreateWebsite: true },
    { id: 'org-2', slug: 'joodpms', name: 'JOODPMS', logo: null, orgRole: 'member', canCreateWebsite: false },
  ];
  mocks.usePages.mockImplementation((projectId?: string) => ({
    data: projectId
      ? [
          { id: 'page-1', kind: 'PAGE', title: 'Reset your password', slug: 'reset', updatedAt: '2026-11-01T00:00:00.000Z' },
          { id: 'group-1', kind: 'GROUP', title: 'Account', slug: 'account', updatedAt: '2026-11-02T00:00:00.000Z' },
        ]
      : undefined,
  }));
  mocks.useProjects.mockReturnValue({
    data: [
      { id: 'project-1', name: 'Nibleaf Docs', role: 'owner' },
      { id: 'project-2', name: 'دليل المنتج', role: 'owner' },
    ],
  });
});

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount());
  }
  document.body.replaceChildren();
  vi.clearAllMocks();
});

async function render(open: boolean, onOpenChange = vi.fn()) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<CommandPalette open={open} onOpenChange={onOpenChange} />));
  return onOpenChange;
}

const pressCtrlK = () =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
  });

/** Type into a React-controlled input: set the value through the prototype setter
 *  (so React's value tracker notices) and fire the `input` event it listens to. */
const typeInto = (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

const input = () => document.querySelector<HTMLInputElement>('[data-slot="command-input"]') as HTMLInputElement;
const visibleGroups = () =>
  [...document.querySelectorAll<HTMLElement>('[cmdk-group]')].filter((node) => !node.hidden).map((node) => node.getAttribute('data-value') ?? '');
const press = (key: string) =>
  act(async () => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
/** The accessible name per accname: aria-labelledby (text of each referenced
 *  element) wins over aria-label, which wins over nothing. */
const accessibleName = (element: Element) => {
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy)
    return labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .join(' ')
      .trim();
  return element.getAttribute('aria-label')?.trim() ?? '';
};

const itemLabels = () => [...document.querySelectorAll('[data-slot="command-item"]')].map((node) => node.textContent?.trim());

describe('CommandPalette', () => {
  it('opens the app-wide palette from the separate shell search button', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <CommandPaletteProvider>
          <ShellSearchButton />
        </CommandPaletteProvider>,
      ),
    );
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="dashboard.search.placeholder"]');
    expect(trigger).not.toBeNull();
    await act(async () => trigger?.click());
    expect(document.querySelector('[data-slot="dialog-content"]')?.textContent).toContain('Nibleaf Docs');
  });

  it('opens inside a cmdk root and lists projects plus the go-to shortcuts', async () => {
    await render(true);

    const dialog = document.querySelector('[data-slot="dialog-content"]');
    expect(dialog).not.toBeNull();
    // The dialog must be labelled from inside the popup (sr-only header inside DialogContent).
    expect(dialog?.querySelector('[data-slot="dialog-title"]')).not.toBeNull();
    // Every command part renders inside the cmdk root, otherwise cmdk throws on a missing store.
    const commandRoot = dialog?.querySelector('[data-slot="command"]');
    expect(commandRoot).not.toBeNull();
    expect(commandRoot?.querySelector('[data-slot="command-input"]')).not.toBeNull();
    expect(commandRoot?.querySelector('[data-slot="command-list"]')).not.toBeNull();

    const text = dialog?.textContent ?? '';
    expect(text).toContain('Nibleaf Docs');
    expect(text).toContain('دليل المنتج');
    for (const key of [
      'command.group.projects',
      'command.group.goTo',
      'nav.websites',
      'command.analytics',
      'nav.members',
      'nav.billing',
      'command.organizationSettings',
      'command.accountSettings',
    ]) {
      expect(text).toContain(key);
    }
  });

  it('marks project names as auto-directional so Arabic and Latin titles align correctly', async () => {
    await render(true);

    const names = [...document.querySelectorAll('[data-slot="command-item"] [dir="auto"]')].map((node) => node.textContent);
    expect(names).toEqual(['Nibleaf Docs', 'دليل المنتج']);
  });

  it('finds go-to shortcuts by their localized label, not only the English value', async () => {
    const arabic: Record<string, string> = {
      'nav.websites': 'المواقع',
      'command.analytics': 'التحليلات',
      'command.accountSettings': 'إعدادات الحساب',
    };
    mocks.t.mockImplementation((key: string) => arabic[key] ?? key);
    await render(true);
    const input = document.querySelector<HTMLInputElement>('[data-slot="command-input"]');
    expect(input).not.toBeNull();

    await typeInto(input as HTMLInputElement, 'المواقع');

    expect(itemLabels()).toContain('المواقع');
    expect(itemLabels()).not.toContain('التحليلات');
    expect(document.body.textContent).not.toContain('command.noResults');
  });

  it('navigates to the selected project and closes the palette', async () => {
    const onOpenChange = await render(true);
    const item = [...document.querySelectorAll<HTMLElement>('[data-slot="command-item"]')].find((node) => node.textContent?.includes('Nibleaf Docs'));

    await act(async () => item?.click());

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/projects/$projectId', params: { projectId: 'project-1' } });
  });

  it('toggles with Ctrl/⌘+K from anywhere in the dashboard', async () => {
    const onOpenChange = await render(false);
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();

    await pressCtrlK();
    expect(onOpenChange).toHaveBeenCalledWith(true);

    // The app mounts a single palette; drop the closed one before mounting an open one.
    for (const root of roots.splice(0)) {
      await act(async () => root.unmount());
    }
    const closeHandler = await render(true);
    await pressCtrlK();
    expect(closeHandler).toHaveBeenCalledWith(false);
  });

  it('claims the shortcut so the browser does not open its own search', async () => {
    await render(false);
    const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true });

    act(() => {
      document.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
  });

  it('lists the current site pages and opens the chosen one in the editor', async () => {
    mocks.params = { projectId: 'project-1' };
    const onOpenChange = await render(true);
    expect(mocks.usePages).toHaveBeenCalledWith('project-1');
    expect(itemLabels()).toContain('Reset your password');
    expect(itemLabels()).not.toContain('Account');
    const page = [...document.querySelectorAll<HTMLElement>('[data-slot="command-item"]')].find((node) =>
      node.textContent?.includes('Reset your password'),
    );
    await act(async () => page?.click());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/app/projects/$projectId/editor',
      params: { projectId: 'project-1' },
      search: { page: 'page-1' },
    });
  });

  it('finds a site setting such as the domain and deep-links to its section', async () => {
    mocks.params = { projectId: 'project-1' };
    await render(true);
    await typeInto(document.querySelector<HTMLInputElement>('[data-slot="command-input"]') as HTMLInputElement, 'domain');
    const domain = [...document.querySelectorAll<HTMLElement>('[data-slot="command-item"]')].find((node) =>
      node.textContent?.includes('settings.domain'),
    );
    expect(domain).toBeDefined();
    await act(async () => domain?.click());
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/app/projects/$projectId/settings',
      params: { projectId: 'project-1' },
      search: { section: 'domain' },
    });
  });

  describe('production audit WORKSPACE-16', () => {
    it('gives the search input a computed accessible name (cmdk names it with aria-labelledby)', async () => {
      await render(true);
      expect(accessibleName(input())).toBe('command.searchPlaceholder');
    });

    it('lists each settings page once outside a website, not once per website', async () => {
      await render(true);
      await typeInto(document.querySelector<HTMLInputElement>('[data-slot="command-input"]') as HTMLInputElement, 'domain');
      const domains = [...document.querySelectorAll<HTMLElement>('[data-slot="command-item"]')].filter((node) =>
        node.textContent?.includes('settings.domain'),
      );
      expect(domains).toHaveLength(1);
      await act(async () => domains[0]?.click());
      expect(mocks.navigate).toHaveBeenCalledWith(expect.objectContaining({ search: { section: 'domain' } }));
    });

    it('ranks a whole-word match above letters scattered across a website name', () => {
      const setting = contiguousFirstFilter('settings project-1 domain address url web dns', 'domain', ['settings.domain', 'Nibleaf Docs']);
      const site = contiguousFirstFilter('project project-9', 'domain', ['JoodBooking Documentation', '']);
      expect(site).toBeGreaterThan(0);
      expect(setting).toBeGreaterThan(site);
    });

    it('puts Site settings above a website whose name only scatters the letters, with both groups shown', async () => {
      mocks.useProjects.mockReturnValue({ data: [{ id: 'project-3', name: 'JoodBooking Documentation', role: 'owner' }] });
      await render(true);
      await typeInto(input(), 'domain');
      const groups = visibleGroups();
      // Both match: the site fuzzily ("Do…cu…m…ent…a…t…i…o…n"), Custom domain as a whole word.
      expect(groups).toContain('projects');
      expect(groups).toContain('settings');
      expect(groups.indexOf('settings')).toBeLessThan(groups.indexOf('projects'));
      // A site-name search still leads with the site.
      await typeInto(input(), 'JoodBooking');
      expect(visibleGroups()[0]).toBe('projects');
    });

    it('selects the best match and moves the selection with Arrow, Home and End, tracked by aria-activedescendant', async () => {
      mocks.useProjects.mockReturnValue({ data: [{ id: 'project-3', name: 'JoodBooking Documentation', role: 'owner' }] });
      await render(true);
      await typeInto(input(), 'domain');
      const items = () =>
        [...document.querySelectorAll<HTMLElement>('[cmdk-item]')].filter((node) => !node.hidden && node.offsetParent !== undefined);
      const selected = () => document.querySelector<HTMLElement>('[cmdk-item][aria-selected="true"]');
      // Right after typing, not only after an arrow key (cmdk 1.1.1 lags here; CommandInput corrects it).
      expect(selected()?.textContent).toContain('settings.domain');
      expect(input().getAttribute('aria-activedescendant')).toBe(selected()?.id);
      await press('ArrowDown');
      expect(selected()?.textContent).not.toContain('settings.domain');
      expect(input().getAttribute('aria-activedescendant')).toBe(selected()?.id);
      await press('End');
      expect(selected()).toBe(items().at(-1));
      await press('Home');
      expect(selected()?.textContent).toContain('settings.domain');
      await press('Enter');
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/app/projects/$projectId/settings',
        params: { projectId: 'project-3' },
        search: { section: 'domain' },
      });
    });

    it.each(['viewer', 'member'] as const)('offers a %s only the settings they may open (Team, never General or Custom domain)', async (role) => {
      mocks.useProjects.mockReturnValue({ data: [{ id: 'project-1', name: 'Nibleaf Docs', role }] });
      await render(true);
      await typeInto(input(), 'domain');
      expect(itemLabels().some((label) => label?.includes('settings.domain'))).toBe(false);
      await typeInto(input(), 'general');
      expect(itemLabels().some((label) => label?.includes('settings.general'))).toBe(false);
      await typeInto(input(), 'team');
      expect(itemLabels().some((label) => label?.includes('settings.members'))).toBe(true);
    });

    it('finds Invite outside a website and opens the organization members', async () => {
      await render(true);
      await typeInto(document.querySelector<HTMLInputElement>('[data-slot="command-input"]') as HTMLInputElement, 'invite');
      const invite = [...document.querySelectorAll<HTMLElement>('[data-slot="command-item"]')].find(
        (node) => node.textContent?.trim() === 'command.invite',
      );
      expect(invite).toBeDefined();
      await act(async () => invite?.click());
      expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/o/$orgSlug/members', params: { orgSlug: 'acme' } });
    });
  });

  it('offers common actions everywhere', async () => {
    await render(true);
    for (const key of ['dashboard.newProject', 'account.language', 'account.darkMode']) {
      expect(itemLabels()).toContain(key);
    }
    // Outside a site there is no page list; inviting is the organization's (audit WORKSPACE-16).
    expect(mocks.usePages).toHaveBeenCalledWith(undefined);
    expect(itemLabels()).toContain('command.invite');
  });

  it('scopes go-to pages to the current organization and hides admin pages from Members', async () => {
    mocks.organizations = [{ id: 'org-1', slug: 'acme', name: 'Acme Docs', logo: null, orgRole: 'member', canCreateWebsite: false }];
    await render(true);
    expect(itemLabels()).toContain('nav.websites');
    expect(itemLabels()).not.toContain('nav.members');
    expect(itemLabels()).not.toContain('nav.billing');
    // A Member cannot create websites; one org needs no "Switch organization" list.
    expect(itemLabels()).not.toContain('dashboard.newProject');
    expect(itemLabels()).not.toContain('command.invite');
    expect(document.body.textContent).not.toContain('command.group.switchOrganization');
    const websites = [...document.querySelectorAll<HTMLElement>('[data-slot="command-item"]')].find(
      (node) => node.textContent?.trim() === 'nav.websites',
    );
    await act(async () => websites?.click());
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/o/$orgSlug/websites', params: { orgSlug: 'acme' } });
  });

  it('switches organization, opens the switcher and creates an organization', async () => {
    await render(true);
    expect(document.body.textContent).toContain('command.group.switchOrganization');
    const other = [...document.querySelectorAll<HTMLElement>('[data-slot="command-item"]')].find((node) => node.textContent?.includes('JOODPMS'));
    await act(async () => other?.click());
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/o/$orgSlug/websites', params: { orgSlug: 'joodpms' } });

    const switcher = [...document.querySelectorAll<HTMLElement>('[data-slot="command-item"]')].find(
      (node) => node.textContent?.trim() === 'command.switchOrganizationOrWebsite',
    );
    await act(async () => switcher?.click());
    expect(mocks.openSwitcher).toHaveBeenCalledWith('organization');
    const create = [...document.querySelectorAll<HTMLElement>('[data-slot="command-item"]')].find(
      (node) => node.textContent?.trim() === 'command.createOrganization',
    );
    await act(async () => create?.click());
    expect(mocks.openCreateOrganization).toHaveBeenCalledOnce();
  });

  it('opens New website in the current organization for Owner/Admin', async () => {
    await render(true);
    const create = [...document.querySelectorAll<HTMLElement>('[data-slot="command-item"]')].find(
      (node) => node.textContent?.trim() === 'dashboard.newProject',
    );
    await act(async () => create?.click());
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/o/$orgSlug/websites', params: { orgSlug: 'acme' }, search: { newSite: true } });
  });

  it('yields Ctrl/⌘+K to the page editor whatever order the listeners run in (AUTH-10)', async () => {
    const onOpenChange = await render(false);
    const page = document.createElement('div');
    page.setAttribute('data-mod-k-owner', '');
    page.setAttribute('contenteditable', 'true');
    const word = document.createElement('strong');
    page.append(word);
    document.body.append(page);
    // Not prevented by the editor first: the palette still leaves the key alone.
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      word.dispatchEvent(event);
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);

    // A read-only page does not claim the key.
    page.setAttribute('contenteditable', 'false');
    act(() => {
      word.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('leaves Ctrl/⌘+K to an IME composition', async () => {
    const onOpenChange = await render(false);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true }));
    });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('leaves Ctrl/⌘+K alone when a focused widget already handled it', async () => {
    const onOpenChange = await render(false);
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
    event.preventDefault();
    act(() => {
      document.dispatchEvent(event);
    });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it.each(['sites', 'pages'])('retries a failed %s read without reporting no results', async (scope) => {
    mocks.params = { projectId: 'project-1' };
    const refetch = vi.fn();
    const hook = scope === 'sites' ? mocks.useProjects : mocks.usePages;
    hook.mockReturnValue({ isError: true, isPending: false, refetch, isFetching: false });
    await render(true);
    await typeInto(document.querySelector<HTMLInputElement>('[data-slot="command-input"]') as HTMLInputElement, 'unmatched-query');
    expect(document.body.textContent).not.toContain('command.noResults');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(scope === 'sites' ? 'nav.sitesLoadError' : 'command.pagesLoadError');
    expect(document.querySelector('[role="alert"]')?.closest('[role="listbox"]')).toBeNull();
    await act(async () => document.querySelector<HTMLButtonElement>('[role="alert"] button')?.click());
    expect(refetch).toHaveBeenCalledOnce();

    hook.mockReturnValue({ data: [], isError: false, isPending: false });
    await act(async () => roots[0]?.render(<CommandPalette open onOpenChange={vi.fn()} />));
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.body.textContent).toContain('command.noResults');
  });

  it('keeps cached projects and pages selectable when refreshes fail', async () => {
    mocks.params = { projectId: 'project-1' };
    mocks.useProjects.mockReturnValue({ data: [{ id: 'project-1', name: 'Cached site' }], isError: true, refetch: vi.fn() });
    mocks.usePages.mockReturnValue({
      data: [{ id: 'page-1', kind: 'PAGE', title: 'Cached page', slug: 'cached-page', updatedAt: '2026-11-01' }],
      isError: true,
      refetch: vi.fn(),
    });
    await render(true);
    expect(itemLabels()).toContain('Cached site');
    expect(itemLabels()).toContain('Cached page');
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(2);
    expect(document.body.textContent).not.toContain('command.noResults');
  });
});
