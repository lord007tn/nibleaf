/** @vitest-environment jsdom */
/**
 * AUTH-02: choosing a page suggestion with the keyboard must link that page,
 * never save the typed search words as the link's address.
 */

import { type MessageKey, type MessageVariables, translateFn } from '@nibleaf/i18n';
import { Editor } from '@tiptap/core';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const translate = (key: MessageKey, variables?: MessageVariables) => translateFn(key, variables, 'en');
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => translate }));
vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ projectId: 'project-1' }) }));
vi.mock('./active-branch-context', () => ({ useActiveBranchId: () => 'main' }));
const pages = [
  { id: 'config', kind: 'PAGE', title: 'Configuration', path: 'configuration' },
  { id: 'start', kind: 'PAGE', title: 'Getting started', path: 'getting-started' },
  { id: 'faq', kind: 'PAGE', title: 'Getting help', path: 'support/getting-help' },
  { id: 'group', kind: 'GROUP', title: 'Getting there', path: 'getting-there' },
];
vi.mock('@/hooks/api', () => ({
  useLanguages: () => ({ data: [{ id: 'en', code: 'en' }] }),
  usePages: () => ({ data: pages }),
}));

import { LinkEditorPanel } from './editor-bubble-menu';
import { buildEditorExtensions } from './tiptap-editor';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const roots: Array<ReturnType<typeof createRoot>> = [];
const editors: Editor[] = [];

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
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

/** An editor with "see the guide" and "the guide" selected, plus the link panel. */
async function renderPanel(initialUrl = '') {
  const host = document.createElement('div');
  host.lang = 'en';
  document.body.append(host);
  const editor = new Editor({ element: host, extensions: buildEditorExtensions(), content: '<p>see the guide</p>' });
  editors.push(editor);
  editor.commands.setTextSelection({ from: 5, to: 14 });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const onDone = vi.fn();
  await act(async () => root.render(<LinkEditorPanel editor={editor} initialUrl={initialUrl} onDone={onDone} autoFocus />));
  // The page list is lazy-loaded.
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  // Found by its label, as on main, so behaviour is what fails there, not a selector.
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${translate('editor.link.search')}"]`);
  if (!input) throw new Error('No link field');
  return { editor, input, onDone, container };
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}

const press = (input: HTMLInputElement, key: string, init: KeyboardEventInit & { keyCode?: number } = {}) =>
  act(async () => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    if (init.keyCode !== undefined) Object.defineProperty(event, 'keyCode', { value: init.keyCode });
    input.dispatchEvent(event);
  });

const linkHref = (editor: Editor) => {
  let href: string | undefined;
  editor.state.doc.descendants((node) => {
    const mark = node.marks.find((candidate) => candidate.type.name === 'link');
    if (mark) href = mark.attrs.href as string;
  });
  return href;
};

describe('link field page suggestions (AUTH-02)', () => {
  it('is a combobox whose options are listed for assistive tech', async () => {
    const { input, container } = await renderPanel();
    await type(input, 'Getting');
    expect(input.getAttribute('role')).toBe('combobox');
    const listbox = container.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();
    expect(listbox?.getAttribute('aria-label')).toBe(translate('editor.link.suggestions'));
    expect(input.getAttribute('aria-controls')).toBe(listbox?.id);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    // Groups are not linkable pages.
    expect([...container.querySelectorAll('[role="option"]')].map((option) => option.textContent)).toEqual(['Getting started', 'Getting help']);
  });

  it('links the highlighted page on ArrowDown + Enter, not the typed words', async () => {
    const { editor, input, onDone } = await renderPanel();
    await type(input, 'Getting');
    await press(input, 'ArrowDown');
    const active = input.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    expect(document.getElementById(active ?? '')?.textContent).toBe('Getting started');
    await press(input, 'ArrowDown');
    expect(document.getElementById(input.getAttribute('aria-activedescendant') ?? '')?.textContent).toBe('Getting help');
    await press(input, 'Enter');
    expect(linkHref(editor)).toBe('/support/getting-help');
    expect(onDone).toHaveBeenCalled();
  });

  it('links the best match on Enter with nothing highlighted', async () => {
    const { editor, input } = await renderPanel();
    await type(input, 'Getting');
    await press(input, 'Enter');
    expect(linkHref(editor)).toBe('/getting-started');
  });

  it('refuses a bare word that matches no page instead of saving it as the address', async () => {
    const { editor, input, onDone, container } = await renderPanel();
    await type(input, 'Gettin-nowhere');
    await press(input, 'Enter');
    expect(linkHref(editor)).toBeUndefined();
    expect(onDone).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(translate('editor.link.invalid'));
  });

  it.each([
    ['https://example.com/docs', 'https://example.com/docs'],
    ['mailto:help@example.com', 'mailto:help@example.com'],
    ['#setup', '#setup'],
    ['/configuration', '/configuration'],
    ['./intro', './intro'],
    ['../guides/intro', '../guides/intro'],
    ['guides/intro#setup', 'guides/intro#setup'],
    ['intro#setup', 'intro#setup'],
    ['example.com/docs', 'https://example.com/docs'],
  ])('saves the link %s typed in full', async (typed, href) => {
    const { editor, input } = await renderPanel();
    await type(input, typed);
    await press(input, 'Enter');
    expect(linkHref(editor)).toBe(href);
  });

  it.each([
    ['isComposing', { isComposing: true }],
    ['keyCode 229', { keyCode: 229 }],
  ])('leaves arrow keys and Enter to the IME while composing (%s)', async (_label, composing) => {
    const { editor, input, onDone } = await renderPanel();
    await type(input, 'Getting');
    await press(input, 'ArrowDown', composing);
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    await press(input, 'ArrowUp', composing);
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    await press(input, 'Enter', composing);
    expect(linkHref(editor)).toBeUndefined();
    expect(onDone).not.toHaveBeenCalled();
    // Once composition ends, the keys work again.
    await press(input, 'ArrowDown');
    expect(document.getElementById(input.getAttribute('aria-activedescendant') ?? '')?.textContent).toBe('Getting started');
  });
});
