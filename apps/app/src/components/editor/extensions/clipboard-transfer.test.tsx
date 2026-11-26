// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { AllSelection, NodeSelection } from '@tiptap/pm/state';
import { EditorContent } from '@tiptap/react';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownRenderer } from '../../markdown';
import RichMarkdown from '../../markdown-rich';
import { buildEditorExtensions, getMarkdown } from '../tiptap-editor';
import type { ImageUploader } from './image-upload';

const data = (type: string) => `data:image/${type};base64,YQ==`;
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP2kAAAAASUVORK5CYII=';
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
function textPaste(editor: Editor, text: string) {
  editor.view.pasteText(
    text,
    Object.assign(new Event('paste'), {
      clipboardData: { getData: (type: string) => (type === 'text/plain' ? text : '') },
    }) as unknown as ClipboardEvent,
  );
}
function nativePaste(editor: Editor, text: string, html = '') {
  editor.view.dom.dispatchEvent(
    Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
      clipboardData: { files: [], getData: (type: string) => (type === 'text/plain' ? text : type === 'text/html' ? html : '') },
    }),
  );
}
beforeEach(() => {
  vi.stubGlobal('ClipboardEvent', class extends Event {});
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
  vi.unstubAllGlobals();
});

describe('Internal clipboard transfer', () => {
  it('keeps Card groups, callouts, Frames, Tabs, Steps and code options through real internal clipboard serialization', () => {
    const source =
      '<CardGroup cols="2">\n\n<Card title="Help" icon="book" href="/help">\n\nBody\n\n</Card>\n\n</CardGroup>\n\n<Warning>\n\nKeep this\n\n</Warning>\n\n<Frame caption="Caption">\n\n![Image](/a.png)\n\n</Frame>\n\n<Tabs>\n\n<Tab title="One">\n\nText\n\n</Tab>\n\n</Tabs>\n\n<Steps>\n\n<Step title="First">\n\nDo this\n\n</Step>\n\n</Steps>\n\n```js title="Example" {1}\nconst x = 1;\n```';
    const from = make();
    from.commands.setContent(source, { emitUpdate: false });
    const expected = getMarkdown(from);
    from.view.dispatch(from.state.tr.setSelection(new AllSelection(from.state.doc)));
    const clipboard = from.view.serializeForClipboard(from.state.selection.content());
    expect(clipboard.dom.innerHTML).toContain('data-pm-slice');
    const to = make();
    to.view.dom.dispatchEvent(
      Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
        clipboardData: {
          files: [],
          getData: (type: string) => (type === 'text/html' ? clipboard.dom.innerHTML : type === 'text/plain' ? clipboard.text : ''),
        },
      }),
    );
    expect(getMarkdown(to)).toBe(expected);
  });

  it('does not trust a forged data-pm-slice marker', () => {
    const editor = make();
    editor.view.pasteHTML('<div data-pm-slice="0 0 []" data-mdx="Card"><img src="x" onerror="alert(1)"><iframe srcdoc="evil"></iframe></div>');
    expect(getMarkdown(editor)).not.toMatch(/Card|onerror|iframe|srcdoc/);
  });

  it('uploads legacy raster nodes from an internal copy, with retry and no inline data saved', async () => {
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

  it.each(['onclick', 'ONLOAD', 'style', 'srcdoc', 'formaction', 'srcset', 'dangerouslySetInnerHTML', 'xlink:href', 'xmlns'])(
    'canonicalizes internal component metadata containing %s',
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

  it('keeps safe extra source metadata on an internal component copy', () => {
    const from = make();
    const source = '<Card title="Help" data-track="support">\n\nKeep content\n\n</Card>';
    from.commands.setContent(source, { emitUpdate: false });
    const clipboard = copy(from);
    const to = make();
    paste(to, clipboard.dom.innerHTML, clipboard.text);
    expect(getMarkdown(to)).toBe(source);
  });

  it('cleans forged content carrying a valid copy nonce but different plain text', () => {
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

  it('inserts the stored Slice when a valid nonce and text accompany altered HTML', () => {
    const from = make();
    from.commands.setContent('<Card title="Original">\n\nOriginal\n\n</Card>', { emitUpdate: false });
    const clipboard = copy(from);
    const to = make();
    paste(to, clipboard.dom.innerHTML.replaceAll('Original', 'Changed'), clipboard.text);
    expect(getMarkdown(to)).toBe('<Card title="Original">\n\nOriginal\n\n</Card>');
  });

  it('uses a new nonce for each copy and rejects a stale copy', () => {
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

  it.each([
    ['opaque', '<CustomWidget style="color:red" onerror="kept">\n\nKeep me\n\n</CustomWidget>'],
    ['Card', '<Card title="Help" data-track="support">\n\nKeep me\n\n</Card>'],
    ['legacy', `![Legacy](${data('png')})`],
  ])('moves %s with a real internal drop without cleaning or uploading', (name, source) => {
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

  it.each(['\r\n', '\r'])('accepts a normalized internal-copy text match with %j line endings', (newline) => {
    const source = '<Card data-track="keep" title="Help">\n\nKeep body\n\n</Card>';
    const from = make();
    from.commands.setContent(source, { emitUpdate: false });
    from.view.dispatch(from.state.tr.setSelection(new AllSelection(from.state.doc)));
    const clip = from.view.serializeForClipboard(from.state.selection.content());
    const to = make();
    nativePaste(to, clip.text.replace(/\n/g, newline), clip.dom.innerHTML);
    expect(getMarkdown(to)).toBe(source);
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

describe('Legacy and pasted images', () => {
  it.each([
    ['https://x.com/a.png?v=1', true],
    ['https://x.com/page?file=a.png', false],
  ] as const)('detects image pathname for %s', (url, image) => {
    const editor = make();
    textPaste(editor, url);
    expect(editor.state.doc.firstChild?.type.name === 'image').toBe(image);
  });

  it.each(['alt', 'title', 'src'])('encodes HTML image line breaks in %s and survives reload', (key) => {
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

  it('collapses Markdown image alt and title line breaks and survives reload', () => {
    const editor = make();
    editor.commands.setImage({ src: '/safe.png', alt: 'line1\n\ntwo\rthree', title: 'title1\r\ntitle2' });
    expect(reload(editor)).toBe('![line1 two three](/safe.png "title1 title2")');
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({ alt: 'line1 two three', title: 'title1 title2' });
  });

  it('uploads HTML-drop data images through cards instead of saving placeholders', async () => {
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

  it.each(['Keep this description', '<iframe srcdoc="evil"></iframe>'])('saves an orphaned upload placeholder as safe alt text: %s', (alt) => {
    const editor = make();
    editor.commands.setImage({ src: '/__nibleaf-paste-upload-orphan', alt });
    const saved = reload(editor);
    expect(saved).not.toMatch(/__nibleaf-paste-upload-|<iframe/);
    expect(editor.state.doc.textContent).toBe(alt);
    expect(editor.getHTML()).not.toContain('<img');
  });

  it.each(['jpg', 'bmp', 'x-icon', 'vnd.microsoft.icon', 'svg+xml', 'avif', 'png'])(
    'preserves existing HTML data:image/%s verbatim and displays it',
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

  it.each(['gif', 'png', 'jpeg', 'webp'])('keeps existing Markdown data:image/%s in Markdown form', (type) => {
    const source = `![Old](${data(type)})`;
    const editor = make();
    editor.commands.setContent(source, { emitUpdate: false });
    expect(reload(editor)).toBe(source);
    expect(getMarkdown(editor)).toBe(source);
  });

  it.each(['jpg', 'bmp', 'x-icon', 'vnd.microsoft.icon', 'svg+xml', 'avif'])(
    'keeps main-compatible unsupported Markdown data:image/%s literal',
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

  it.each(['x-icon', 'vnd.microsoft.icon'])('uploads new data:image/%s through the asset MIME allow-list', async (type) => {
    const upload = vi.fn<ImageUploader>().mockResolvedValue('/icon.ico');
    const editor = make(upload);
    editor.view.pasteHTML(`<img src="${data(type)}" alt="Icon">`, new Event('paste') as ClipboardEvent);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
    expect(upload.mock.calls[0]?.[0].type).toBe(`image/${type}`);
    await vi.waitFor(() => expect(getMarkdown(editor)).toBe('![Icon](/icon.ico)'));
  });

  it.each(['class', 'className'])('drops external pasted image %s completely', (name) => {
    const editor = make();
    editor.view.pasteHTML(`<img src="/x.png" alt="Visible" ${name}="hidden dark:block">`, new Event('paste') as ClipboardEvent);
    expect(editor.state.doc.firstChild?.attrs[name]).toBeNull();
    expect(reload(editor)).toBe('![Visible](/x.png)');
  });

  it('reduces a newly pasted Markdown SVG data image to its alt text', () => {
    const editor = make();
    nativePaste(editor, `Before\n\n![SVG alt](${data('svg+xml')})\n\nAfter`);
    expect(getMarkdown(editor)).toBe('Before\n\nSVG alt\n\nAfter');
    expect(reload(editor)).not.toContain('base64');
  });
});

describe('Pasted table alignment', () => {
  it.each([
    ['rtl', 'end', ':---'],
    ['rtl', 'start', '---:'],
    ['ltr', 'start', ':---'],
    ['ltr', 'end', '---:'],
  ])('resolves %s source logical %s alignment before stripping direction', (dir, align, delimiter) => {
    const editor = make(undefined, dir === 'rtl' ? 'ltr' : 'rtl');
    editor.view.pasteHTML(
      `<table dir="${dir}"><tr><th style="text-align:${align}">A</th></tr><tr><td style="text-align:${align}">B</td></tr></table>`,
      new Event('paste') as ClipboardEvent,
    );
    const saved = reload(editor);
    expect(saved).toContain(`| ${delimiter} |`);
    expect(getMarkdown(editor)).toBe(saved);
  });
});

describe('Pasted text and links', () => {
  it('keeps pasted underline as u markup, which the rich reader renders', () => {
    const editor = make();
    editor.view.pasteHTML('<p><span style="text-decoration:underline">Keep underline</span></p>');
    const saved = getMarkdown(editor);
    expect(saved).toBe('<u>Keep underline</u>');
    expect(renderToStaticMarkup(createElement(RichMarkdown, { content: saved }))).toContain('Keep underline');
    expect(renderToStaticMarkup(createElement(RichMarkdown, { content: saved }))).toContain('<u>');
    // The basic renderer intentionally does not parse raw HTML; routing uses RichMarkdown.
    expect(renderToStaticMarkup(createElement(MarkdownRenderer, { content: saved }))).toContain('Keep underline');
  });

  it.each(['/api/v1/users', 'https://example.com/old', 'www.example.com', 'example.com/path'])(
    'replaces URL-like selected text instead of linking it: %s',
    (selected) => {
      const editor = make();
      editor.commands.setContent(selected, { emitUpdate: false });
      editor.commands.setTextSelection({ from: 1, to: selected.length + 1 });
      textPaste(editor, 'https://example.com/new');
      expect(editor.state.doc.textContent).toBe('https://example.com/new');
    },
  );

  it('replaces a selected relative path with the pasted path', () => {
    const editor = make();
    editor.commands.setContent('/api/v1/users', { emitUpdate: false });
    editor.commands.setTextSelection({ from: 1, to: 14 });
    textPaste(editor, '/api/v2/users');
    expect(getMarkdown(editor)).toBe('/api/v2/users');
  });

  it('keeps legacy-copy alt text when the destination has no uploader', () => {
    const from = make();
    from.commands.setContent(`![Legacy](${png})`, { emitUpdate: false });
    const clipboard = copy(from);
    const to = make();
    paste(to, clipboard.dom.innerHTML, clipboard.text);
    expect(getMarkdown(to)).toBe('Legacy');
  });

  it('uploads a nested legacy image while preserving its Frame, dimensions and display class', async () => {
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

  it.each(['class', 'className'])('keeps an entirely allow-listed source %s attribute', (name) => {
    const source = `<img src="/x.png" ${name}="hidden dark:block" />`;
    const editor = make();
    editor.commands.setContent(source, { emitUpdate: false });
    expect(reload(editor)).toBe(source);
    expect(getMarkdown(editor)).toBe(source);
  });

  it('uses the nearest source dir and otherwise the RTL editor direction', () => {
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
});
