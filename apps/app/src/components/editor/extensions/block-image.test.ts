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
    editor.commands.setContent(output, { emitUpdate: false });
    expect(editor.getJSON().content?.[0]?.attrs).toMatchObject({ src: 'https://example.com/a.png', alt: 'A "quote" & <arrow>', width: 480 });
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
    editor.isFocused = true;
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

describe('authored image attributes', () => {
  const light = `<img src='/light.png' alt="Light" class='block dark:hidden' loading="lazy" />`;
  const dark = '<img class="hidden dark:block" alt="Dark" src="/dark.png" />';
  function reload(editor: Editor) {
    const output = getMarkdown(editor);
    editor.commands.setContent(output, { emitUpdate: false });
    expect(getMarkdown(editor)).toBe(output);
    return output;
  }
  it('keeps the light/dark pair and untouched attribute spelling/order after an edit elsewhere', () => {
    const editor = makeEditor();
    editor.commands.setContent(`${light}\n${dark}\n\nAfter.`, { emitUpdate: false });
    expect(editor.getJSON().content?.[0]?.attrs?.class).toBe('block dark:hidden');
    expect(editor.getJSON().content?.[1]?.attrs?.class).toBe('hidden dark:block');
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' Updated.');
    const output = reload(editor);
    expect(output).toContain(light);
    expect(output).toContain(dark);
    expect(output).toContain('After. Updated.');
  });
  it('changes only alt text on a light/dark pair, preserving all other authored attributes', () => {
    const editor = makeEditor();
    editor.commands.setContent(`${light}\n${dark}`, { emitUpdate: false });
    editor.commands.setNodeSelection(0);
    editor.commands.updateAttributes('image', { alt: 'Light & "new"' });
    const output = reload(editor);
    expect(output).toContain(`<img src='/light.png' alt="Light &amp; &quot;new&quot;" class='block dark:hidden' loading="lazy" />`);
    expect(output).toContain(dark);
  });
  it('preserves className in its original JSX spelling through alt and width edits', () => {
    const editor = makeEditor();
    const image = `<img decoding='async' className="block dark:hidden" alt='Original' width='240' src='/light.png' />`;
    editor.commands.setContent(image, { emitUpdate: false });
    expect(editor.getJSON().content?.[0]?.attrs?.className).toBe('block dark:hidden');
    expect(reload(editor)).toBe(image);
    editor.commands.setNodeSelection(0);
    editor.commands.updateAttributes('image', { alt: 'New', width: 480 });
    expect(reload(editor)).toBe(`<img decoding='async' className="block dark:hidden" alt="New" width="480" src='/light.png' />`);
  });
  it('keeps width and class together when resizing and adding a Frame caption', () => {
    const editor = makeEditor();
    const image = `<img width='0240' class="block dark:hidden" src='/light.png' alt='Light' data-note="a > b" />`;
    editor.commands.setContent(image, { emitUpdate: false });
    expect(reload(editor)).toBe(image.replace(' data-note="a > b"', ''));
    editor.commands.setNodeSelection(0);
    editor.commands.updateAttributes('image', { width: 480 });
    expect(addImageCaption(editor)).toBe(0);
    editor.commands.updateAttributes('mdxFrame', { caption: 'Light version' });
    const output = reload(editor);
    expect(output).toContain('<Frame caption="Light version">');
    expect(output).toContain(`<img width="480" class="block dark:hidden" src='/light.png' alt='Light' />`);
  });
  it('keeps an ordinary Markdown image as Markdown after alt edits', () => {
    const editor = makeEditor();
    editor.commands.setContent('![Original](/image.png)', { emitUpdate: false });
    expect(reload(editor)).toBe('![Original](/image.png)');
    editor.commands.setNodeSelection(0);
    editor.commands.updateAttributes('image', { alt: 'Edited' });
    expect(reload(editor)).toBe('![Edited](/image.png)');
  });
  it.each([null, 240, 480, 720, '100%'])('keeps an authored className through the %s size preset', (width) => {
    const editor = makeEditor();
    editor.commands.setContent(`<img className='block dark:hidden' width="320" src="/light.png" alt="Light" />`, { emitUpdate: false });
    editor.commands.setNodeSelection(0);
    editor.commands.updateAttributes('image', { width, height: null });
    expect(reload(editor)).toContain("className='block dark:hidden'");
    expect(editor.getJSON().content?.[0]?.attrs).toMatchObject({ width, className: 'block dark:hidden' });
  });
  it('does not rewrite image-looking code or lose multiline/raw attribute formatting', () => {
    const editor = makeEditor();
    const image = `<img\n  className = 'hidden dark:block'\n  ALT="Dark" src="/dark.png" width="480"\n/>`;
    editor.commands.setContent(`${image}\n\n\`<img class="example" src="/code.png" />\``, { emitUpdate: false });
    expect(reload(editor)).toContain(image);
    editor.commands.setNodeSelection(0);
    editor.commands.updateAttributes('image', { alt: 'Updated' });
    const output = reload(editor);
    expect(output).toContain(image.replace('ALT="Dark"', 'ALT="Updated"'));
    expect(output).toContain('`<img class="example" src="/code.png" />`');
  });
});
