// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildEditorExtensions, getMarkdown } from '../tiptap-editor';
import { imagePromptKey } from './block-image';
import { addImageCaption } from './image-controls';
import { uploadEditorImage } from './image-upload';

const editors: Editor[] = [];
function makeEditor() {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  editors.push(editor);
  return editor;
}
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe('editable images', () => {
  it('saves unchanged images as Markdown and resized images as lossless HTML', () => {
    const editor = makeEditor();
    editor.commands.setImage({ src: 'https://example.com/a.png', alt: 'Diagram' });
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(imagePromptKey.getState(editor.state)).toBe(1);
    expect(getMarkdown(editor)).toBe('![Diagram](https://example.com/a.png)');
    editor.commands.updateAttributes('image', { width: 480, alt: 'A "quote" & <arrow>' });
    const output = getMarkdown(editor);
    expect(output).toBe('<img src="https://example.com/a.png" alt="A &quot;quote&quot; &amp; &lt;arrow&gt;" width="480" />');
    const json = editor.getJSON();
    editor.commands.setContent(output, { emitUpdate: false });
    expect(editor.getJSON()).toEqual(json);
    expect(getMarkdown(editor)).toBe(output);
    expect(imagePromptKey.getState(editor.state)).toBe(1);
  });
  it('prompts for clipboard images and never prompts while loading saved pages', () => {
    const editor = makeEditor();
    editor.commands.setContent('![Existing](https://example.com/old.png)', { emitUpdate: false });
    expect(imagePromptKey.getState(editor.state)).toBe(0);
    editor.view.pasteHTML('<img src="https://example.com/new.png" alt="New">', new Event('paste') as ClipboardEvent);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(editor.getAttributes('image').src).toBe('https://example.com/new.png');
    expect(imagePromptKey.getState(editor.state)).toBe(1);
  });
  it('wraps a selected image in the existing Frame node and round-trips its caption', () => {
    const editor = makeEditor();
    editor.commands.setImage({ src: '/diagram.png', alt: 'A diagram' });
    expect(addImageCaption(editor)).toBe(0);
    editor.commands.updateAttributes('mdxFrame', { caption: 'How it works' });
    const output = getMarkdown(editor);
    expect(output).toContain('<Frame caption="How it works">');
    expect(output).toContain('![A diagram](/diagram.png)');
    editor.commands.setContent(output, { emitUpdate: false });
    expect(getMarkdown(editor)).toBe(output);
  });
  it('selects completed uploads for the description prompt', async () => {
    const editor = makeEditor();
    await uploadEditorImage(editor, new File(['image'], 'diagram.png', { type: 'image/png' }), async () => 'https://example.com/upload.png');
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(editor.getAttributes('image').src).toBe('https://example.com/upload.png');
    expect(imagePromptKey.getState(editor.state)).toBe(1);
  });
  it('round-trips full width independently of the original image size', () => {
    const editor = makeEditor();
    editor.commands.setImage({ src: '/image.png' });
    editor.commands.updateAttributes('image', { width: '100%' });
    const output = getMarkdown(editor);
    expect(output).toBe('<img src="/image.png" alt="" width="100%" />');
    editor.commands.setContent(output, { emitUpdate: false });
    expect(editor.getJSON().content?.[0]?.attrs?.width).toBe('100%');
    expect(getMarkdown(editor)).toBe(output);
  });
  it.each(['left', 'right'] as const)('commits width only when the %s drag handle is released', (side) => {
    const editor = makeEditor();
    editor.commands.setImage({ src: '/image.png' });
    const image = editor.view.dom.querySelector('img');
    const handle = editor.view.dom.querySelector<HTMLElement>(`.editor-image-handle-${side}`);
    if (!image || !handle) throw new Error('Expected image drag handles');
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 100));
    handle.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true, cancelable: true }), { clientX: 200 }));
    document.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: side === 'left' ? 100 : 300 }));
    expect(getMarkdown(editor)).toBe('![](/image.png)');
    document.dispatchEvent(new Event('pointerup'));
    expect(editor.getAttributes('image').width).toBe(300);
    expect(getMarkdown(editor)).toContain('width="300"');
  });
});
