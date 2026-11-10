// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { undoDepth } from '@tiptap/pm/history';
import { TextSelection } from '@tiptap/pm/state';
import { EditorContent } from '@tiptap/react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildEditorExtensions, getMarkdown, seedMarkdown } from '../tiptap-editor';
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

/** The size control: the shared Select's combobox, named by the visible "Image size" label. */
const sizeTrigger = () => {
  const trigger = container.querySelector<HTMLElement>('[role="dialog"] [role="combobox"]');
  if (!trigger) throw new Error('missing size control');
  expect(document.getElementById(trigger.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Image size');
  return trigger;
};
const press = async (element: HTMLElement) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    element.click();
  });
};
const sizeOptions = () => [...document.querySelectorAll<HTMLElement>('[data-image-size-options] [role="option"]')];

const NL = String.fromCharCode(10);

describe('image description controls', () => {
  it.each([
    [
      'ends with an image',
      ['Install the app.', ['| Name | Value |', '| --- | --- |', '| a | b |'].join(NL), '![Screenshot](/shot.png)'].join(NL + NL),
    ],
    ['is only an image', '![Screenshot](/shot.png)'],
  ])('stays closed when a page that %s loads, with nothing selected by the user (AUTH-17)', async (_label, markdown) => {
    await mount();
    await act(async () => seedMarkdown(editor, markdown));
    expect(editor.isActive('image')).toBe(false);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    // The image itself is untouched.
    expect(getMarkdown(editor)).toContain('/shot.png');
  });

  it('stays closed across repeated seeding (switching pages), and the caret move is not an undo step', async () => {
    await mount();
    const endsWithImage = ['Intro', '![Screenshot](/shot.png)'].join(NL + NL);
    for (const markdown of [endsWithImage, endsWithImage, ['Other page', '![Chart](/chart.png)'].join(NL + NL)]) {
      await act(async () => seedMarkdown(editor, markdown));
      expect(editor.state.selection).toBeInstanceOf(TextSelection);
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    }
    // The caret move adds no undo step of its own: the history is as deep as
    // after seeding the same pages when they end with text (no caret move).
    const depthWithMove = undoDepth(editor.state);
    await act(async () => {
      root.unmount();
      editor.destroy();
    });
    container.remove();
    await mount();
    for (const markdown of [['Intro', 'End.'].join(NL + NL), ['Intro', 'End.'].join(NL + NL), ['Other page', 'End.'].join(NL + NL)]) {
      await act(async () => seedMarkdown(editor, markdown));
    }
    expect(depthWithMove).toBe(undoDepth(editor.state));
  });

  it('still opens when the user selects the image after the page loads', async () => {
    await mount();
    await act(async () => seedMarkdown(editor, ['Intro', '![Screenshot](/shot.png)'].join(NL + NL)));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    let imagePos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image') imagePos = pos;
    });
    await act(async () => {
      editor.commands.setNodeSelection(imagePos);
    });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('keeps a validated percentage width visible and editable without turning it into NaN', async () => {
    await mount();
    await act(async () => {
      editor.commands.setContent('<img src="/image.png" width="49%" />', { emitUpdate: false });
      editor.commands.setNodeSelection(0);
    });
    expect(sizeTrigger().textContent).toContain('49%');
    expect(getMarkdown(editor)).toContain('width="49%"');
  });

  it('uses the shared Select for sizes, and choosing from its list keeps the controls open', async () => {
    await mount();
    await act(async () => {
      editor.commands.setImage({ src: '/image.png', alt: 'Chart' });
    });
    expect(container.querySelector('select')).toBeNull();
    expect(sizeTrigger().textContent).toContain('Original size');
    await press(sizeTrigger());
    expect(sizeOptions().map((option) => option.textContent)).toEqual(['Original size', 'Small', 'Medium', 'Large', 'Full width']);
    await press(sizeOptions()[2] as HTMLElement);
    expect(getMarkdown(editor)).toContain('width="480"');
    // The list opens in a portal; picking from it isn't clicking away.
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(sizeTrigger().textContent).toContain('Medium');
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
    await press(sizeTrigger());
    expect(sizeOptions()).toHaveLength(5);
    // The list follows the page direction.
    expect(document.querySelector('[data-image-size-options]')?.getAttribute('dir')).toBe('rtl');
    const medium = sizeOptions().find((option) => option.textContent === 'Medium');
    if (!medium) throw new Error('size list has no Medium');
    await press(medium);
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
    await act(async () => {
      sizeTrigger().focus();
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
