// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageUpload, uploadEditorImage } from './image-upload';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
const editors: Editor[] = [];
const makeEditor = () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit, Image, ImageUpload], content: '<p>Before</p>' });
  editors.push(editor);
  editor.commands.setTextSelection(7);
  return editor;
};
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe('image uploads', () => {
  it('shows progress and keeps the upload attached to its insertion point', async () => {
    const editor = makeEditor();
    let resolveUpload!: (url: string) => void;
    const upload = uploadEditorImage(
      editor,
      new File(['image'], 'test.png', { type: 'image/png' }),
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );
    expect(editor.view.dom.querySelector('[role="status"]')).not.toBeNull();
    editor.commands.insertContentAt(1, 'Start ');
    editor.commands.setTextSelection(1);
    resolveUpload('https://example.com/image.png');
    await upload;
    expect(editor.getJSON().content?.map((node) => node.type)).toContain('image');
    expect(editor.state.doc.firstChild?.textContent).toBe('Start Before');
    expect(editor.view.dom.querySelector('[role="status"]')).toBeNull();
  });
  it('does not insert into a replacement page when an upload finishes late', async () => {
    const editor = makeEditor();
    let resolveUpload!: (url: string) => void;
    const upload = uploadEditorImage(
      editor,
      new File(['image'], 'test.png', { type: 'image/png' }),
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );
    editor.commands.setContent('<p>Another page</p>', { emitUpdate: false });
    resolveUpload('https://example.com/image.png');
    await upload;
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(['paragraph']);
    expect(editor.state.doc.textContent).toBe('Another page');
  });
  it('rejects unsupported files before starting a request', async () => {
    const editor = makeEditor();
    const uploader = vi.fn();
    await uploadEditorImage(editor, new File(['<svg/>'], 'test.svg', { type: 'image/svg+xml' }), uploader);
    expect(uploader).not.toHaveBeenCalled();
    expect(editor.view.dom.querySelector('[role="status"]')).toBeNull();
  });
});
