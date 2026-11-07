// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { Editor } from '@tiptap/core';
import { AllSelection, NodeSelection } from '@tiptap/pm/state';
import { EditorContent } from '@tiptap/react';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildEditorExtensions, getMarkdown } from '../tiptap-editor';
import type { ImageUploader } from './image-upload';

const data = (type: string) => `data:image/${type};base64,YQ==`;
const editors: Editor[] = [];
const mounts: { root: Root; host: HTMLElement }[] = [];
function make(onUpload?: ImageUploader, dir: 'ltr' | 'rtl' = 'ltr') {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions({ onUpload, dir }) });
  editors.push(editor);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(createElement(EditorContent, { editor })));
  mounts.push({ root, host });
  return editor;
}
function reload(editor: Editor) {
  const saved = getMarkdown(editor);
  editor.commands.setContent(saved, { emitUpdate: false });
  return saved;
}
function nativePaste(editor: Editor, text: string, html = '') {
  editor.view.dom.dispatchEvent(
    Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
      clipboardData: { files: [], getData: (type: string) => (type === 'text/plain' ? text : type === 'text/html' ? html : '') },
    }),
  );
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

describe('round four content integrity', () => {
  it.each([
    ['opaque', '<CustomWidget style="color:red" onerror="kept">\n\nKeep me\n\n</CustomWidget>'],
    ['Card', '<Card title="Help" data-track="support">\n\nKeep me\n\n</Card>'],
    ['legacy', `![Legacy](${data('png')})`],
  ])('moves %s with a real internal drop without cleaning or uploading (1)', (name, source) => {
    const upload = vi.fn<ImageUploader>().mockResolvedValue('/unexpected.png');
    const editor = make(upload);
    editor.commands.setContent(`${source}\n\nAnchor`, { emitUpdate: false });
    const original = editor.state.doc.firstChild;
    if (!original) throw new Error('Expected a source block');
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
    const slice = editor.state.selection.content();
    editor.view.dragging = { slice, move: true };
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: editor.state.doc.content.size, inside: -1 });
    editor.view.dom.dispatchEvent(
      Object.assign(new Event('drop', { bubbles: true, cancelable: true }), {
        clientX: 0,
        clientY: 0,
        dataTransfer: { getData: () => '', files: [] },
      }),
    );
    expect(upload).not.toHaveBeenCalled();
    expect(editor.state.doc.firstChild?.textContent).toBe('Anchor');
    expect(editor.state.doc.content.content.find((node) => node.type.name === original.type.name)?.toJSON()).toEqual(original.toJSON());
    if (name === 'opaque') expect(getMarkdown(editor)).toContain(source);
  });
  it.each(['jpg', 'bmp', 'x-icon', 'vnd.microsoft.icon', 'svg+xml', 'avif', 'png'])(
    'preserves existing HTML data:image/%s verbatim and displays it (2)',
    (type) => {
      const source = `<img alt='Old' src="${data(type)}" width='0480' />`;
      const editor = make();
      editor.commands.setContent(source, { emitUpdate: false });
      expect(editor.state.doc.firstChild?.type.name).toBe('legacyImage');
      expect(editor.view.dom.querySelector('img')?.getAttribute('src')).toBe(data(type));
      expect(reload(editor)).toBe(source);
      expect(getMarkdown(editor)).toBe(source);
    },
  );
  it.each(['gif', 'png', 'jpeg', 'webp'])('keeps existing Markdown data:image/%s in Markdown form (2, 8)', (type) => {
    const source = `![Old](${data(type)})`;
    const editor = make();
    editor.commands.setContent(source, { emitUpdate: false });
    expect(reload(editor)).toBe(source);
    expect(getMarkdown(editor)).toBe(source);
  });
  it.each(['jpg', 'bmp', 'x-icon', 'vnd.microsoft.icon', 'svg+xml', 'avif'])(
    'keeps main-compatible unsupported Markdown data:image/%s literal (2)',
    (type) => {
      const source = `![Old](${data(type)})`;
      const editor = make();
      editor.commands.setContent(source, { emitUpdate: false });
      expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
      expect(editor.state.doc.textContent).toBe(source);
      reload(editor);
      expect(editor.state.doc.textContent).toBe(source);
    },
  );
  it.each(['x-icon', 'vnd.microsoft.icon'])('uploads new data:image/%s through the asset MIME allow-list (2)', async (type) => {
    const upload = vi.fn<ImageUploader>().mockResolvedValue('/icon.ico');
    const editor = make(upload);
    editor.view.pasteHTML(`<img src="${data(type)}" alt="Icon">`, new Event('paste') as ClipboardEvent);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
    expect(upload.mock.calls[0]?.[0].type).toBe(`image/${type}`);
    await vi.waitFor(() => expect(getMarkdown(editor)).toBe('![Icon](/icon.ico)'));
  });
  it.each(['class', 'className'])('drops external pasted image %s completely (3)', (name) => {
    const editor = make();
    editor.view.pasteHTML(`<img src="/x.png" alt="Visible" ${name}="hidden dark:block">`, new Event('paste') as ClipboardEvent);
    expect(editor.state.doc.firstChild?.attrs[name]).toBeNull();
    expect(reload(editor)).toBe('![Visible](/x.png)');
  });
  it.each(['class', 'className'])('drops the entire mixed %s attribute on source re-save (3)', (name) => {
    const editor = make();
    editor.commands.setContent(`<img src="/x.png" alt="Visible" ${name}="hidden md:block">`, { emitUpdate: false });
    expect(editor.state.doc.firstChild?.attrs[name]).toBeNull();
    expect(reload(editor)).not.toContain(`${name}=`);
    expect(editor.state.doc.firstChild?.type.name).toBe('image');
  });
  it.each(['class', 'className'])('keeps an entirely allow-listed source %s attribute (3)', (name) => {
    const source = `<img src="/x.png" ${name}="hidden dark:block" />`;
    const editor = make();
    editor.commands.setContent(source, { emitUpdate: false });
    expect(reload(editor)).toBe(source);
    expect(getMarkdown(editor)).toBe(source);
  });
  it.each(['none', 'same-coordinate', 'out-and-back'])('keeps authored dimensions when a resize has no final change: %s (5)', (gesture) => {
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
  it.each([
    ['rtl', 'end', ':---'],
    ['rtl', 'start', '---:'],
    ['ltr', 'start', ':---'],
    ['ltr', 'end', '---:'],
  ])('resolves %s source logical %s alignment before stripping direction (6)', (dir, align, delimiter) => {
    const editor = make(undefined, dir === 'rtl' ? 'ltr' : 'rtl');
    editor.view.pasteHTML(
      `<table dir="${dir}"><tr><th style="text-align:${align}">A</th></tr><tr><td style="text-align:${align}">B</td></tr></table>`,
      new Event('paste') as ClipboardEvent,
    );
    const saved = reload(editor);
    expect(saved).toContain(`| ${delimiter} |`);
    expect(getMarkdown(editor)).toBe(saved);
  });
  it('uses the nearest source dir and otherwise the RTL editor direction (6)', () => {
    const editor = make(undefined, 'rtl');
    editor.view.pasteHTML(
      '<table dir="ltr"><tr dir="rtl"><th style="text-align:start">A</th></tr><tr><td>B</td></tr></table>',
      new Event('paste') as ClipboardEvent,
    );
    expect(getMarkdown(editor)).toContain('| ---: |');
    editor.commands.clearContent();
    editor.view.pasteHTML('<table><tr><th style="text-align:end">A</th></tr><tr><td>B</td></tr></table>', new Event('paste') as ClipboardEvent);
    expect(getMarkdown(editor)).toContain('| :--- |');
  });
  it.each(['\r\n', '\r'])('accepts a normalized internal-copy text match with %j line endings (7)', (newline) => {
    const source = '<Card data-track="keep" title="Help">\n\nKeep body\n\n</Card>';
    const from = make();
    from.commands.setContent(source, { emitUpdate: false });
    from.view.dispatch(from.state.tr.setSelection(new AllSelection(from.state.doc)));
    const clip = from.view.serializeForClipboard(from.state.selection.content());
    const to = make();
    nativePaste(to, clip.text.replace(/\n/g, newline), clip.dom.innerHTML);
    expect(getMarkdown(to)).toBe(source);
  });
  it('removes the unused upload-failed key from the map and every catalog (10)', () => {
    expect(readFileSync('../../packages/i18n/src/message-ids.ts', 'utf8')).not.toContain("'editor.imageUploadFailed'");
    for (const locale of ['en', 'ar', 'bn', 'de', 'es', 'fr', 'hi', 'id', 'pt-BR', 'ru', 'ur', 'zh-CN'])
      expect(JSON.parse(readFileSync(`../../packages/i18n/messages/${locale}.json`, 'utf8'))).not.toHaveProperty('editor_imageuploadfailed');
  });
  it('reduces a newly pasted Markdown SVG data image to its alt text (11)', () => {
    const editor = make();
    nativePaste(editor, `Before\n\n![SVG alt](${data('svg+xml')})\n\nAfter`);
    expect(getMarkdown(editor)).toBe('Before\n\nSVG alt\n\nAfter');
    expect(reload(editor)).not.toContain('base64');
  });
  it('keeps an internally copied opaque component source verbatim by design', () => {
    const source = '<CustomWidget style="color:red" onerror="kept">\n\nBody\n\n</CustomWidget>';
    const from = make();
    from.commands.setContent(source, { emitUpdate: false });
    from.view.dispatch(from.state.tr.setSelection(new AllSelection(from.state.doc)));
    const clip = from.view.serializeForClipboard(from.state.selection.content());
    const to = make();
    nativePaste(to, clip.text, clip.dom.innerHTML);
    expect(getMarkdown(to)).toBe(source);
  });
});
