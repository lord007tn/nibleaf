/** @vitest-environment jsdom */
import { type MessageKey, type MessageVariables, translateFn } from '@nibleaf/i18n';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { PageNode } from '@/hooks/api';
import { LanguageDropTarget, languageMarkerId, PageTreeDndProvider, SortablePageTree } from './sortable-page-tree';

const translate = (key: MessageKey, variables?: MessageVariables) => translateFn(key, variables, 'en');
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => translate }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const pages = [
  { id: 'guide', title: 'Quickstart', position: 0, parentId: null, kind: 'GROUP' },
  { id: 'child', title: 'École', position: 0, parentId: 'guide', kind: 'PAGE' },
  { id: 'config', title: 'Configuration', position: 1, parentId: null, kind: 'PAGE' },
].map((page) => ({
  ...page,
  languageId: 'en',
  path: page.id,
  slug: page.id,
  icon: null,
  hidden: false,
  description: null,
  updatedAt: '',
})) as PageNode[];

async function render(dir: 'ltr' | 'rtl' = 'ltr', collapsed = false, multilingual = false) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const onSelect = vi.fn();
  const onMove = vi.fn();
  const onRename = vi.fn();
  const languages = [{ id: 'en', label: 'English', collapsed }, ...(multilingual ? [{ id: 'ar', label: 'العربية', collapsed: false }] : [])];
  const allPages = multilingual
    ? [
        ...pages,
        ...pages.slice(0, 2).map((page, index) => ({
          ...page,
          id: `ar-${page.id}`,
          parentId: index === 0 ? null : 'ar-guide',
          languageId: 'ar',
          title: index === 0 ? 'دليل البدء' : 'إعدادات',
        })),
      ]
    : pages;
  await act(async () =>
    root.render(
      <PageTreeDndProvider pages={allPages} languages={languages} dir={dir} onMove={onMove}>
        {languages.map((language) => (
          <div key={language.id}>
            <LanguageDropTarget languageId={language.id}>
              <button type="button">{language.label}</button>
              <button type="button">Settings</button>
            </LanguageDropTarget>
            <SortablePageTree
              languageId={language.id}
              activeId="guide"
              onSelect={onSelect}
              onAddChild={vi.fn()}
              onSettings={vi.fn()}
              onRename={onRename}
            />
          </div>
        ))}
      </PageTreeDndProvider>,
    ),
  );
  return { onSelect, onMove, onRename };
}
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});
const row = (id: string) => container.querySelector<HTMLElement>(`[role="treeitem"][data-page-id="${id}"]`) as HTMLElement;
async function key(target: Element, name: string, extra: KeyboardEventInit = {}) {
  await act(async () =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, code: name === ' ' ? 'Space' : name, bubbles: true, cancelable: true, ...extra })),
  );
}

