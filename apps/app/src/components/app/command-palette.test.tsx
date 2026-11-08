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
}));

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => mocks.t }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useRouterState: ({ select }: { select: (state: { matches: Array<{ params: unknown }> }) => unknown }) =>
    select({ matches: [{ params: {} }, { params: mocks.params }] }),
}));
vi.mock('@/hooks/api', () => ({ useProjects: mocks.useProjects, usePages: mocks.usePages }));
vi.mock('@/components/interface-language-dialog', () => ({ InterfaceLanguageDialog: () => null }));

import { CommandPalette } from './command-palette';

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
      { id: 'project-1', name: 'Nibleaf Docs' },
      { id: 'project-2', name: 'دليل المنتج' },
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

const itemLabels = () => [...document.querySelectorAll('[data-slot="command-item"]')].map((node) => node.textContent?.trim());

describe('CommandPalette', () => {
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
      'command.allProjects',
      'nav.sites',
      'command.analytics',
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
      'command.allProjects': 'كل المشاريع',
      'nav.sites': 'المواقع',
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

  it('offers common actions everywhere', async () => {
    await render(true);
    for (const key of ['dashboard.newProject', 'account.language', 'account.darkMode']) {
      expect(itemLabels()).toContain(key);
    }
    // Outside a site there is no page list and no per-site invite shortcut.
    expect(mocks.usePages).toHaveBeenCalledWith(undefined);
    expect(itemLabels()).not.toContain('command.invite');
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
