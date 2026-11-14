/** @vitest-environment jsdom */
/**
 * The load-time trigger of P1-ED-001, pinned down: StarterKit's trailing-node
 * plugin appends an empty paragraph after a page that ends with a block, on the
 * next transaction. The first one after load was the editor's own empty redraw
 * of the comment highlights, which TipTap then reported as an update, so the
 * editor emitted its serialization and autosave sent the page.
 */
import { STARTER_FAQ_CONTENT, STARTER_GETTING_STARTED_CONTENT } from '@nibleaf/auth/starter-content';
import { Editor } from '@tiptap/core';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, useLocale: () => ({ locale: 'en', t: (key: string) => key }) }));

import { markdownToEmit, redrawTransaction } from './editor-change-origin';
import { buildEditorExtensions, getMarkdown, seedMarkdown, TiptapEditor } from './tiptap-editor';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const cleanups: Array<() => Promise<void> | void> = [];
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
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const ENDS_WITH_A_CODE_BLOCK = 'Intro paragraph that wraps\nacross two lines.\n\n```js\nconst a = 1;\n```\n';
const ENDS_WITH_A_PARAGRAPH = 'Intro paragraph that wraps\nacross two lines.\n\n## Heading\n\nLast paragraph.\n';
// The repro pages of #602 and #603, which grow on each save: opening them must not save.
const UNCLOSED_FENCE_602 = 'Intro.\n\n```js\na\nb';
const STEP_WITH_INDENTED_FENCE_603 = '<Steps>\n<Step title="One">\n\n    ```js\n    const a = 1;\n    ```\n\n</Step>\n</Steps>';

describe('opening a page in TiptapEditor emits no change', () => {
  it.each([
    ['FAQ (ends with </AccordionGroup>)', STARTER_FAQ_CONTENT],
    ['Getting started (ends with </CardGroup>)', STARTER_GETTING_STARTED_CONTENT],
    ['a page ending with a code block', ENDS_WITH_A_CODE_BLOCK],
    ['a page ending with a paragraph', ENDS_WITH_A_PARAGRAPH],
    ['the #602 page (an unclosed fence at the end)', UNCLOSED_FENCE_602],
    ['the #603 page (a Step holding an indented fence)', STEP_WITH_INDENTED_FENCE_603],
  ])('%s, including the comment-highlight redraws', async (_name, value) => {
    const onChange = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    cleanups.push(async () => {
      await act(async () => root.unmount());
      container.remove();
    });
    await act(async () => root.render(<TiptapEditor value={value} onChange={onChange} comments={[]} />));
    // TipTap's `create` event runs on a timer; the redraws are microtasks.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    // New comment markers redraw the highlights again.
    await act(async () => root.render(<TiptapEditor value={value} onChange={onChange} comments={[]} activeCommentId="c-1" />));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a keystroke still emits, and only once', async () => {
    const onChange = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    cleanups.push(async () => {
      await act(async () => root.unmount());
      container.remove();
    });
    await act(async () => root.render(<TiptapEditor value={STARTER_FAQ_CONTENT} onChange={onChange} />));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
    act(() => editor.view.dispatch(editor.state.tr.insertText('!', 1)));
    expect(onChange).toHaveBeenCalledOnce();
    // Only the first paragraph changed: the others keep their source lines.
    expect(onChange.mock.calls[0]?.[0]).toBe(
      STARTER_FAQ_CONTENT.replaceAll(
        'A pattern for frequently asked questions — accordions keep long answer lists\nscannable.',
        '!A pattern for frequently asked questions — accordions keep long answer lists scannable.',
      ),
    );
  });
});

describe('the trailing paragraph on a redraw', () => {
  const load = (markdown: string) => {
    const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
    cleanups.push(() => editor.destroy());
    // As the first transaction after load: the initial document, not yet seeded.
    editor.commands.setContent(markdown, { emitUpdate: false });
    return editor;
  };

  it('was appended to an empty transaction, and reported as an update (the trigger)', () => {
    const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions(), content: '<pre><code>a</code></pre>' });
    cleanups.push(() => editor.destroy());
    const onUpdate = vi.fn();
    editor.on('update', onUpdate);
    editor.view.dispatch(editor.state.tr);
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(editor.state.doc.lastChild?.type.name).toBe('paragraph');
  });

  it('is not added on a redraw any more, and a redraw is never an update', () => {
    const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions(), content: '<pre><code>a</code></pre>' });
    cleanups.push(() => editor.destroy());
    const onUpdate = vi.fn();
    editor.on('update', onUpdate);
    editor.view.dispatch(redrawTransaction(editor.state.tr));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(editor.state.doc.lastChild?.type.name).toBe('codeBlock');
  });

  it('serializes to nothing, so a seeded page reads the same with it', () => {
    const editor = load(STARTER_FAQ_CONTENT);
    seedMarkdown(editor, STARTER_FAQ_CONTENT);
    expect(editor.state.doc.lastChild?.type.name).toBe('paragraph');
    expect(getMarkdown(editor)).toBe(STARTER_FAQ_CONTENT.trimEnd());
  });
});

describe('markdownToEmit', () => {
  const loaded = { source: 'Line one\nline two.\n', serialized: 'Line one line two.' };
  it.each([
    ['nothing loaded yet', null, 'Edited.', 'Edited.'],
    ['back to the loaded document: the source itself', loaded, 'Line one line two.', 'Line one\nline two.\n'],
    ['an edit: keeps the final newline the page had', loaded, 'Line one line three.', 'Line one line three.\n'],
    ['an emptied page stays empty', loaded, '', ''],
  ])('%s', (_name, from, serialized, emitted) => {
    expect(markdownToEmit(from, serialized)).toBe(emitted);
  });
});
