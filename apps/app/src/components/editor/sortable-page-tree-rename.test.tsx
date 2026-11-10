/** @vitest-environment jsdom */

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

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const roots: Array<ReturnType<typeof createRoot>> = [];

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
});

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** The tree beside a stand-in for the open page's editable body, which has focus. */
async function renderTree() {
  const body = document.createElement('div');
  body.contentEditable = 'true';
  body.tabIndex = 0;
  body.setAttribute('data-testid', 'page-body');
  document.body.append(body);
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
  body.focus();
  expect(document.activeElement).toBe(body);
  return { body, container, onRename };
}

async function chooseRename(container: HTMLElement, title: string) {
  const trigger = container.querySelector<HTMLButtonElement>(`button[aria-label="${translate('editor.pageActions', { title })}"]`);
  if (!trigger) throw new Error(`No actions menu for ${title}`);
  await act(async () => trigger.click());
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (candidate) => candidate.textContent?.trim() === translate('editor.rename'),
  );
  if (!item) throw new Error('No Rename item in the row menu');
  await act(async () => item.click());
  // Let the menu finish closing and restore focus, as it does in the browser.
  await act(async () => wait(150));
}

const renameInput = (container: HTMLElement) => container.querySelector<HTMLInputElement>(`input[aria-label="${translate('editor.rename')}"]`);

function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('page tree rename from the row menu (AUTH-01)', () => {
  it('keeps focus in the rename field, never the open page body, after the menu closes', async () => {
    const { body, container } = await renderTree();
    await chooseRename(container, 'Getting started');
    const input = renameInput(container);
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(document.activeElement).not.toBe(body);
    await act(async () => wait(100));
    expect(document.activeElement).toBe(input);
  });

  it('saves the typed name for the chosen row on Enter', async () => {
    const { container, onRename } = await renderTree();
    await chooseRename(container, 'Getting started');
    const input = renameInput(container);
    if (!input) throw new Error('Rename field did not open');
    await act(async () => type(input, 'Quickstart'));
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(onRename).toHaveBeenCalledWith('start', 'Quickstart', 'title');
  });

  it('takes focus back when something steals it right after the field opens', async () => {
    const { body, container } = await renderTree();
    await chooseRename(container, 'Getting started');
    const input = renameInput(container);
    if (!input) throw new Error('Rename field did not open');
    await act(async () => body.focus());
    await act(async () => wait(50));
    expect(document.activeElement).toBe(input);
    expect(renameInput(container)).not.toBeNull();
  });
});
