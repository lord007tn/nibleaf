// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import { act, createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownRenderer } from '../markdown';
import RichMarkdown from '../markdown-rich';
import { alignTableColumns } from './extensions/aligned-table';
import { TableBubbleMenu } from './table-menu';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

beforeEach(() => {
  vi.stubGlobal('ClipboardEvent', class extends Event {});
  // The slash menu is built on cmdk, whose list measures itself with ResizeObserver
  // and scrolls the active item into view; jsdom implements neither (same stubs as
  // the other cmdk-based tests, e.g. command-palette.test.tsx).
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 1, 1);
});
const editors: Editor[] = [];
const mounts: { root: Root; host: HTMLElement }[] = [];
function make() {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  editors.push(editor);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(createElement(EditorContent, { editor })));
  mounts.push({ root, host });
  return editor;
}
afterEach(() => {
  for (const { root, host } of mounts.splice(0)) {
    root.unmount();
    host.remove();
  }
  for (const editor of editors.splice(0)) editor.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Table alignment through the editor and reader', () => {
  it.each(['ltr', 'rtl'] as const)('shows active and default alignment and matching physical reader alignment in %s', async (dir) => {
    const editor = make();
    editor.commands.setContent('| A |\n| --- |\n| B |', { emitUpdate: false });
    editor.commands.setTextSelection(4);
    const mounted = mounts.at(-1);
    if (!mounted) throw new Error('Expected a mounted editor');
    const { root, host } = mounted;
    await act(async () =>
      root.render(
        <>
          <EditorContent editor={editor} />
          <TableBubbleMenu editor={editor} dir={dir} />
        </>,
      ),
    );
    const find = (label: string) => Array.from(host.querySelectorAll('button')).find((element) => element.getAttribute('aria-label') === label);
    expect(find('Default alignment')?.getAttribute('aria-pressed')).toBe('true');
    await act(async () => {
      find('Align to start')?.click();
    });
    const physical = dir === 'rtl' ? 'right' : 'left';
    expect(find('Align to start')?.getAttribute('aria-pressed')).toBe('true');
    expect(getMarkdown(editor)).toContain(dir === 'rtl' ? '---:' : ':---');
    for (const rich of [false, true]) {
      const render = (content: string) =>
        renderToStaticMarkup(rich ? createElement(RichMarkdown, { content }) : createElement(MarkdownRenderer, { content }));
      const parsed = document.createElement('div');
      parsed.innerHTML = render(getMarkdown(editor));
      expect(parsed.querySelector('th')?.getAttribute('align') ?? parsed.querySelector('th')?.style.textAlign).toBe(physical);
      editor.commands.toggleHeaderRow();
      alignTableColumns(editor, physical);
      parsed.innerHTML = renderToStaticMarkup(createElement(RichMarkdown, { content: getMarkdown(editor) }));
      expect(parsed.querySelector('td')?.getAttribute('align') ?? parsed.querySelector('td')?.style.textAlign).toBe(physical);
      editor.commands.toggleHeaderRow();
    }
    await act(async () => {
      find('Default alignment')?.click();
    });
    expect(getMarkdown(editor)).toContain('| --- |');
  });
});
