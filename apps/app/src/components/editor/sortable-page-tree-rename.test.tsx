/** @vitest-environment jsdom */
/**
 * AUTH-01: "Rename" from a page-tree row menu must never put focus, even for a
 * moment, in the open page's body. Before the fix the menu handed focus back
 * to the body, so the user's next keystrokes replaced that page's content.
 *
 * The tests record every focus change (`focusin`) from the moment Rename is
 * chosen, and drive the menu the way a browser does: pointer events that move
 * focus on press, and keyboard events on the focused element.
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

const page = (id: string, title: string, position: number): PageNode => ({
  id,
  parentId: null,
  languageId: 'en',
  kind: 'PAGE',
  title,
  slug: id,
  path: id,
  icon: null,
  description: null,
  position,
  hidden: false,
  updatedAt: '2026-11-10T00:00:00Z',
});

const PAGE_BODY = '<p>Set the options after you install.</p>';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const roots: Array<ReturnType<typeof createRoot>> = [];
let focusLog: string[] = [];
const recordFocus = (event: FocusEvent) => focusLog.push(focusName(event.target));

function focusName(target: EventTarget | null): string {
  if (!(target instanceof HTMLElement)) return 'none';
  if (target.dataset.testid) return target.dataset.testid;
  if (target.closest('[data-testid="page-body"]')) return 'page-body';
  if (target.tagName === 'INPUT') return 'rename-input';
  if (target.getAttribute('role') === 'menuitem') return 'menu-item';
  if (target.closest('[role="menu"]')) return 'menu';
  if (target.getAttribute('aria-haspopup')) return 'menu-trigger';
  return target.tagName.toLowerCase();
}

/** jsdom has no Web Animations; Base UI waits on whatever `getAnimations` reports. */
function setAnimations(impl: (this: Element) => unknown[]) {
  Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, writable: true, value: impl });
}

/** A finite close animation of `ms`, so the menu closes the way it does in the browser. */
function slowAnimations(ms: number) {
  const finished = () => new Promise<void>((resolve) => setTimeout(resolve, ms));
  setAnimations(function (this: Element) {
    if (!this.closest('[data-slot="dropdown-menu-content"]')) return [];
    return [{ finished: finished(), pending: false, playState: 'running', effect: { getTiming: () => ({ duration: ms, iterations: 1 }) } }];
  });
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  setAnimations(() => []);
  focusLog = [];
  document.addEventListener('focusin', recordFocus);
});