it('exposes a grouped tree with one tab stop, sibling metadata and a shared description', async () => {
  await render();
  const tree = container.querySelector('[role="tree"]');
  expect(tree).not.toBeNull();
  expect(tree?.querySelectorAll('[role="treeitem"]')).toHaveLength(3);
  expect(tree?.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  expect(container.querySelector('[aria-owns]')).toBeNull();
  const header = document.getElementById(tree?.getAttribute('aria-labelledby') ?? '');
  expect(header?.getAttribute('aria-label')).toBe('English');
  expect(header?.closest('[role="tree"]')).toBeNull();
  expect(row('guide').getAttribute('aria-expanded')).toBe('true');
  expect(row('guide').getAttribute('aria-selected')).toBe('true');
  expect(row('guide').getAttribute('aria-setsize')).toBe('2');
  expect(row('config').getAttribute('aria-posinset')).toBe('2');
  expect(row('child').getAttribute('aria-level')).toBe('2');
  expect(row('child').parentElement?.getAttribute('role')).toBe('group');
  const descriptions = [...container.querySelectorAll('[data-drag-handle]')].map((item) => item.getAttribute('aria-describedby'));
  expect(new Set(descriptions).size).toBe(1);
  expect(tree?.getAttribute('aria-describedby')).toBe(descriptions[0]);
  expect(document.getElementById(descriptions[0] ?? '')?.textContent).toContain('F2');
});

it('keeps group case and gives an untitled page a visible, named warning dot', async () => {
  await render();
  const group = pages[0];
  const original = pages[2];
  if (!group || !original) throw new Error('Missing fixture pages');
  const emptyPage = { ...original, title: '' };
  await act(async () =>
    root.render(
      <PageTreeDndProvider pages={[group, emptyPage]} languages={[{ id: 'en', label: 'English', collapsed: false }]} dir="ltr" onMove={vi.fn()}>
        <SortablePageTree languageId="en" activeId={emptyPage.id} onSelect={vi.fn()} onSettings={vi.fn()} onAddChild={vi.fn()} />
      </PageTreeDndProvider>,
    ),
  );
  expect(row('guide').querySelector('button')?.className).not.toContain('uppercase');
  const dot = row('config').querySelector('.bg-warning');
  expect(dot?.getAttribute('aria-hidden')).toBe('true');
  expect(dot?.className).toContain('bg-warning');
  expect(row('config').textContent).toContain('Untitled');
});

it('nests each language tree in the DOM, leaves header controls outside, and keeps independent roving focus and boundaries', async () => {
  await render('ltr', false, true);
  const trees = [...container.querySelectorAll<HTMLElement>('[role="tree"]')];
  expect(trees).toHaveLength(2);
  expect(trees.map((tree) => tree.querySelectorAll('[role="treeitem"]').length)).toEqual([3, 2]);
  expect(container.querySelector('[aria-owns]')).toBeNull();
  for (const [index, tree] of trees.entries()) {
    expect(tree.querySelectorAll('[role="treeitem"][tabindex="0"]')).toHaveLength(1);
    const header = document.getElementById(tree.getAttribute('aria-labelledby') ?? '') as HTMLElement;
    expect(header.getAttribute('aria-label')).toBe(index === 0 ? 'English' : 'العربية');
    expect(header.closest('[role="tree"]')).toBeNull();
    expect(header.compareDocumentPosition(tree) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect([...header.querySelectorAll('button')].every((button) => !tree.contains(button))).toBe(true);
  }
  await act(async () => row('config').focus());
  await key(row('config'), 'ArrowDown');
  expect(document.activeElement).toBe(row('config'));
  await act(async () => row('ar-guide').focus());
  await key(row('ar-guide'), 'ArrowUp');
  expect(document.activeElement).toBe(row('ar-guide'));
  await key(row('ar-guide'), 'End');
  expect(document.activeElement).toBe(row('ar-child'));
  expect(trees.map((tree) => tree.querySelector('[tabindex="0"]')?.getAttribute('data-page-id'))).toEqual(['config', 'ar-child']);
  await key(row('ar-child'), 'Home');
  expect(document.activeElement).toBe(row('ar-guide'));
});

it('moves a page through another language header using the shared dnd context', async () => {
  const positions = [languageMarkerId('en'), 'guide', 'child', 'config', languageMarkerId('ar'), 'ar-guide', 'ar-child'];
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const selector = '[data-sortable-page-id], [data-language-id]';
    const measured = this.closest<HTMLElement>(selector) ?? this.querySelector<HTMLElement>(selector);
    const id = measured?.dataset.sortablePageId ?? languageMarkerId(measured?.dataset.languageId ?? 'en');
    const top = Math.max(0, positions.indexOf(id)) * 32;
    return { x: 0, y: top, top, bottom: top + 32, left: 0, right: 300, width: 300, height: 32, toJSON: () => ({}) };
  });
  const { onMove } = await render('ltr', false, true);
  const handle = row('config').querySelector('[data-drag-handle]') as HTMLElement;
  await act(async () => handle.focus());
  await key(handle, ' ');
  await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  await key(handle, 'ArrowDown');
  expect(container.querySelector('[data-language-id="ar"]')?.getAttribute('data-drop-target')).toBe('language');
  await key(handle, ' ');
  expect(onMove).toHaveBeenCalledWith({ pageId: 'config', parentId: null, languageId: 'ar', position: { before: 'ar-guide' } });
  expect(container.querySelector('[data-tree-announcement]')?.textContent).toBe('Configuration moved to العربية, position 1 of 2.');
});

