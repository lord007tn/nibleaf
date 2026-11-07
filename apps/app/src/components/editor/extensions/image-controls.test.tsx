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
  it('keeps a validated percentage width visible and editable without turning it into NaN', async () => {
    await mount();
    await act(async () => {
      editor.commands.setContent('<img src="/image.png" width="49%" />', { emitUpdate: false });
      editor.commands.setNodeSelection(0);
    });
    const size = container.querySelector<HTMLSelectElement>('select');
    expect(size?.value).toBe('49%');
    await act(async () => {
      size?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(getMarkdown(editor)).toContain('width="49%"');
  });
  it('resets dismissal for a different selected image and guards caption focus after destruction (11)', async () => {
    await mount();
    await act(async () => {
      editor.commands.setContent('![First](/first.png)\n\n![Second](/second.png)', { emitUpdate: false });
      editor.commands.setNodeSelection(0);
    });
    const outside = document.createElement('button');
    container.append(outside);
    await act(async () => {
      outside.focus();
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    // A remapped position is still the same selected image, not a new selection.
    await act(async () => {
      editor.commands.insertContentAt(0, { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] });
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    let second = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image' && node.attrs.src === '/second.png') second = pos;
    });
    await act(async () => {
      editor.commands.setNodeSelection(second);
    });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === 'Add caption')
        ?.click();
    });
    await act(async () => {
      editor.destroy();
    });
    expect(() => {
      for (const frame of frames) frame(0);
    }).not.toThrow();
  });
  it('keeps a description passive until Describe image is activated, and Escape returns to writing', async () => {
    await mount();
    await act(async () => {
      editor.commands.setImage({ src: '/image.png' });
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    const input = container.querySelector<HTMLInputElement>('input');
    expect(input).not.toBeNull();
    expect(document.activeElement).not.toBe(input);
    await act(async () => {
      editor.view.dom.querySelector<HTMLButtonElement>('.editor-image button')?.click();
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
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
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    // A caption edit still leaves ProseMirror's image selection in place.
    await act(async () => {
      editor.commands.updateAttributes('mdxFrame', { caption: 'A caption' });
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement?.classList.contains('pl-frame-title-input')).toBe(true);
  });
  it('hides on outside focus or pointer interaction, and reopens for a newly inserted image', async () => {
    await mount();
    await act(async () => {
      editor.commands.setImage({ src: '/first.png' });
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    const size = container.querySelector<HTMLSelectElement>('select');
    await act(async () => {
      size?.focus();
    });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    const outside = document.createElement('button');
    outside.textContent = 'Outside editor';
    container.append(outside);
    await act(async () => {
      outside.focus();
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(editor.isActive('image')).toBe(true);
    await act(async () => {
      editor.commands.updateAttributes('image', { alt: 'Still selected' });
    });
    expect(editor.isActive('image')).toBe(true);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      editor.view.dom.querySelector('img')?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    await act(async () => {
      await vi.waitFor(() => expect(container.querySelector('[role="dialog"]')).not.toBeNull());
    });
    await act(async () => {
      outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'image', attrs: { src: '/second.png' } });
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(outside);
    await act(async () => {
      outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
