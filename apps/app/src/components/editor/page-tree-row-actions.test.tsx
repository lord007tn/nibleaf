/** @vitest-environment jsdom */
/**
 * AUTH-38: a page-tree row's ⋯ menu. Writers can open, share, add to, copy,
 * rename, move, hide, configure and delete a page from where it sits; Viewers
 * can only open it or copy its link. Items are grouped, Delete comes last, and
 * the menu is reachable and usable from the keyboard in both directions.
 */
import { type MessageKey, type MessageVariables, translateFn } from '@nibleaf/i18n';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageNode } from '@/hooks/api';

const translate = (key: MessageKey, variables?: MessageVariables) => translateFn(key, variables, 'en');
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => translate,
  useLocale: () => ({ locale: 'en', t: translate, setLocale: vi.fn() }),
}));

import { PageTreeDndProvider, SortablePageTree } from './sortable-page-tree';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const node = (id: string, overrides: Partial<PageNode> = {}): PageNode => ({
  id,
  parentId: null,
  languageId: 'en',
  kind: 'PAGE',
  title: id,
  slug: id,
  path: id,
  icon: null,
  description: null,
  position: 0,
  hidden: false,
  updatedAt: '2026-11-10T00:00:00Z',
  ...overrides,
});

const PAGES = [
  node('Install', { position: 0 }),
  node('Guides', { kind: 'GROUP', position: 1 }),
  node('Deploy', { parentId: 'Guides', position: 0 }),
  node('Drafts', { position: 2, hidden: true }),
];

const roots: Array<ReturnType<typeof createRoot>> = [];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = async (ms = 200) => {
  for (let elapsed = 0; elapsed < ms; elapsed += 20) await act(async () => wait(20));
};

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, writable: true, value: () => [] });
});

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

async function renderTree({ readOnly = false, creating = false, moving = false, dir = 'ltr' as 'ltr' | 'rtl', collapsedGroup = false } = {}) {
  if (collapsedGroup) localStorage.setItem('nibleaf.editor.collapsedGroups:en', JSON.stringify(['Guides']));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const actions = {
    onAddChild: vi.fn(),
    onSettings: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    onCopyLink: vi.fn(),
    onMoveTo: vi.fn(),
    onToggleHidden: vi.fn(),
  };
  await act(async () =>
    root.render(
      <PageTreeDndProvider
        pages={PAGES}
        languages={[{ id: 'en', label: 'English', collapsed: false }]}
        dir={dir}
        readOnly={readOnly}
        moving={moving}
        onMove={vi.fn()}
      >
        <SortablePageTree
          languageId="en"
          activeId="Install"
          onSelect={vi.fn()}
          {...actions}
          pageHref={(id) => `/app/projects/site/editor?page=${id}`}
          creating={creating}
        />
      </PageTreeDndProvider>,
    ),
  );
  return { container, actions };
}

const row = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[role="treeitem"][data-page-id="${id}"]`) as HTMLElement;
const trigger = (container: HTMLElement, title: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${translate('editor.pageActions', { title })}"]`) as HTMLButtonElement;

async function openMenu(container: HTMLElement, title: string) {
  await act(async () => trigger(container, title).click());
  await settle();
  return document.querySelector<HTMLElement>('[role="menu"]') as HTMLElement;
}

/** The menu as a reader of it hears it: each item's text, separators as `---`. */
const menuOutline = (menu: HTMLElement) =>
  [...menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="separator"]')].map((item) =>
    item.getAttribute('role') === 'separator' ? '---' : (item.textContent ?? '').trim(),
  );

const item = (menu: HTMLElement, label: string) => {
  const found = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((candidate) => candidate.textContent?.trim().startsWith(label));
  if (!found) throw new Error(`No "${label}" in the menu`);
  return found;
};

async function press(target: Element, key: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
  await settle(100);
}

