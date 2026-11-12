/** @vitest-environment jsdom */
/**
 * AUTH-38 "Move to…": choose a new parent from a searchable list of the tree.
 * The page can't go under itself or a page inside it, its current place is
 * shown but not offered, the move is the drag's move intent with the tree's
 * structure revision, and its errors read as the drag's do.
 */
import { createHash } from 'node:crypto';
import { type MessageKey, type MessageVariables, translateFn } from '@nibleaf/i18n';
import { pageStructureRevisionSource } from '@nibleaf/shared/page-moves';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageNode } from '@/hooks/api';
import { ApiResponseError } from '@/hooks/api/client-helpers';

const translate = (key: MessageKey, variables?: MessageVariables) => translateFn(key, variables, 'en');
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => translate,
  useLocale: () => ({ locale: 'en', t: translate, setLocale: vi.fn() }),
}));

import { MovePageDialog, moveDestinations } from './move-page-dialog';
import { PageTreeDndProvider, SortablePageTree } from './sortable-page-tree';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const node = (id: string, overrides: Partial<PageNode> = {}): PageNode => ({
  id,
  parentId: null,
  branchId: 'main',
  languageId: 'en',
  kind: 'PAGE',
  title: id,
  slug: id.toLowerCase(),
  path: id.toLowerCase(),
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
  node('Rollback', { parentId: 'Deploy', position: 0 }),
  node('Reference', { kind: 'GROUP', position: 2 }),
  node('مقدمة', { languageId: 'ar', position: 0 }),
];
const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'ar', label: 'العربية' },
];
const topLevel = (language: string) => translate('editor.dnd.topLevelIn', { language });

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

describe('moveDestinations', () => {
  it("lists every language's top level and every page except the page itself and the pages inside it", () => {
    const keys = moveDestinations(PAGES[1] as PageNode, PAGES, LANGUAGES, '', topLevel).map((destination) => destination.key);
    expect(keys).toEqual(['language:en', 'Install', 'Reference', 'language:ar', 'مقدمة']);
  });

  it('marks the current place, which is listed but not offered', () => {
    const destinations = moveDestinations(PAGES[3] as PageNode, PAGES, LANGUAGES, '', topLevel);
    expect(destinations.filter((destination) => destination.current).map((destination) => destination.key)).toEqual(['Deploy']);
  });

  it('keeps matches and the pages above them while filtering, as the tree filter does', () => {
    const keys = moveDestinations(PAGES[0] as PageNode, PAGES, LANGUAGES, 'deploy', topLevel).map((destination) => destination.key);
    expect(keys).toEqual(['language:en', 'Guides', 'Deploy', 'language:ar']);
  });
});

async function renderDialog(page: PageNode, onMove = vi.fn(async () => undefined), collapsed: string[] = []) {
  localStorage.setItem('nibleaf.editor.collapsedGroups:en', JSON.stringify(collapsed));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const onClose = vi.fn();
  await act(async () =>
    root.render(
      <PageTreeDndProvider pages={PAGES} languages={LANGUAGES.map((language) => ({ ...language, collapsed: false }))} dir="ltr" onMove={vi.fn()}>
        <SortablePageTree languageId="en" activeId={null} onSelect={vi.fn()} onAddChild={vi.fn()} onSettings={vi.fn()} />
        <MovePageDialog page={page} pages={PAGES} languages={LANGUAGES} onMove={onMove} onClose={onClose} />
      </PageTreeDndProvider>,
    ),
  );
  await settle();
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]') as HTMLElement;
  return { container, dialog, onMove, onClose };
}

const radio = (dialog: HTMLElement, key: string) => dialog.querySelector<HTMLInputElement>(`[data-destination="${key}"] input`) as HTMLInputElement;
const confirm = (dialog: HTMLElement) => dialog.querySelector<HTMLButtonElement>('button[type="submit"]') as HTMLButtonElement;
const search = (dialog: HTMLElement) => dialog.querySelector<HTMLInputElement>('input[type="search"]') as HTMLInputElement;

