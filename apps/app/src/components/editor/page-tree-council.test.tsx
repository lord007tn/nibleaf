/** @vitest-environment jsdom */
import { type MessageKey, type MessageVariables, translateFn } from '@nibleaf/i18n';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { PageNode } from '@/hooks/api';
import { LanguageDropTarget, PageTreeDndProvider, SortablePageTree } from './sortable-page-tree';

const translate = (key: MessageKey, values?: MessageVariables) => translateFn(key, values, 'en');
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => translate }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const original = [
  { id: 'guide', title: 'Quickstart', position: 0 },
  { id: 'moving', title: 'Configuration', position: 1 },
  { id: 'next', title: 'Next page', position: 2 },
].map((page) => ({
  ...page,
  parentId: null,
  branchId: 'branch',
  languageId: 'en',
  kind: 'PAGE',
  slug: page.id,
  path: page.id,
  icon: null,
  hidden: false,
  description: null,
  updatedAt: '',
})) as PageNode[];
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const flush = async (ms = 20) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
const row = (id: string) => container.querySelector<HTMLElement>(`[role="treeitem"][data-page-id="${id}"]`);
const key = async (element: Element, value: string, extra: KeyboardEventInit = {}) =>
  act(async () => {
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: value, code: value === ' ' ? 'Space' : value, bubbles: true, cancelable: true, ...extra }),
    );
  });
async function render(options: { collapsed?: boolean; pending?: boolean } = {}) {
  if (options.collapsed) localStorage.setItem('nibleaf.editor.collapsedGroups:en', '["guide"]');
  const initial = options.collapsed
    ? [...original, { ...original[0], id: 'existing', title: 'Existing child', parentId: 'guide', position: 0 } as PageNode]
    : original;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  let complete: (pages: PageNode[]) => void = vi.fn();
  let fail: (error: Error) => void = vi.fn();
  const moved = initial.map((page) => (page.id === 'moving' ? { ...page, parentId: 'guide', position: options.collapsed ? 1 : 0 } : page));
  const onMove = vi.fn();
  function Forest() {
    const [pages, setPages] = useState(initial);
    return (
      <PageTreeDndProvider
        pages={pages}
        languages={[{ id: 'en', label: 'English', collapsed: false }]}
        dir="ltr"
        onMove={(request) => {
          onMove(request);
          setPages(moved);
          if (!options.pending) return Promise.resolve(moved);
          return new Promise<PageNode[]>((resolve, reject) => {
            complete = resolve;
            fail = (error) => {
              setPages(initial);
              reject(error);
            };
          });
        }}
      >
        <LanguageDropTarget languageId="en">
          <button type="button">English</button>
        </LanguageDropTarget>
        <SortablePageTree
          languageId="en"
          activeId="moving"
          onSelect={vi.fn()}
          onAddChild={vi.fn()}
          onSettings={vi.fn()}
          onDelete={(id) => setPages((current) => current.filter((page) => page.id !== id))}
          onRename={(id, title) => setPages((current) => current.map((page) => (page.id === id ? { ...page, title } : page)))}
        />
      </PageTreeDndProvider>
    );
  }
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const measured = this.closest<HTMLElement>('[data-sortable-page-id]') ?? this.querySelector<HTMLElement>('[data-sortable-page-id]');
    const index = ['guide', 'moving', 'next', 'existing'].indexOf(measured?.dataset.sortablePageId ?? '');
    const top = Math.max(0, index) * 32;
    return { x: 0, y: top, top, bottom: top + 32, left: 0, right: 300, width: 300, height: 32, toJSON: () => ({}) };
  });
  await act(async () => root.render(<Forest />));
  return { onMove, complete: () => complete(moved), fail: () => fail(new Error('Synthetic rejected move')) };
}
async function nest() {
  const handle = row('moving')?.querySelector<HTMLElement>('[data-drag-handle]') as HTMLElement;
  await act(async () => handle.focus());
  await key(handle, ' ');
  await flush(10);
  await key(handle, 'ArrowRight');
  return handle;
}
const announcement = () => container.querySelector('[data-tree-announcement]')?.textContent;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

it('council P1: the tree sends a single anchored intent instead of rewriting the touched languages', async () => {
  const { onMove } = await render();
  const handle = await nest();
  await key(handle, ' ');
  expect(onMove).toHaveBeenCalledWith({ pageId: 'moving', parentId: 'guide', position: { at: 'end' } });
});

it('council P1: moves and drag handles are blocked with a reason while the move is pending', async () => {
  const state = await render({ pending: true });
  const handle = await nest();
  await key(handle, ' ');
  expect(container.querySelector('[data-drag-handle]')).toBeNull();
  expect(container.textContent).toContain('Wait for the current move to finish before moving another page.');
  await act(async () => row('next')?.focus());
  await key(row('next') as HTMLElement, 'd', { altKey: true, shiftKey: true });
  expect(document.activeElement).toBe(row('next'));
  expect(state.onMove).toHaveBeenCalledOnce();
  await act(async () => state.complete());
});

it('council P2: nesting into a collapsed parent expands it and restores keyboard focus by page ID', async () => {
  await render({ collapsed: true });
  const handle = await nest();
  await key(handle, ' ');
  await flush(40);
  expect(row('moving')).not.toBeNull();
  expect(document.activeElement?.closest('[data-page-id]')?.getAttribute('data-page-id')).toBe('moving');
  expect(row('guide')?.getAttribute('aria-expanded')).toBe('true');
});

it('council P2: deleting the focused row falls back to the next visible neighbour', async () => {
  await render();
  await act(async () => row('moving')?.focus());
  await key(row('moving') as HTMLElement, 'F10', { shiftKey: true });
  await flush(50);
  const remove = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((element) => element.textContent?.includes('Delete page'));
  expect(remove).toBeDefined();
  await act(async () => remove?.click());
  await flush(50);
  expect(row('moving')).toBeNull();
  expect(document.activeElement).toBe(row('next'));
});

it('council P2: a filtered rename whose match disappears falls back to the filter input', async () => {
  await render();
  const filter = container.querySelector<HTMLInputElement>('input[type="search"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(filter, 'config');
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    row('moving')?.focus();
  });
  await act(async () => row('moving')?.focus());
  await key(row('moving') as HTMLElement, 'F2');
  const input = document.activeElement as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Options');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await key(input, 'Enter');
  await flush();
  expect(row('moving')).toBeNull();
  expect(document.activeElement).toBe(filter);
});

it.each(['success', 'failure'] as const)('council P2: announces preview, pending and only then %s', async (outcome) => {
  const state = await render({ pending: true });
  const handle = await nest();
  expect(announcement()).toBe('Configuration will move inside Quickstart, position 1 of 1.');
  await key(handle, ' ');
  expect(announcement()).toBe('Moving Configuration…');
  await act(async () => (outcome === 'success' ? state.complete() : state.fail()));
  expect(announcement()).toBe(
    outcome === 'success' ? 'Configuration moved inside Quickstart, position 1 of 1.' : "Couldn't move Configuration. Restored to its place.",
  );
});
