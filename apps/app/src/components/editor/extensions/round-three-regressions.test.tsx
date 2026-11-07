// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { Editor } from '@tiptap/core';
import { AllSelection } from '@tiptap/pm/state';
import { EditorContent } from '@tiptap/react';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildEditorExtensions, getMarkdown } from '../tiptap-editor';
import { type ImageUploader, uploadEditorImage } from './image-upload';
import { createSlashItems } from './slash-command';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP2kAAAAASUVORK5CYII=';
const editors: Editor[] = [];
const mounts: { root: Root; host: HTMLElement }[] = [];
function make(onUpload?: ImageUploader) {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions({ onUpload }) });
  editors.push(editor);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(createElement(EditorContent, { editor })));
  mounts.push({ root, host });
  return editor;
}
function copy(editor: Editor) {
  editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)));
  return editor.view.serializeForClipboard(editor.state.selection.content());
}
function paste(editor: Editor, html: string, text: string) {
  editor.view.dom.dispatchEvent(
    Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
      clipboardData: {
        files: [],
        types: ['text/html', 'text/plain'],
        getData: (type: string) => (type === 'text/html' ? html : type === 'text/plain' ? text : ''),
      },
    }),
  );
}
function reload(editor: Editor) {
  const saved = getMarkdown(editor);
  editor.commands.setContent(saved, { emitUpdate: false });
  return saved;
}
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
  vi.restoreAllMocks();
});