describe('page tree row menu (AUTH-38)', () => {
  it('offers a writer every action, grouped, with Delete last', async () => {
    const { container } = await renderTree();
    const menu = await openMenu(container, 'Install');
    expect(menuOutline(menu)).toEqual([
      translate('editor.link.open'),
      translate('settings.members.copyLink'),
      '---',
      translate('editor.addPageInside'),
      translate('editor.duplicate'),
      '---',
      translate('editor.rename'),
      translate('editor.moveTo'),
      translate('editor.hideFromNav'),
      translate('editor.pageSettings.title'),
      '---',
      translate('editor.deletePage'),
    ]);
    expect(item(menu, translate('editor.deletePage')).dataset.variant).toBe('destructive');
  });

  it('opens the page in a new tab through a real link, so middle and modified clicks work', async () => {
    const { container } = await renderTree();
    const link = item(await openMenu(container, 'Install'), translate('editor.link.open'));
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/app/projects/site/editor?page=Install');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it.each([
    ['settings.members.copyLink', 'onCopyLink'],
    ['editor.addPageInside', 'onAddChild'],
    ['editor.duplicate', 'onDuplicate'],
    ['editor.moveTo', 'onMoveTo'],
    ['editor.hideFromNav', 'onToggleHidden'],
    ['editor.pageSettings.title', 'onSettings'],
    ['editor.deletePage', 'onDelete'],
  ] as const)('%s calls %s with the page', async (label, handler) => {
    const { container, actions } = await renderTree();
    const menu = await openMenu(container, 'Install');
    await act(async () => item(menu, translate(label)).click());
    expect(actions[handler]).toHaveBeenCalledExactlyOnceWith('Install');
  });

  it('offers no Copy link on a group, which has no address on the site', async () => {
    const { container } = await renderTree();
    const outline = menuOutline(await openMenu(container, 'Guides'));
    expect(outline).not.toContain(translate('settings.members.copyLink'));
    expect(outline).toContain(translate('editor.link.open'));
  });

  it('says a duplicate leaves the pages inside behind', async () => {
    const { container } = await renderTree();
    expect(menuOutline(await openMenu(container, 'Guides'))).toContain(translate('editor.duplicatePageOnly'));
  });

  it('marks a hidden page on its row and offers to show it again', async () => {
    const { container, actions } = await renderTree();
    const hidden = row(container, 'Drafts');
    expect(hidden.getAttribute('aria-label')).toBe(`Drafts, ${translate('editor.pageSettings.hidden')}`);
    expect(hidden.querySelector('[data-hidden-indicator]')?.getAttribute('title')).toBe(translate('editor.pageSettings.hidden'));
    expect(row(container, 'Install').querySelector('[data-hidden-indicator]')).toBeNull();
    const menu = await openMenu(container, 'Drafts');
    await act(async () => item(menu, translate('editor.showInNav')).click());
    expect(actions.onToggleHidden).toHaveBeenCalledWith('Drafts');
  });

  it('adding a page inside a collapsed group expands it first, so the new page shows', async () => {
    const { container, actions } = await renderTree({ collapsedGroup: true });
    expect(row(container, 'Guides').getAttribute('aria-expanded')).toBe('false');
    const menu = await openMenu(container, 'Guides');
    await act(async () => item(menu, translate('editor.addPageInside')).click());
    await settle();
    expect(actions.onAddChild).toHaveBeenCalledWith('Guides');
    expect(row(container, 'Guides').getAttribute('aria-expanded')).toBe('true');
    expect(row(container, 'Deploy')).not.toBeNull();
  });

  it.each([
    ['editor.addPageInside', false],
    ['editor.duplicate', false],
    ['settings.members.copyLink', true],
  ] as const)('after %s, focus returns to the menu button: %s', async (label, returns) => {
    // Add and Duplicate open another page whose title takes focus: a menu button
    // regaining it would take the next keystrokes (Space reopens the menu).
    const { container } = await renderTree();
    const button = trigger(container, 'Install');
    await act(async () => button.focus());
    const menu = await openMenu(container, 'Install');
    await act(async () => item(menu, translate(label)).click());
    await settle(300);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement === trigger(container, 'Install')).toBe(returns);
  });

  it('gives a Viewer only Open in new tab and Copy link', async () => {
    const { container, actions } = await renderTree({ readOnly: true });
    const menu = await openMenu(container, 'Install');
    expect(menuOutline(menu)).toEqual([translate('editor.link.open'), translate('settings.members.copyLink')]);
    await act(async () => item(menu, translate('settings.members.copyLink')).click());
    expect(actions.onCopyLink).toHaveBeenCalledWith('Install');
  });

  it('says why Duplicate and Add are unavailable while a page is being created', async () => {
    const { container, actions } = await renderTree({ creating: true });
    const menu = await openMenu(container, 'Install');
    for (const label of ['editor.duplicate', 'editor.addPageInside'] as const) {
      const disabled = item(menu, translate(label));
      expect(disabled.getAttribute('aria-disabled')).toBe('true');
      expect(disabled.textContent).toContain(translate('editor.creatingPage'));
      await act(async () => disabled.click());
    }
    expect(actions.onDuplicate).not.toHaveBeenCalled();
    expect(actions.onAddChild).not.toHaveBeenCalled();
  });

  it('says why Move to… is unavailable while another move is saving', async () => {
    const { container, actions } = await renderTree({ moving: true });
    const move = item(await openMenu(container, 'Install'), translate('editor.moveTo'));
    expect(move.getAttribute('aria-disabled')).toBe('true');
    expect(move.textContent).toContain(translate('editor.tree.moveBusy'));
    await act(async () => move.click());
    expect(actions.onMoveTo).not.toHaveBeenCalled();
  });

  it.each(['ltr', 'rtl'] as const)('opens from the keyboard (Shift+F10) and moves through the items with the arrows (%s)', async (dir) => {
    const { container } = await renderTree({ dir });
    const install = row(container, 'Install');
    await act(async () => install.focus());
    await press(install, 'F10', { shiftKey: true });
    await settle();
    const menu = document.querySelector<HTMLElement>('[role="menu"]') as HTMLElement;
    expect(menu).not.toBeNull();
    expect(trigger(container, 'Install').getAttribute('aria-expanded')).toBe('true');
    expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(3);
    // Every item is a menu item with a name, reachable from the keyboard.
    for (const entry of menu.querySelectorAll('[role="menuitem"]')) expect(entry.textContent?.trim()).not.toBe('');
    await press(menu, 'ArrowDown');
    const first = document.activeElement;
    await press(document.activeElement as Element, 'ArrowDown');
    expect(document.activeElement).not.toBe(first);
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem');
    await press(document.activeElement as Element, 'Escape');
    await settle();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});
