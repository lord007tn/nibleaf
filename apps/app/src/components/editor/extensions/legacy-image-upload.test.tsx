// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildEditorExtensions, getMarkdown } from '../tiptap-editor';
import type { ImageUploader } from './image-upload';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
const inline = 'data:image/png;base64,iVBORw0KGgo=';
const hosted = '/api/public/assets/projects/p/assets/diagram.png';
const editors: Editor[] = [];
const mounts: { root: Root; host: HTMLElement }[] = [];
function make(onUpload?: ImageUploader, { canEdit = (): boolean => true, dir = 'ltr' as 'ltr' | 'rtl' } = {}) {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions({ onUpload, canEdit, dir }) });
  editors.push(editor);
  const host = document.createElement('div');
  host.dir = dir;
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(createElement(EditorContent, { editor })));
  mounts.push({ root, host });
  return editor;
}
const button = (editor: Editor, label: string) => Array.from(editor.view.dom.querySelectorAll('button')).find((node) => node.textContent === label);
const notice = (editor: Editor) => editor.view.dom.querySelector('.editor-image-legacy');
beforeEach(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 1, 1);
});
afterEach(() => {
  for (const { root, host } of mounts.splice(0)) {
    root.unmount();
    host.remove();
  }
  for (const editor of editors.splice(0)) editor.destroy();
});

describe('inline base64 images in the editor', () => {
  it('says the image is missing from the published site and uploads it in one click, keeping its attributes', async () => {
    const upload = vi.fn<ImageUploader>().mockResolvedValue(hosted);
    const editor = make(upload);
    editor.commands.setContent(
      `<img src="${inline}" alt="Architecture" title="Overview" width="480" height="240" class="block dark:hidden" />\n\nAfter`,
      { emitUpdate: false },
    );
    expect(editor.state.doc.firstChild?.type.name).toBe('legacyImage');
    expect(notice(editor)?.textContent).toContain('Not shown on your published site');
    const action = button(editor, 'Upload image');
    expect(action?.hidden).toBe(false);
    // The action names what it changes for screen-reader users.
    expect(document.getElementById(action?.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Not shown on your published site');
    action?.click();
    await vi.waitFor(() => expect(editor.state.doc.firstChild?.type.name).toBe('image'));
    const file = upload.mock.calls[0]?.[0];
    expect(file).toBeInstanceOf(File);
    expect(file?.type).toBe('image/png');
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({
      src: hosted,
      alt: 'Architecture',
      title: 'Overview',
      width: 480,
      height: 240,
      class: 'block dark:hidden',
      descriptionPending: false,
    });
    expect(editor.state.doc.childCount).toBe(2);
    const saved = getMarkdown(editor);
    expect(saved).not.toContain('base64');
    expect(saved).toContain(`src="${hosted}"`);
    expect(saved).toContain('alt="Architecture"');
    expect(saved).toContain('class="block dark:hidden"');
    expect(notice(editor)).toBeNull();
  });

  it('saves a Markdown inline image as Markdown with the hosted address', async () => {
    const upload = vi.fn<ImageUploader>().mockResolvedValue({ url: hosted });
    const editor = make(upload, { dir: 'rtl' });
    editor.commands.setContent(`![مخطط النظام](${inline})`, { emitUpdate: false });
    button(editor, 'Upload image')?.click();
    await vi.waitFor(() => expect(editor.state.doc.firstChild?.type.name).toBe('image'));
    expect(getMarkdown(editor)).toBe(`![مخطط النظام](${hosted})`);
  });

  it('keeps the inline image when the upload fails or its card is removed', async () => {
    const upload = vi.fn<ImageUploader>().mockResolvedValue(null);
    const editor = make(upload);
    const source = `![Diagram](${inline})`;
    editor.commands.setContent(source, { emitUpdate: false });
    button(editor, 'Upload image')?.click();
    await vi.waitFor(() => expect(editor.view.dom.textContent).toContain('This image could not be uploaded'));
    button(editor, 'Remove')?.click();
    await vi.waitFor(() => expect(editor.view.dom.textContent).not.toContain('This image could not be uploaded'));
    expect(editor.state.doc.firstChild?.type.name).toBe('legacyImage');
    expect(getMarkdown(editor)).toBe(source);
  });

  it('does not swap an inline image the writer deleted during the upload', async () => {
    let resolve!: (url: string) => void;
    const upload = vi.fn<ImageUploader>().mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const editor = make(upload);
    editor.commands.setContent(`![Diagram](${inline})\n\nAfter`, { emitUpdate: false });
    button(editor, 'Upload image')?.click();
    await vi.waitFor(() => expect(upload).toHaveBeenCalled());
    editor.commands.setContent('After', { emitUpdate: false });
    resolve(hosted);
    await vi.waitFor(() => expect(editor.view.dom.querySelector('[role="status"]')).toBeNull());
    expect(getMarkdown(editor)).toBe('After');
  });

  it('shows the notice but no upload action in review mode or without an uploader', () => {
    for (const editor of [make(vi.fn<ImageUploader>(), { canEdit: () => false }), make()]) {
      editor.commands.setContent(`![Diagram](${inline})`, { emitUpdate: false });
      expect(notice(editor)?.textContent).toContain('Not shown on your published site');
      expect(button(editor, 'Upload image')?.hidden).toBe(true);
    }
  });

  it('shows no notice on an ordinary hosted image', () => {
    const editor = make(vi.fn<ImageUploader>());
    editor.commands.setContent(`![Diagram](${hosted})`, { emitUpdate: false });
    expect(notice(editor)).toBeNull();
    expect(button(editor, 'Upload image')).toBeUndefined();
  });
});
