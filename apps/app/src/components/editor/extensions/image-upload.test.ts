// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageUpload, uploadEditorImage } from './image-upload';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
const editors: Editor[] = [];
const roots: { root: Root; container: HTMLDivElement }[] = [];
const makeEditor = () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit, Image, ImageUpload], content: '<p>Before</p>' });
  editors.push(editor);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  flushSync(() => root.render(createElement(EditorContent, { editor })));
  roots.push({ root, container });
  editor.commands.setTextSelection(7);
  return editor;
};
afterEach(() => {
  for (const { root, container } of roots.splice(0)) {
    root.unmount();
    container.remove();
  }
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
    await vi.waitFor(() => expect(editor.view.dom.querySelector('[role="status"]')).not.toBeNull());
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
  it('keeps failed uploads with Retry and Remove, then replaces only the retried card', async () => {
    const editor = makeEditor();
    const uploader = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('https://example.com/retried.png');
    await uploadEditorImage(editor, new File(['image'], 'retry.png', { type: 'image/png' }), uploader);
    await vi.waitFor(() => expect(editor.view.dom.textContent).toContain('retry.png'));
    expect(editor.view.dom.textContent).toContain('This image could not be uploaded');
    const retry = Array.from(editor.view.dom.querySelectorAll('button')).find((button) => button.textContent === 'Retry');
    expect(retry).toBeDefined();
    retry?.click();
    await vi.waitFor(() => expect(editor.view.dom.querySelector('[role="status"]')).toBeNull());
    expect(uploader).toHaveBeenCalledTimes(2);
    expect(editor.getJSON().content?.find((node) => node.type === 'image')?.attrs?.src).toBe('https://example.com/retried.png');
  });
  it('tracks concurrent byte progress separately and ignores removed uploads', async () => {
    const editor = makeEditor();
    const uploads: { progress: (percent: number) => void; resolve: (url: string) => void }[] = [];
    const uploader = (_file: File, progress?: (percent: number) => void) => {
      if (!progress) throw new Error('Expected upload progress callback');
      return new Promise<string>((resolve) => uploads.push({ progress, resolve }));
    };
    const first = uploadEditorImage(editor, new File(['a'], 'one.png', { type: 'image/png' }), uploader);
    const second = uploadEditorImage(editor, new File(['b'], 'two.png', { type: 'image/png' }), uploader);
    await vi.waitFor(() => expect(editor.view.dom.querySelectorAll('progress')).toHaveLength(2));
    const [one, two] = uploads;
    if (!one || !two) throw new Error('Expected two pending uploads');
    one.progress(25);
    two.progress(70);
    await vi.waitFor(() => expect(Array.from(editor.view.dom.querySelectorAll('progress')).map((node) => node.value)).toEqual([25, 70]));
    const remove = Array.from(editor.view.dom.querySelectorAll('button')).find((node) => node.textContent === 'Remove');
    remove?.click();
    one.resolve('https://example.com/removed.png');
    two.resolve('https://example.com/kept.png');
    await Promise.all([first, second]);
    expect(
      editor
        .getJSON()
        .content?.filter((node) => node.type === 'image')
        .map((node) => node.attrs?.src),
    ).toEqual(['https://example.com/kept.png']);
  });
  it('shows an indeterminate progress bar until byte progress is available', async () => {
    const editor = makeEditor();
    let resolve!: (url: string | null) => void;
    const upload = uploadEditorImage(
      editor,
      new File(['image'], 'unknown.png', { type: 'image/png' }),
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await vi.waitFor(() => expect(editor.view.dom.querySelector('progress')).not.toBeNull());
    expect(editor.view.dom.querySelector('progress')?.hasAttribute('value')).toBe(false);
    resolve(null);
    await upload;
    await vi.waitFor(() => expect(editor.view.dom.querySelector('progress')).toBeNull());
    expect(editor.view.dom.querySelector('[role="status"]')).not.toBeNull();
  });
});