async function type(input: HTMLInputElement, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('MovePageDialog', () => {
  it('opens titled for the page, with focus in the search field', async () => {
    const { dialog } = await renderDialog(PAGES[0] as PageNode);
    expect(dialog.textContent).toContain(translate('editor.moveTitle', { title: 'Install' }));
    expect(document.activeElement).toBe(search(dialog));
    expect(radio(dialog, 'language:en').disabled).toBe(true);
    expect(dialog.querySelector('[data-destination="language:en"]')?.textContent).toContain(translate('editor.moveCurrent'));
  });

  it('moves to the end of the chosen parent through the move intent, with the structure revision the server checks', async () => {
    const { dialog, onMove, onClose } = await renderDialog(PAGES[0] as PageNode);
    await act(async () => radio(dialog, 'Reference').click());
    await act(async () => confirm(dialog).click());
    await settle();
    expect(onMove).toHaveBeenCalledExactlyOnceWith({
      pageId: 'Install',
      parentId: 'Reference',
      position: { at: 'end' },
      expectedStructureRevision: createHash('sha256')
        .update(pageStructureRevisionSource(PAGES as never))
        .digest('hex'),
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('names the language when the page moves into another one', async () => {
    const { dialog, onMove } = await renderDialog(PAGES[0] as PageNode);
    await act(async () => radio(dialog, 'language:ar').click());
    await act(async () => confirm(dialog).click());
    await settle();
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ parentId: null, languageId: 'ar' }));
  });

  it('expands a collapsed destination so the moved page shows there', async () => {
    const { container, dialog } = await renderDialog(PAGES[0] as PageNode, undefined, ['Guides']);
    expect(container.querySelector('[data-page-id="Guides"]')?.getAttribute('aria-expanded')).toBe('false');
    await act(async () => radio(dialog, 'Deploy').click());
    await act(async () => confirm(dialog).click());
    await settle();
    expect(container.querySelector('[data-page-id="Guides"]')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('asks for a destination instead of moving when none is chosen', async () => {
    const { dialog, onMove } = await renderDialog(PAGES[0] as PageNode);
    await act(async () => confirm(dialog).click());
    await settle();
    expect(onMove).not.toHaveBeenCalled();
    expect(dialog.querySelector('[role="alert"]')?.textContent).toBe(translate('editor.moveChoose'));
  });

  it('filters the list, and Enter in the filter picks the first match without moving', async () => {
    const { dialog, onMove } = await renderDialog(PAGES[0] as PageNode);
    await type(search(dialog), 'refer');
    expect([...dialog.querySelectorAll('[data-destination]')].map((element) => element.getAttribute('data-destination'))).toEqual([
      'language:en',
      'Reference',
      'language:ar',
    ]);
    await act(async () => {
      search(dialog).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(radio(dialog, 'Reference').checked).toBe(true);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('picks the page that matches, never an ancestor listed only for context', async () => {
    // Guides → Deploy → Rollback: searching "Rollback" lists Guides and Deploy above it.
    const { dialog, onMove } = await renderDialog(PAGES[0] as PageNode);
    await type(search(dialog), 'Rollback');
    expect([...dialog.querySelectorAll('[data-destination]')].map((element) => element.getAttribute('data-destination'))).toEqual([
      'language:en',
      'Guides',
      'Deploy',
      'Rollback',
      'language:ar',
    ]);
    // The direct match is the default choice, and Enter keeps it.
    expect(radio(dialog, 'Rollback').checked).toBe(true);
    await act(async () => {
      search(dialog).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(radio(dialog, 'Rollback').checked).toBe(true);
    expect(radio(dialog, 'Guides').checked).toBe(false);
    await act(async () => confirm(dialog).click());
    await settle();
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ pageId: 'Install', parentId: 'Rollback' }));
  });

  it('marks which listed pages match the search', () => {
    const destinations = moveDestinations(PAGES[0] as PageNode, PAGES, LANGUAGES, 'rollback', topLevel);
    expect(destinations.filter((destination) => destination.match).map((destination) => destination.key)).toEqual(['Rollback']);
  });

  it('shows a refused move in the dialog with the same words as a refused drag', async () => {
    const onMove = vi.fn(async () => {
      throw new ApiResponseError('changed', 409, 'database:conflict', undefined, undefined, undefined, undefined, { reason: 'structure_changed' });
    });
    const { dialog, onClose } = await renderDialog(PAGES[0] as PageNode, onMove);
    await act(async () => radio(dialog, 'Reference').click());
    await act(async () => confirm(dialog).click());
    await settle();
    expect(dialog.querySelector('[role="alert"]')?.textContent).toBe(translate('editor.tree.structureChanged'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
