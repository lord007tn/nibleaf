// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

let editor: Editor;
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.getAnimations = vi.fn(() => []);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  editor = new Editor({
    element: document.createElement('div'),
    extensions: buildEditorExtensions(),
    content: '```js custom="keep"\none\ntwo // [!code ++]\n```\n\nAfter.',
  });
  await act(async () =>
    root.render(
      <div className="pl-editor">
        <EditorContent editor={editor} />
        <button type="button" data-outside>
          Outside
        </button>
      </div>,
    ),
  );
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
    editor.destroy();
  });
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const input = async (element: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const optionsButton = () => {
  const button = container.querySelector<HTMLButtonElement>('button[aria-label="Options"]');
  if (!button) throw new Error('Missing Options button');
  return button;
};
const openOptions = async () => {
  await act(async () => optionsButton().click());
  const popup = document.querySelector<HTMLElement>('[data-slot="popover-content"]');
  if (!popup) throw new Error('Missing popover');
  return popup;
};

it('edits title and language in the header without changing code or unknown tokens', async () => {
  const title = container.querySelector<HTMLInputElement>('.editor-code-title');
  const language = container.querySelector<HTMLSelectElement>('.editor-code-language');
  if (!title || !language) throw new Error('Missing code header');
  expect(title.placeholder).toBe('Add a title, e.g. a file name');
  expect(title.closest('.editor-code-header')?.getAttribute('contenteditable')).toBe('false');
  await input(title, 'Example.ts');
  await act(async () => {
    language.value = 'typescript';
    language.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(getMarkdown(editor)).toContain('```typescript custom="keep" title="Example.ts"');
  expect(editor.state.doc.firstChild?.textContent).toBe('one\ntwo // [!code ++]');
  expect(title.value).toBe('Example.ts');
});
it('uses switches, inline validation and canonical fence options', async () => {
  const popup = await openOptions();
  expect(popup.querySelectorAll('[role="switch"]')).toHaveLength(4);
  expect(popup.querySelector('details')?.open).toBe(false);
  for (const control of popup.querySelectorAll<HTMLButtonElement>('[role="switch"]')) await act(async () => control.click());
  const field = popup.querySelector<HTMLInputElement>('input[placeholder="1, 3-5"]');
  if (!field) throw new Error('Missing highlight input');
  await input(field, '3-1');
  expect(field.getAttribute('aria-invalid')).toBe('true');
  expect(popup.querySelector('[role="alert"]')?.textContent).toContain('Enter line numbers');
  await input(field, '1, 3-5');
  expect(field.getAttribute('aria-invalid')).toBe('false');
  for (const token of ['lines', 'wrap', 'nocopy', 'expandable', 'highlight={1,3,4,5}']) expect(getMarkdown(editor)).toContain(token);
  expect(editor.state.doc.firstChild?.textContent).toBe('one\ntwo // [!code ++]');
  expect(container.querySelectorAll('.editor-code-gutter')).toHaveLength(2);
  expect(container.querySelector('.editor-code-highlight')).not.toBeNull();
  expect(container.querySelector('.editor-code-add')).not.toBeNull();
});
it('closes on Escape and restores focus to Options', async () => {
  const popup = await openOptions();
  await act(async () => popup.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(optionsButton().getAttribute('aria-expanded')).toBe('false');
  await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
  expect(document.activeElement).toBe(optionsButton());
});
it('allows outside clicks and closes when the caret leaves the block', async () => {
  await openOptions();
  const outside = container.querySelector<HTMLButtonElement>('[data-outside]');
  if (!outside) throw new Error('Missing outside target');
  const clicked = vi.fn();
  outside.addEventListener('click', clicked);
  await act(async () => {
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    outside.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    outside.click();
  });
  expect(clicked).toHaveBeenCalledOnce();
  expect(optionsButton().getAttribute('aria-expanded')).toBe('false');
  await openOptions();
  await act(async () => editor.commands.setTextSelection(editor.state.doc.content.size - 1));
  expect(optionsButton().getAttribute('aria-expanded')).toBe('false');
});
it.each(['ltr', 'rtl'] as const)('keeps numbered and diff decorations LTR in a %s document', async (dir) => {
  container.dir = dir;
  await act(async () => {
    editor.commands.setTextSelection(1);
    editor.commands.updateAttributes('codeBlock', { codeOptions: { lines: true, highlight: [1] } });
  });
  expect(container.querySelector('pre')?.dir).toBe('ltr');
  const gutters = [...container.querySelectorAll<HTMLElement>('.editor-code-gutter')];
  expect(gutters.map((gutter) => gutter.dataset.number)).toEqual(['1', '2']);
  expect(gutters.map((gutter) => gutter.dataset.diff)).toEqual(['none', 'add']);
  expect(gutters.every((gutter) => gutter.getAttribute('aria-hidden') === 'true' && !gutter.textContent)).toBe(true);
});
