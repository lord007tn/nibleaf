// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import { act, createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RichMarkdown from '../../markdown-rich';
import { buildEditorExtensions, getMarkdown } from '../tiptap-editor';
import { imagePromptKey } from './block-image';
import { addImageCaption, ImageControls } from './image-controls';
import { type ImageUploader, uploadEditorImage } from './image-upload';
import { createSlashItems } from './slash-command';

beforeEach(() => {
  vi.stubGlobal('ClipboardEvent', class extends Event {});
  // The slash menu is built on cmdk, whose list measures itself with ResizeObserver
  // and scrolls the active item into view; jsdom implements neither (same stubs as
  // the other cmdk-based tests, e.g. command-palette.test.tsx).
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
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 1, 1);
});
const editors: Editor[] = [];
const mounts: { root: Root; host: HTMLElement }[] = [];
function make(canEdit = () => true, onUpload?: ImageUploader) {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions({ canEdit, onUpload }) });
  editors.push(editor);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(createElement(EditorContent, { editor })));
  mounts.push({ root, host });
  return editor;
}
const file = () => new File(['image'], 'diagram.png', { type: 'image/png' });
const button = (editor: Editor, label: string) =>
  Array.from(editor.view.dom.querySelectorAll('button')).find((element) => element.textContent === label);