describe('round three content regressions', () => {
  it.each(['alt', 'title', 'src'])('encodes HTML image line breaks in %s and survives reload (1)', (key) => {
    const editor = make();
    const value = key === 'src' ? '/line1&#10;&#10;two&#13;three.png' : 'line1&#10;&#10;two&#13;three';
    const attributes = { src: '/safe.png', alt: 'Safe', width: '480', [key]: value };
    editor.view.pasteHTML(
      `<img ${Object.entries(attributes)
        .map(([name, value]) => `${name}="${value}"`)
        .join(' ')}>`,
      new Event('paste') as ClipboardEvent,
    );
    const before = editor.state.doc.firstChild?.attrs[key];
    const saved = reload(editor);
    expect(saved).toContain('&#10;&#10;');
    expect(saved).toContain('&#13;');
    expect(editor.state.doc.firstChild?.type.name).toBe('image');
    expect(editor.state.doc.firstChild?.attrs[key]).toBe(before);
    expect(getMarkdown(editor)).toBe(saved);
  });
  it('collapses Markdown image alt and title line breaks and survives reload (1)', () => {
    const editor = make();
    editor.commands.setImage({ src: '/safe.png', alt: 'line1\n\ntwo\rthree', title: 'title1\r\ntitle2' });
    expect(reload(editor)).toBe('![line1 two three](/safe.png "title1 title2")');
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({ alt: 'line1 two three', title: 'title1 title2' });
  });
  it('uploads HTML-drop data images through cards instead of saving placeholders (2)', async () => {
    let resolve!: (url: string) => void;
    const upload = vi.fn<ImageUploader>().mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const editor = make(upload);
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 1, inside: -1 });
    editor.view.dom.dispatchEvent(
      Object.assign(new Event('drop', { bubbles: true, cancelable: true }), {
        clientX: 0,
        clientY: 0,
        dataTransfer: {
          files: [],
          getData: (type: string) => (type === 'text/html' ? `<p>Before</p><img src="${png}" alt="Dropped"><p>After</p>` : ''),
        },
      }),
    );
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
    expect(getMarkdown(editor)).not.toContain('/__nibleaf-paste-upload-');
    await vi.waitFor(() => expect(editor.view.dom.textContent).toContain('pasted-image.png'));
    resolve('/hosted.png');
    await vi.waitFor(() => expect(getMarkdown(editor)).toContain('![Dropped](/hosted.png)'));
    expect(reload(editor)).toBe(getMarkdown(editor));
  });
  it.each(['Keep this description', '<iframe srcdoc="evil"></iframe>'])('saves an orphaned upload placeholder as safe alt text: %s (2)', (alt) => {
    const editor = make();
    editor.commands.setImage({ src: '/__nibleaf-paste-upload-orphan', alt });
    const saved = reload(editor);
    expect(saved).not.toMatch(/__nibleaf-paste-upload-|<iframe/);
    expect(editor.state.doc.textContent).toBe(alt);
    expect(editor.getHTML()).not.toContain('<img');
  });
  it('uploads legacy raster nodes from an internal copy, with retry and no inline data saved (3a)', async () => {
    const from = make();
    from.commands.setContent(`![Legacy](${png})`, { emitUpdate: false });
    const clipboard = copy(from);
    const upload = vi.fn<ImageUploader>().mockResolvedValueOnce(null).mockResolvedValueOnce('/retry.png');
    const to = make(upload);
    paste(to, clipboard.dom.innerHTML, clipboard.text);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
    expect(getMarkdown(to)).not.toMatch(/data:image|__nibleaf-paste-upload-/);
    await vi.waitFor(() => expect(Array.from(to.view.dom.querySelectorAll('button')).find((button) => button.textContent === 'Retry')).toBeDefined());
    Array.from(to.view.dom.querySelectorAll('button'))
      .find((button) => button.textContent === 'Retry')
      ?.click();
    await vi.waitFor(() => expect(getMarkdown(to)).toBe('![Legacy](/retry.png)'));
  });
  it('keeps legacy-copy alt text when the destination has no uploader (3a)', () => {
    const from = make();
    from.commands.setContent(`![Legacy](${png})`, { emitUpdate: false });
    const clipboard = copy(from);
    const to = make();
    paste(to, clipboard.dom.innerHTML, clipboard.text);
    expect(getMarkdown(to)).toBe('Legacy');
  });
  it('uploads a nested legacy image while preserving its Frame, dimensions and display class (3a)', async () => {
    const from = make();
    from.commands.setContent(
      `<Frame caption="Preserved"><img src="${png}" alt="Legacy" width="480" height="240" className="block dark:hidden" /></Frame>`,
      { emitUpdate: false },
    );
    const clipboard = copy(from);
    const upload = vi.fn<ImageUploader>().mockResolvedValue('/nested.png');
    const to = make(upload);
    paste(to, clipboard.dom.innerHTML, clipboard.text);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(getMarkdown(to)).toContain('src="/nested.png"'));
    const saved = reload(to);
    for (const expected of ['<Frame caption="Preserved">', 'width="480"', 'height="240"', 'className="block dark:hidden"'])
      expect(saved).toContain(expected);
    expect(saved).not.toMatch(/data:image|__nibleaf-paste-upload-/);
    expect(getMarkdown(to)).toBe(saved);
  });
  it.each(['onclick', 'ONLOAD', 'style', 'srcdoc', 'formaction', 'srcset', 'dangerouslySetInnerHTML', 'xlink:href', 'xmlns'])(
    'canonicalizes internal component metadata containing %s (3b)',
    (attribute) => {
      const from = make();
      from.commands.setContent(`<Card title="Help" ${attribute}="evil">\n\nKeep content\n\n</Card>`, { emitUpdate: false });
      const clipboard = copy(from);
      const to = make();
      paste(to, clipboard.dom.innerHTML, clipboard.text);
      expect(getMarkdown(to)).toBe('<Card title="Help">\n\nKeep content\n\n</Card>');
      expect(to.state.doc.firstChild?.attrs).toMatchObject({ sourceOpen: '', sourceClose: '', sourceOriginal: '' });
    },
  );
  it('keeps safe extra source metadata on an internal component copy (3b)', () => {
    const from = make();
    const source = '<Card title="Help" data-track="support">\n\nKeep content\n\n</Card>';
    from.commands.setContent(source, { emitUpdate: false });
    const clipboard = copy(from);
    const to = make();
    paste(to, clipboard.dom.innerHTML, clipboard.text);
    expect(getMarkdown(to)).toBe(source);
  });
  it('cleans forged content carrying a valid copy nonce but different plain text (4)', () => {
    const from = make();
    from.commands.setContent('<Card title="Original">\n\nOriginal\n\n</Card>', { emitUpdate: false });
    const clipboard = copy(from);
    const forged = document.createElement('div');
    forged.innerHTML = clipboard.dom.innerHTML;
    const body = forged.querySelector('[data-mdx="Card"]');
    if (!body) throw new Error('Expected copied Card');
    body.innerHTML = '<p style="position:fixed" onclick="evil()">Forged</p>';
    const to = make();
    paste(to, forged.innerHTML, 'Forged');
    expect(to.state.doc.textContent).toBe('Forged');
    expect(getMarkdown(to)).not.toMatch(/Card|onclick|position:fixed|Original/);
  });
  it('inserts the stored Slice when a valid nonce and text accompany altered HTML (4)', () => {
    const from = make();
    from.commands.setContent('<Card title="Original">\n\nOriginal\n\n</Card>', { emitUpdate: false });
    const clipboard = copy(from);
    const to = make();
    paste(to, clipboard.dom.innerHTML.replaceAll('Original', 'Changed'), clipboard.text);
    expect(getMarkdown(to)).toBe('<Card title="Original">\n\nOriginal\n\n</Card>');
  });
  it('uses a new nonce for each copy and rejects a stale copy (4)', () => {
    const editor = make();
    editor.commands.setContent('<Card title="Old">\n\nOld\n\n</Card>', { emitUpdate: false });
    const first = copy(editor);
    editor.commands.setContent('<Card title="New">\n\nNew\n\n</Card>', { emitUpdate: false });
    const second = copy(editor);
    const nonce = (html: string) => {
      const root = document.createElement('div');
      root.innerHTML = html;
      return root.querySelector('[data-nibleaf-clipboard]')?.getAttribute('data-nibleaf-clipboard');
    };
    expect(nonce(first.dom.innerHTML)).not.toBe(nonce(second.dom.innerHTML));
    const to = make();
    paste(to, first.dom.innerHTML, first.text);
    expect(getMarkdown(to)).not.toContain('<Card');
    expect(to.state.doc.textContent).toContain('Old');
  });
  it('forwards all ImageUploader arguments through the actual slash file picker (5)', async () => {
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
    const editor = make(upload);
    const slash = editor.extensionManager.extensions.find((extension) => extension.name === 'slashCommand');
    const image = createSlashItems(slash?.options.onUpload).find((item) => item.titleKey === 'editor.slash.image.title');
    if (!image) throw new Error('Expected image slash item');
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    image.command({ editor, range: { from: 1, to: 1 }, locale: 'en' });
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
  it('keeps Word numbering gaps across save and reload (6)', () => {
    const item = (n: number) => `<p style="mso-list:l0 level1 lfo1"><![if !supportLists]><span>${n}.&nbsp;</span><![endif]>Item ${n}</p>`;
    const editor = make();
    editor.view.pasteHTML(item(4) + item(6), new Event('paste') as ClipboardEvent);
    reload(editor);
    expect(editor.state.doc.content.content.filter((node) => node.type.name === 'orderedList').map((node) => node.attrs.start)).toEqual([4, 6]);
    expect(getMarkdown(editor)).toContain('6) Item 6');
  });
  it('hides selected resize handles in review mode using the real CSS cascade (7)', () => {
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
  it('announces upload completion and opens a passive description without moving focus or selection (focus)', async () => {
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
});
