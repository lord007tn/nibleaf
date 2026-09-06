/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useProjects: vi.fn(),
  t: vi.fn((key: string) => key),
}));

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => mocks.t }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/hooks/api', () => ({ useProjects: mocks.useProjects }));

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
});