afterEach(async () => {
  document.removeEventListener('focusin', recordFocus);
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** The tree beside a stand-in for the open page's editable body, which has focus. */
async function renderTree() {
  const body = document.createElement('div');
  body.contentEditable = 'true';
  body.tabIndex = 0;
  body.dataset.testid = 'page-body';
  body.innerHTML = PAGE_BODY;
  document.body.append(body);
  const outside = document.createElement('button');
  outside.dataset.testid = 'outside';
  outside.textContent = 'Comment';
  document.body.append(outside);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const onRename = vi.fn();
  await act(async () =>
    root.render(
      <PageTreeDndProvider
        pages={[page('config', 'Configuration', 0), page('start', 'Getting started', 1)]}
        languages={[{ id: 'en', label: 'English', collapsed: false }]}
        dir="ltr"
        onMove={vi.fn()}
      >
        <SortablePageTree
          languageId="en"
          activeId="config"
          onSelect={vi.fn()}
          onAddChild={vi.fn()}
          onSettings={vi.fn()}
          onRename={onRename}
          onDelete={vi.fn()}
        />
      </PageTreeDndProvider>,
    ),
  );
  await act(async () => body.focus());
  focusLog = [];
  return { body, outside, container, onRename };
}

/**
 * A mouse press and release as the browser fires them: focus moves on press
 * unless it is prevented. Safari (and iPadOS taps) never focus a button on
 * click, so with `focusButtons: false` focus stays where it was, in the page.
 */
async function pointer(element: HTMLElement, { focusButtons = true } = {}) {
  await act(async () => {
    const init = { bubbles: true, cancelable: true, composed: true, button: 0, buttons: 1, pointerType: 'mouse', pointerId: 1, isPrimary: true };
    const PointerCtor = (globalThis.PointerEvent ?? MouseEvent) as typeof MouseEvent;
    element.dispatchEvent(new PointerCtor('pointerdown', init));
    const down = new MouseEvent('mousedown', init);
    element.dispatchEvent(down);
    if (!down.defaultPrevented && (focusButtons || !element.closest('button, [role="menuitem"]'))) {
      const focusable = element.closest<HTMLElement>('button, input, [tabindex], [contenteditable="true"]');
      focusable?.focus();
    }
    element.dispatchEvent(new PointerCtor('pointerup', { ...init, buttons: 0 }));
    element.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
    element.dispatchEvent(new MouseEvent('click', { ...init, buttons: 0 }));
  });
}

async function key(target: Element, name: string) {
  await act(async () => {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    // A button activates on Enter/Space as the browser does.
    if (!event.defaultPrevented && target instanceof HTMLButtonElement && (name === 'Enter' || name === ' ')) target.click();
    target.dispatchEvent(new KeyboardEvent('keyup', { key: name, bubbles: true, cancelable: true }));
  });
}

/** Typing as the browser does it: into whatever has focus. */
async function typeIntoFocus(text: string) {
  await act(async () => {
    const target = document.activeElement;
    if (target instanceof HTMLInputElement) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(target, text);
      target.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (target instanceof HTMLElement && target.isContentEditable) {
      target.textContent = text;
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}

/** Open a row's actions menu with the mouse and let it finish opening. */
async function openMenu(container: HTMLElement, title: string, options?: { focusButtons?: boolean }) {
  await pointer(trigger(container, title), options);
  await settle(300);
}

const trigger = (container: HTMLElement, title: string) => {
  const found = container.querySelector<HTMLButtonElement>(`button[aria-label="${translate('editor.pageActions', { title })}"]`);
  if (!found) throw new Error(`No actions menu for ${title}`);
  return found;
};
const renameItem = () => {
  const found = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent?.trim() === translate('editor.rename'),
  );
  if (!found) throw new Error('No Rename item in the row menu');
  return found;
};
const renameInput = (container: HTMLElement) => container.querySelector<HTMLInputElement>(`input[aria-label="${translate('editor.rename')}"]`);

/** Let the menu close completely (animations, unmount, focus cleanup), watching every frame. */
async function settle(ms = 400) {
  for (let elapsed = 0; elapsed < ms; elapsed += 20) await act(async () => wait(20));
}

function afterRenameChosen(log: string[]) {
  const from = log.lastIndexOf('menu-item');
  return from === -1 ? log : log.slice(from + 1);
}

describe('page tree rename from the row menu (AUTH-01)', () => {
  it('by mouse: focus goes from the menu straight to the rename field and never into the page body', async () => {
    const { body, container, onRename } = await renderTree();
    await openMenu(container, 'Getting started');
    await pointer(renameItem());
    await settle();
    const input = renameInput(container);
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(focusLog).not.toContain('page-body');
    expect(afterRenameChosen(focusLog).filter((entry) => entry !== 'body')).toEqual(['rename-input']);
    await typeIntoFocus('Quickstart');
    await key(document.activeElement as Element, 'Enter');
    expect(onRename).toHaveBeenCalledWith('start', 'Quickstart', 'title');
    expect(body.innerHTML).toBe(PAGE_BODY);
  });

  it('by mouse in a browser where buttons never take focus (Safari): focus still never returns to the page body', async () => {
    const { body, container, onRename } = await renderTree();
    await openMenu(container, 'Getting started', { focusButtons: false });
    await pointer(renameItem(), { focusButtons: false });
    await settle();
    expect(focusLog).not.toContain('page-body');
    expect(document.activeElement).toBe(renameInput(container));
    await typeIntoFocus('Quickstart');
    await key(document.activeElement as Element, 'Enter');
    expect(onRename).toHaveBeenCalledWith('start', 'Quickstart', 'title');
    expect(body.innerHTML).toBe(PAGE_BODY);
  });

  it('by keyboard: the same, with the menu opened and chosen from the keyboard', async () => {
    const { body, container, onRename } = await renderTree();
    const button = trigger(container, 'Getting started');
    await act(async () => button.focus());
    await key(button, 'Enter');
    await settle(300);
    await key(renameItem(), 'Enter');
    await settle();
    expect(document.activeElement).toBe(renameInput(container));
    expect(focusLog).not.toContain('page-body');
    await typeIntoFocus('Quickstart');
    await key(document.activeElement as Element, 'Enter');
    expect(onRename).toHaveBeenCalledWith('start', 'Quickstart', 'title');
    expect(body.innerHTML).toBe(PAGE_BODY);
  });

  it('with a slow close animation: focus never visits the page body while the menu closes and unmounts', async () => {
    slowAnimations(250);
    const { body, container } = await renderTree();
    await openMenu(container, 'Getting started');
    await pointer(renameItem());
    // Keystrokes typed during the close go to whatever has focus; none may reach the page.
    for (let elapsed = 0; elapsed < 600; elapsed += 50) {
      await act(async () => wait(50));
      expect(document.activeElement).not.toBe(body);
    }
    expect(focusLog).not.toContain('page-body');
    expect(document.activeElement).toBe(renameInput(container));
    await typeIntoFocus('Quickstart');
    expect(body.innerHTML).toBe(PAGE_BODY);
  });

  it('leaves focus in the page when the user clicks back into it while the menu is still closing', async () => {
    slowAnimations(250);
    const { body, container, onRename } = await renderTree();
    await openMenu(container, 'Getting started');
    await pointer(renameItem());
    await act(async () => wait(50));
    await pointer(body);
    await settle(600);
    expect(document.activeElement).toBe(body);
    expect(renameInput(container)).toBeNull();
    expect(onRename).not.toHaveBeenCalled();
    expect(body.innerHTML).toBe(PAGE_BODY);
  });

  it('lets the user leave the open field: a click elsewhere keeps focus there and saves the name', async () => {
    const { container, outside, onRename } = await renderTree();
    await openMenu(container, 'Getting started');
    await pointer(renameItem());
    await settle();
    await typeIntoFocus('Quickstart');
    await pointer(outside);
    await settle(100);
    expect(document.activeElement).toBe(outside);
    expect(renameInput(container)).toBeNull();
    expect(onRename).toHaveBeenCalledWith('start', 'Quickstart', 'title');
  });

  it('keeps Escape as cancel', async () => {
    const { container, onRename } = await renderTree();
    await openMenu(container, 'Getting started');
    await pointer(renameItem());
    await settle();
    await typeIntoFocus('Quickstart');
    await key(document.activeElement as Element, 'Escape');
    expect(renameInput(container)).toBeNull();
    expect(onRename).not.toHaveBeenCalled();
  });
});
