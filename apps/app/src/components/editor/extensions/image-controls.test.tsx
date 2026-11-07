// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildEditorExtensions, getMarkdown } from '../tiptap-editor';
import { ImageControls } from './image-controls';

let editor: Editor;
let root: Root;
let container: HTMLDivElement;
async function mount(dir: 'ltr' | 'rtl' = 'ltr') {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions({ dir }) });
  root = createRoot(container);
  await act(async () => {
    root.render(
      <>
        <EditorContent editor={editor} />
        <ImageControls editor={editor} dir={dir} />
      </>,
    );
  });
}
afterEach(async () => {
  await act(async () => {
    root?.unmount();
    editor?.destroy();
  });
  container?.remove();
  vi.unstubAllGlobals();
});

describe('image description controls', () => {
  it('focuses a labelled description after insertion, and Escape returns to writing', async () => {
    await mount();
    await act(async () => {
      editor.commands.setImage({ src: '/image.png' });
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    const input = container.querySelector<HTMLInputElement>('input');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(input?.getAttribute('aria-describedby')).toBeTruthy();
    expect(container.textContent).toContain("Describe what this image shows for people who can't see it");
    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(editor.state.selection.toJSON().type).toBe('text');
    expect(getMarkdown(editor)).toContain('![](/image.png)');
  });
  it('offers keyboard sizing, mirrors RTL controls and focuses the existing caption input', async () => {
    await mount('rtl');
    await act(async () => {
      editor.commands.setImage({ src: '/image.png', alt: 'مخطط' });
    });
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('dir')).toBe('rtl');
    const size = container.querySelector<HTMLSelectElement>('select');
    expect(size?.options).toHaveLength(5);
    await act(async () => {
      if (size) {
        size.value = '480';
        size.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    expect(getMarkdown(editor)).toContain('width="480"');
    const caption = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Add caption');
    await act(async () => {
      caption?.click();
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(editor.state.doc.firstChild?.type.name).toBe('mdxFrame');
    expect(document.activeElement?.classList.contains('pl-frame-title-input')).toBe(true);
  });
});