afterEach(() => {
  for (const { root, host } of mounts.splice(0)) {
    root.unmount();
    host.remove();
  }
  for (const editor of editors.splice(0)) editor.destroy();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Image upload and sizing controls', () => {
  it('never moves selection or focus when typing during upload', async () => {
    const editor = make();
    editor.commands.setContent('Before\n\nAfter', { emitUpdate: false });
    editor.commands.setTextSelection(7);
    editor.isFocused = true;
    let resolve!: (url: string) => void;
    const pending = uploadEditorImage(
      editor,
      file(),
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent(' typed');
    const parent = editor.state.selection.$from.parent.textContent;
    const focus = document.activeElement;
    resolve('/done.png');
    await pending;
    expect(editor.state.selection.$from.parent.textContent).toBe(parent);
    expect(document.activeElement).toBe(focus);
    expect(imagePromptKey.getState(editor.state)).toBe(0);
    expect(editor.view.dom.textContent).toContain('Describe image');
  });

  it('pastes an article with three images without selecting an image or focusing its prompt', () => {
    const editor = make();
    const focus = document.activeElement;
    editor.view.pasteHTML('<p>Start</p><img src="/1.png"><p>Middle</p><img src="/2.png"><img src="/3.png"><p>End</p>');
    expect(editor.state.selection.toJSON().type).toBe('text');
    expect(imagePromptKey.getState(editor.state)).toBe(0);
    expect(document.activeElement).toBe(focus);
  });

  it('makes Retry idempotent, Remove aborts, and late completion inserts nothing', async () => {
    const editor = make();
    let signal: AbortSignal | undefined;
    let resolve!: (url: string) => void;
    const upload = vi
      .fn<ImageUploader>()
      .mockResolvedValueOnce(null)
      .mockImplementation((_file, _progress, requestSignal) => {
        signal = requestSignal;
        return new Promise((done) => {
          resolve = done;
        });
      });
    await uploadEditorImage(editor, file(), upload);
    await vi.waitFor(() => expect(button(editor, 'Retry')).toBeDefined());
    const retry = button(editor, 'Retry');
    retry?.click();
    retry?.click();
    expect(upload).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(button(editor, 'Remove')?.getAttribute('aria-label')).toBe('Remove diagram.png'));
    button(editor, 'Remove')?.click();
    expect(signal?.aborted).toBe(true);
    resolve('/late.png');
    await Promise.resolve();
    await Promise.resolve();
    expect(getMarkdown(editor)).not.toContain('/late.png');
  });

  it('restores upload progress, failure and retry state when widgets are recreated', async () => {
    const editor = make();
    let progress: ((n: number) => void) | undefined;
    let resolve!: (url: string | null) => void;
    const upload: ImageUploader = (_file, onProgress) => {
      progress = onProgress;
      return new Promise((done) => {
        resolve = done;
      });
    };
    const pending = uploadEditorImage(editor, file(), upload);
    progress?.(42);
    await vi.waitFor(() => expect(editor.view.dom.querySelector('progress')?.value).toBe(42));
    editor.view.updateState(editor.state.reconfigure({ plugins: [...editor.state.plugins] }));
    await vi.waitFor(() => expect(editor.view.dom.querySelector('progress')?.value).toBe(42));
    resolve(null);
    await pending;
    await vi.waitFor(() => expect(button(editor, 'Retry')).toBeDefined());
    // Force the actual decoration widget DOM to be rebuilt.
    editor.view.dom.querySelector('.react-renderer')?.remove();
    editor.view.updateState(editor.state);
    await vi.waitFor(() => expect(editor.view.dom.textContent).toContain('This image could not be uploaded'));
    button(editor, 'Retry')?.click();
    await vi.waitFor(() => expect(button(editor, 'Retry')?.disabled).toBe(true));
    resolve('/retried.png');
  });

  it('shows Finishing during confirm and a timeout with Retry after two minutes', async () => {
    const editor = make();
    let finishing: (() => void) | undefined;
    const pending = uploadEditorImage(editor, file(), (_file, _progress, _signal, onFinishing) => {
      finishing = onFinishing;
      return new Promise(() => {
        /* Simulate a request that never settles. */
      });
    });
    finishing?.();
    await vi.waitFor(() => expect(editor.view.dom.textContent).toContain('Finishing…'));
    expect(editor.view.dom.querySelector('progress')?.hasAttribute('value')).toBe(false);
    vi.useFakeTimers(); // the operation's timer was created with real timers; use a second upload for timeout.
    const timed = uploadEditorImage(
      editor,
      file(),
      () =>
        new Promise(() => {
          /* Simulate a request that never settles. */
        }),
    );
    await vi.advanceTimersByTimeAsync(120_001);
    await timed;
    vi.useRealTimers();
    await vi.waitFor(() => expect(editor.view.dom.textContent).toContain('The upload took too long. Please retry.'));
    button(editor, 'Remove')?.click();
    void pending;
  });

  it('blocks every document mutation from image and upload controls in comment mode', async () => {
    let comment = false;
    const editor = make(() => !comment);
    editor.commands.setImage({ src: '/image.png' });
    await uploadEditorImage(editor, file(), async () => null);
    await vi.waitFor(() => expect(button(editor, 'Retry')).toBeDefined());
    const retry = button(editor, 'Retry');
    const remove = button(editor, 'Remove');
    comment = true;
    editor.commands.setMeta('review-mode', true);
    const before = getMarkdown(editor);
    retry?.click();
    remove?.click();
    editor.commands.setNodeSelection(0);
    editor.commands.updateAttributes('image', { alt: 'Forbidden', width: 480 });
    expect(addImageCaption(editor)).toBeNull();
    const handle = editor.view.dom.querySelector('.editor-image-handle');
    handle?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10 }));
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 100 }));
    document.dispatchEvent(new Event('pointerup'));
    const mounted = mounts.at(-1);
    if (!mounted) throw new Error('Expected a mounted editor');
    const { root, host } = mounted;
    await act(async () =>
      root.render(
        <>
          <EditorContent editor={editor} />
          <ImageControls editor={editor} dir="ltr" />
        </>,
      ),
    );
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(getMarkdown(editor)).toBe(before);
    await vi.waitFor(() => expect(button(editor, 'Remove')?.disabled).toBe(true));
  });

  it('keeps preset width inside a Frame and labels both theme variants for writers', () => {
    const editor = make();
    editor.commands.setContent('<img src="/light.png" class="block dark:hidden" />\n\n<img src="/dark.png" className="hidden dark:block" />', {
      emitUpdate: false,
    });
    expect(editor.view.dom.textContent).toContain('Light theme image');
    expect(editor.view.dom.textContent).toContain('Dark theme image');
    editor.commands.setNodeSelection(0);
    editor.commands.updateAttributes('image', { width: 480 });
    expect(addImageCaption(editor)).toBe(0);
    const saved = getMarkdown(editor);
    expect(saved).toContain('width="480"');
    // Saved as plain MDX: the image goes straight into the Frame, with no wrapper of our own.
    expect(saved).not.toContain('<p>');
    const reader = document.createElement('div');
    reader.innerHTML = renderToStaticMarkup(createElement(RichMarkdown, { content: saved }));
    const sized = reader.querySelector<HTMLImageElement>('img[width="480"]');
    expect(sized).not.toBeNull();
    // The Frame stretches only images without a width, so this one keeps 480 px.
    const frameBody = sized?.closest('figure > div');
    expect(frameBody?.className).toContain('[&>img:not([width])]:w-full');
    expect(frameBody?.className).not.toMatch(/\[&>img\]:w-full|\[&>\.reader-image>img\]:w-full/);
    // Display is left to the image's own classes, so a sized light/dark pair
    // still shows only the image for the current theme.
    expect(frameBody?.className).not.toMatch(/\]:(?:block|inline|flex|hidden|mx-auto)\b/);
    editor.commands.setContent(saved, { emitUpdate: false });
    const image = editor.view.dom.querySelector<HTMLElement>('.editor-image');
    expect(image?.style.width).toBe('480px');
    expect(editor.state.doc.firstChild?.firstChild?.attrs.width).toBe(480);
  });

  it('hides selected resize handles in review mode using the real CSS cascade', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync('src/components/editor/tiptap.css', 'utf8');
    document.head.append(style);
    const host = document.createElement('div');
    host.className = 'pl-editor is-comment-mode';
    host.innerHTML =
      '<div class="ProseMirror"><div class="editor-image ProseMirror-selectednode"><span class="editor-image-handle"></span></div></div>';
    document.body.append(host);
    try {
      const handle = host.querySelector('span');
      if (!handle) throw new Error('Expected handle');
      expect(getComputedStyle(handle).display).toBe('none');
    } finally {
      host.remove();
      style.remove();
    }
  });

  it('announces upload completion and opens a passive description without moving focus or selection', async () => {
    const editor = make();
    editor.commands.setContent('Keep typing', { emitUpdate: false });
    editor.commands.setTextSelection(5);
    editor.view.focus();
    const active = document.activeElement;
    let resolve!: (url: string) => void;
    const pending = uploadEditorImage(
      editor,
      new File(['image'], 'focus.png', { type: 'image/png' }),
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    resolve('/done.png');
    await pending;
    expect(document.activeElement).toBe(active);
    expect(editor.state.selection.toJSON().type).toBe('text');
    expect(editor.view.dom.querySelector('.editor-image')?.textContent).toContain("Describe what this image shows for people who can't see it");
    await vi.waitFor(() => expect(document.querySelector('[data-reader-announcer]')?.textContent).toContain('Describe what this image shows'));
  });

  it('opens the slash file picker and forwards cancellation and completion state', async () => {
    let signal: AbortSignal | undefined;
    let finishing: (() => void) | undefined;
    let resolve!: (url: string) => void;
    const upload = vi.fn<ImageUploader>().mockImplementation((_file, _progress, nextSignal, onFinishing) => {
      signal = nextSignal;
      finishing = onFinishing;
      return new Promise((done) => {
        resolve = done;
      });
    });
    const editor = make(undefined, upload);
    const slash = editor.extensionManager.extensions.find((extension) => extension.name === 'slashCommand');
    const image = createSlashItems(slash?.options.onUpload).find((item) => item.titleKey === 'editor.slash.image.title');
    if (!image) throw new Error('Expected image slash item');
    const prompt = vi.spyOn(window, 'prompt');
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    image.command({ editor, range: { from: 1, to: 1 }, locale: 'en' });
    expect(click).toHaveBeenCalledOnce();
    expect(prompt).not.toHaveBeenCalled();
    const picker = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!picker) throw new Error('Expected file picker');
    Object.defineProperty(picker, 'files', { value: [new File(['image'], 'slash.png', { type: 'image/png' })] });
    picker.dispatchEvent(new Event('change'));
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(finishing).toBeTypeOf('function');
    finishing?.();
    await vi.waitFor(() => expect(editor.view.dom.textContent).toContain('Finishing'));
    Array.from(editor.view.dom.querySelectorAll('button'))
      .find((button) => button.textContent === 'Remove')
      ?.click();
    expect(signal?.aborted).toBe(true);
    resolve('/unused.png');
  });

  it.each(['none', 'same-coordinate', 'out-and-back'])('keeps authored dimensions when a resize has no final change: %s', (gesture) => {
    const editor = make();
    const source = '<img src="/x.png" width="480" height="240" />';
    editor.commands.setContent(source, { emitUpdate: false });
    editor.commands.setNodeSelection(0);
    const image = editor.view.dom.querySelector('img');
    const handle = editor.view.dom.querySelector('.editor-image-handle-right');
    if (!image || !handle) throw new Error('Expected image handles');
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 100));
    handle.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true, cancelable: true }), { clientX: 200 }));
    if (gesture === 'out-and-back') document.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 250 }));
    if (gesture !== 'none') document.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 200 }));
    document.dispatchEvent(new Event('pointerup'));
    expect(getMarkdown(editor)).toBe(source);
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({ width: 480, height: 240 });
    expect((editor.view.dom.querySelector('.editor-image') as HTMLElement).style.width).toBe('480px');
  });
});
