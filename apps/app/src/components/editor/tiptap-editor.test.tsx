/** @vitest-environment jsdom */
/**
 * Page-switch safety for the Markdown-controlled TipTap editor: an empty `value`
 * must always clear the document, and re-seeding must never bounce the previous
 * document back through `onChange` (that is how a new page inherited the
 * previous page's body in production).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Editor } from '@tiptap/core';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));

import { buildEditorExtensions, getMarkdown, seedMarkdown, TiptapEditor } from './tiptap-editor';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const roots: Array<{ root: ReturnType<typeof createRoot>; container: HTMLElement }> = [];

/** Floating menus (bubble menu, drag handle) rely on browser APIs jsdom lacks. */
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
});

afterEach(async () => {
  for (const { root, container } of roots.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
});

/** Seeding is deferred to a microtask — let it settle inside `act`. */
const settle = () =>
  act(async () => {
    await Promise.resolve();
  });

const mount = async (element: React.ReactElement) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push({ root, container });
  await act(async () => root.render(element));
  // Seeding is deferred to a microtask — let it settle.
  await settle();
  return { root, container, prose: () => container.querySelector('.ProseMirror') };
};

describe('seedMarkdown', () => {
  it('clears the document for an empty source', () => {
    const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
    try {
      seedMarkdown(editor, '# Previous page\n\nBody text.');
      expect(getMarkdown(editor)).toContain('Previous page');
      seedMarkdown(editor, '');
      expect(getMarkdown(editor)).toBe('');
      expect(editor.state.doc.textContent).toBe('');
      seedMarkdown(editor, '   \n');
      expect(getMarkdown(editor)).toBe('');
    } finally {
      editor.destroy();
    }
  });

  it('does not emit an update while seeding', () => {
    const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
    const onUpdate = vi.fn();
    editor.on('update', onUpdate);
    try {
      seedMarkdown(editor, 'Hello');
      seedMarkdown(editor, '');
      expect(onUpdate).not.toHaveBeenCalled();
    } finally {
      editor.destroy();
    }
  });
});

describe('TiptapEditor', () => {
  it.each(['ltr', 'rtl'] as const)('hides the count pill while a table bubble is open at 390px in %s, then restores it', async (dir) => {
    const style = document.createElement('style');
    style.textContent = readFileSync(resolve('src/components/editor/tiptap.css'), 'utf8');
    document.head.append(style);
    const previousWidth = window.innerWidth;
    vi.stubGlobal('innerWidth', 390);
    const rect = new DOMRect(0, 0, 100, 20);
    Range.prototype.getBoundingClientRect = () => rect;
    Range.prototype.getClientRects = () => Object.assign([rect], { item: () => rect });
    try {
      const { container, prose } = await mount(<TiptapEditor dir={dir} value={'Before\n\n| Name |\n| --- |\n| Ada |'} onChange={vi.fn()} />);
      await act(async () => {
        await vi.waitFor(() => expect(prose()?.querySelector('table'), prose()?.innerHTML).not.toBeNull());
      });
      const count = container.querySelector('.pl-editor-word-count');
      const element = prose() as HTMLElement & { editor: Editor };
      const editor = element.editor;
      expect(count).not.toBeNull();
      if (!count) throw new Error('Expected the editor word count');
      await act(async () => {
        editor.commands.setTextSelection(1);
      });
      await act(async () => {
        await vi.waitFor(() => expect(container.querySelector('[data-editor-bubble-menu]')).toBeNull());
      });
      expect(getComputedStyle(count).visibility).toBe('visible');
      await act(async () => {
        editor.commands.setTextSelection(12);
      });
      expect(editor.isActive('table')).toBe(true);
      await act(async () => {
        await vi.waitFor(() => expect(container.querySelector('[data-editor-bubble-menu]')).not.toBeNull());
      });
      expect(container.querySelector('[aria-label="editor.table.alignCenter"]')).not.toBeNull();
      expect(container.querySelector('.pl-editor:has([data-editor-bubble-menu]) .pl-editor-word-count')).toBe(count);
      expect(getComputedStyle(count).visibility).toBe('hidden');
      await act(async () => {
        editor.commands.setTextSelection(1);
      });
      await act(async () => {
        await vi.waitFor(() => expect(container.querySelector('[data-editor-bubble-menu]')).toBeNull());
      });
      expect(getComputedStyle(count).visibility).toBe('visible');
    } finally {
      style.remove();
      vi.stubGlobal('innerWidth', previousWidth);
    }
  });
  it('renders rich text as a document workspace with an accessible shadcn toolbar', async () => {
    const onChange = vi.fn();
    const { container, prose } = await mount(
      <TiptapEditor
        dir="rtl"
        lang="ar"
        onChange={onChange}
        titleSlot={<input aria-label="Document title" defaultValue="عنوان المستند" />}
        value="English text داخل مستند عربي"
        variant="wysiwyg"
      />,
    );

    const editor = container.querySelector('[data-editor-variant="wysiwyg"]');
    const page = container.querySelector('.pl-document-page');
    expect(editor?.getAttribute('lang')).toBe('ar');
    expect(container.querySelector('[role="toolbar"]')).not.toBeNull();
    expect(page?.querySelector('[aria-label="Document title"]')).not.toBeNull();
    expect(page?.contains(prose())).toBe(true);
    expect(prose()?.getAttribute('dir')).toBe('rtl');
    // The first English letter makes this mixed paragraph LTR inside the RTL page.
    expect(prose()?.querySelector('p')?.getAttribute('dir')).toBe('ltr');
  });

  it('renders a read-only page for Viewers: not editable, and no editing toolbar or menus', async () => {
    const onChange = vi.fn();
    const { container, prose } = await mount(<TiptapEditor editable={false} onChange={onChange} value="Read me" variant="wysiwyg" />);
    expect(prose()?.textContent).toContain('Read me');
    expect(prose()?.getAttribute('contenteditable')).toBe('false');
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('mounts with the given markdown', async () => {
    const onChange = vi.fn();
    const { prose } = await mount(<TiptapEditor value="Hello from page A" onChange={onChange} />);
    expect(prose()?.textContent).toContain('Hello from page A');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clears the document when the value becomes empty and never echoes the old body', async () => {
    const onChange = vi.fn();
    const { root, prose } = await mount(<TiptapEditor value="Hello from page A" onChange={onChange} />);
    expect(prose()?.textContent).toContain('Hello from page A');

    await act(async () => root.render(<TiptapEditor value="" onChange={onChange} />));
    await settle();

    expect(prose()?.textContent).toBe('');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('re-seeds to a different page body without emitting onChange', async () => {
    const onChange = vi.fn();
    const { root, prose } = await mount(<TiptapEditor value="Page A" onChange={onChange} />);

    await act(async () => root.render(<TiptapEditor value="صفحة ب" onChange={onChange} />));
    await settle();

    expect(prose()?.textContent).toBe('صفحة ب');
    expect(prose()?.textContent).not.toContain('Page A');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a fresh instance (keyed remount) never sees the previous document', async () => {
    const onChange = vi.fn();
    const { root, prose } = await mount(<TiptapEditor key="page-a" value="Page A body" onChange={onChange} />);
    expect(prose()?.textContent).toContain('Page A body');

    await act(async () => root.render(<TiptapEditor key="page-b" value="" onChange={onChange} />));
    await settle();

    expect(prose()?.textContent).toBe('');
    expect(onChange).not.toHaveBeenCalled();
  });
});