it.each(['ltr', 'rtl'] as const)('navigates, collapses, expands and opens in %s', async (dir) => {
  const { onSelect } = await render(dir);
  const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
  const back = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
  await act(async () => row('guide').focus());
  await key(row('guide'), forward);
  expect(document.activeElement).toBe(row('child'));
  await key(row('child'), back);
  expect(document.activeElement).toBe(row('guide'));
  await key(row('guide'), back);
  expect(row('child')).toBeNull();
  await key(row('guide'), forward);
  expect(row('child')).not.toBeNull();
  await key(row('guide'), 'End');
  expect(document.activeElement).toBe(row('config'));
  await key(row('config'), 'ArrowUp');
  expect(document.activeElement).toBe(row('child'));
  await key(row('child'), 'Home');
  await key(row('guide'), 'ArrowDown');
  await key(row('child'), 'Enter');
  expect(onSelect).toHaveBeenCalledWith('child');
  await key(row('child'), 'c');
  expect(document.activeElement).toBe(row('config'));
  await key(row('config'), 'F2');
  expect(document.activeElement?.tagName).toBe('INPUT');
  await key(document.activeElement as Element, 'Escape');
  expect(document.activeElement).toBe(row('config'));
});

it('filters inside folded groups, highlights title/address matches, disables drag and clears with Escape', async () => {
  await render();
  await key(row('guide'), 'ArrowLeft');
  const input = container.querySelector<HTMLInputElement>('input[type="search"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'ecole');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(row('child')).not.toBeNull();
  expect(row('config')).toBeNull();
  expect(container.querySelector('mark')?.textContent).toBe('École');
  expect(container.textContent).toContain('Clear the filter');
  expect(container.querySelector('[data-drag-handle]')).toBeNull();
  await key(input, 'Escape');
  expect(input.value).toBe('');
  expect(row('child')).toBeNull();
  expect(row('config')).not.toBeNull();
});

it('reaches the drag handle and actions from the focused row without adding tab stops', async () => {
  await render();
  await act(async () => row('child').focus());
  await key(row('child'), 'd', { altKey: true, shiftKey: true });
  expect(document.activeElement).toBe(row('child').querySelector('[data-drag-handle]'));
  await key(document.activeElement as Element, 'Escape');
  expect(document.activeElement).toBe(row('child'));
  await key(row('child'), 'F10', { shiftKey: true });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  expect(container.querySelectorAll('[role="treeitem"][tabindex="0"]')).toHaveLength(1);
});

it('searches a folded language and renders the design-system empty state for no matches', async () => {
  await render('ltr', true);
  expect(row('config')).toBeNull();
  const input = container.querySelector<HTMLInputElement>('input[type="search"]') as HTMLInputElement;
  for (const query of ['config', 'no-match']) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, query);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    if (query === 'config') {
      expect(row('config')).not.toBeNull();
      expect(container.querySelector('mark')?.textContent?.toLowerCase()).toBe('config');
    } else {
      expect(container.querySelector('[data-slot="empty-state"]')?.textContent).toBe('No matching pages');
    }
  }
});

it.each(['ltr', 'rtl'] as const)(
  'announces the projected parent and position for %s keyboard nesting over itself, then clears the live text',
  async (dir) => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const measured = this.closest<HTMLElement>('[data-sortable-page-id]') ?? this.querySelector<HTMLElement>('[data-sortable-page-id]');
      const index = ['guide', 'child', 'config'].indexOf(measured?.dataset.sortablePageId ?? '');
      const top = Math.max(0, index) * 32;
      return { x: 0, y: top, top, bottom: top + 32, left: 0, right: 300, width: 300, height: 32, toJSON: () => ({}) };
    });
    const { onMove } = await render(dir);
    const handle = row('config').querySelector('[data-drag-handle]') as HTMLElement;
    await act(async () => handle.focus());
    await key(handle, ' ');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    await key(handle, dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight');
    await key(handle, ' ');
    expect(onMove).toHaveBeenCalledWith({ pageId: 'config', parentId: 'guide', position: { after: 'child' } });
    expect(container.querySelector('[data-tree-announcement]')?.textContent).toBe('Configuration moved inside Quickstart, position 2 of 2.');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 1600)));
    expect(container.querySelector('[data-tree-announcement]')?.textContent).toBe('');
  },
);
