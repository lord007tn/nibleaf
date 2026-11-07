// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownRenderer } from '../../markdown';
import RichMarkdown from '../../markdown-rich';
import { buildEditorExtensions, getMarkdown } from '../tiptap-editor';
import { cleanPasteDOM, safePasteHref } from './clean-paste';
import { imageClasses, imageDimension } from './html-safety';
import type { ImageUploader } from './image-upload';
import { fileFromPastedImage } from './pasted-image';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
const editors: Editor[] = [];
const roots: { root: Root; container: HTMLElement }[] = [];
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP2kAAAAASUVORK5CYII=';
const dataImage = `data:image/png;base64,${png}`;

function editorFor(upload?: ImageUploader) {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions({ onUpload: upload }) });
  editors.push(editor);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  flushSync(() => root.render(createElement(EditorContent, { editor })));
  roots.push({ root, container });
  return editor;
}
function paste(html: string, upload?: ImageUploader) {
  const editor = editorFor(upload);
  editor.view.pasteHTML(html, new Event('paste') as ClipboardEvent);
  return editor;
}
function pasteMarkdown(editor: Editor, text: string) {
  const event = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
    clipboardData: { files: [], types: ['text/plain'], getData: (type: string) => (type === 'text/plain' ? text : '') },
  });
  editor.view.dom.dispatchEvent(event);
}
function inert(html: string) {
  const root = document.implementation.createHTMLDocument('').createElement('div');
  root.innerHTML = html;
  return root;
}
function expectSafeDOM(root: Element) {
  expect(root.querySelector('script,iframe,object,embed')).toBeNull();
  for (const element of root.querySelectorAll('*'))
    for (const attribute of Array.from(element.attributes)) {
      expect(attribute.name).not.toMatch(/^on|^(style|srcdoc|formaction)$/i);
      if (['href', 'src'].includes(attribute.name)) expect(safePasteHref(attribute.value)).toBe(true);
    }
}
afterEach(() => {
  for (const { root, container } of roots.splice(0)) {
    root.unmount();
    container.remove();
  }
  for (const editor of editors.splice(0)) editor.destroy();
  vi.restoreAllMocks();
});

const rejected = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  ' data:text/html,evil',
  'DATA:image/png;base64,YQ==',
  'vbscript:msgbox(1)',
  'VbScRiPt:msgbox(1)',
  '\t\r\njavascript:alert(1)',
  '\u0001\u007f\u0085javascript:alert(1)',
  '\ufeffjavascript:alert(1)',
  'java\tscript:alert(1)',
  'java\nscript:alert(1)',
  'java&#x09;script:alert(1)',
  'java&#9;script:alert(1)',
  '&#106;avascript&colon;alert(1)',
  'javascript&amp;colon;alert(1)',
  'vb&Tab;script&colon;evil',
  'd&#97;ta:text/html,evil',
  'ftp://example.com',
  'file:///secret',
  'blob:https://example.com/id',
  'custom:evil',
  'chrome-extension:evil',
];
const allowed = [
  'https://example.com',
  'http://example.com',
  'HTTPS://example.com',
  ' HTTP://example.com',
  '\u0001https://example.com',
  'https&#58;//example.com',
  'hTtP&#x73;://example.com',
  'mailto:help@example.com',
  'MAILTO:help@example.com',
  'tel:+123',
  '/help',
  './help',
  '../help',
  'help/page',
  '//example.com/help',
  '#section',
  '?q=help',
  'العربية/دليل',
];

describe('untrusted clipboard links', () => {
  it.each(rejected)('safePasteHref rejects %j', (href) => expect(safePasteHref(href)).toBe(false));
  it.each(allowed)('safePasteHref allows %j', (href) => expect(safePasteHref(href)).toBe(true));
  it.each(rejected)('keeps link text while removing rejected %j from document and Markdown', (href) => {
    const editor = paste(`<p><a href="${href}">Retained text</a></p>`);
    expect(editor.getJSON().content?.[0]?.content?.[0]?.marks ?? []).toEqual([]);
    expect(editor.getHTML()).toBe('<p>Retained text</p>');
    expect(getMarkdown(editor)).toBe('Retained text');
  });
  it.each(allowed.slice(0, 4).concat('mailto:help@example.com', 'tel:+123', '/help', '../help', '#section'))(
    'retains allowed %j in the editor and saved link',
    (href) => {
      const editor = paste(`<p><a href="${href}">Allowed</a></p>`);
      expect(editor.getJSON().content?.[0]?.content?.[0]?.marks?.[0]?.type).toBe('link');
      expect(getMarkdown(editor)).toContain('[Allowed](');
      expectSafeDOM(inert(editor.getHTML()));
    },
  );
});

const hostileFixtures = [
  [
    'web handlers',
    '<p style="position:fixed" onclick="alert(1)">Visible text</p><img src=x onerror=alert(1) style="position:fixed" srcdoc="evil" formaction="javascript:evil"><a href="javascript:alert(1)" onclick="evil()">Link text</a><svg onload="evil()"><text>SVG</text></svg><iframe srcdoc="<script>evil()</script>">frame</iframe><script>evil()</script>',
  ],
  [
    'Word attributes',
    `<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1;position:fixed" onmouseover="evil()"><![if !supportLists]><span>·&nbsp;</span><![endif]>Keep Word text</p><img src="/word.png" onerror="evil()" style="position:fixed" class="fixed inset-0 z-50 block dark:hidden" width='480" onload="evil'>`,
  ],
  [
    'Docs attributes',
    '<b id="docs-internal-guid-evil" style="font-weight:normal"><p style="position:fixed"><a href="java&#x09;script:evil" onclick="evil()"><span style="color:red;text-decoration:underline">Docs text</span></a><span style="font-weight:700" data-evil="x">Bold</span></p></b>',
  ],
  [
    'image schemes',
    '<img src=" JaVaScRiPt:alert(1)" alt="Java alt"><img src="vbscript:evil" alt="VB alt"><img src="java&#x09;script:evil" alt="Encoded alt">',
  ],
  [
    'utility classes and quotes',
    '<img src="/safe.png" class="fixed inset-0 z-50 block dark:hidden" alt="&quot; onerror=&quot;x" width="480" title="a &amp; &quot;b&quot; &lt;c&gt;">',
  ],
  ['inline image without uploader', `<img src="${dataImage}" onerror="evil()" alt="Inline fallback">`],
  ['non-image data', '<img src="data:text/html;base64,PHNjcmlwdD4=" alt="Rejected data">'],
] as const;

describe('clipboard attribute allow list and reader output', () => {
  it.each(hostileFixtures)('cleanPasteDOM strips untrusted attributes from %s', (_name, fixture) => {
    const root = cleanPasteDOM(inert(fixture));
    expectSafeDOM(root);
    for (const image of root.querySelectorAll('img')) {
      expect(imageClasses(image.getAttribute('class'))).toBe(image.getAttribute('class'));
      expect(imageDimension(image.getAttribute('width'))).not.toBeUndefined();
    }
  });
  it.each(hostileFixtures)('saves and renders %s safely through both reader paths', (_name, fixture) => {
    const editor = paste(fixture);
    const saved = getMarkdown(editor);
    expectSafeDOM(inert(editor.getHTML()));
    expect(saved).not.toContain('/__nibleaf-paste-upload-');
    expect(saved).not.toContain('base64,');
    for (const Renderer of [MarkdownRenderer, RichMarkdown]) {
      const root = inert(renderToStaticMarkup(createElement(Renderer, { content: saved })));
      expectSafeDOM(root);
      for (const image of root.querySelectorAll('img')) {
        const allowedClasses = new Set([
          'block',
          'hidden',
          'inline',
          'inline-block',
          'dark:block',
          'dark:hidden',
          'dark:inline',
          'dark:inline-block',
          'rounded-xl',
          'border',
          'border-border',
        ]);
        for (const token of image.classList) expect(allowedClasses.has(token)).toBe(true);
      }
    }
  });
  it('drops active images but preserves their alt text', () => {
    const editor = paste(hostileFixtures[3][1]);
    expect(editor.getHTML()).not.toContain('<img');
    expect(getMarkdown(editor)).toBe('Java altVB altEncoded alt');
  });
  it('clears forged raw-source metadata on a pasted Markdown image', () => {
    const editor = editorFor();
    pasteMarkdown(editor, '<img src="/safe.png" onerror="evil()" style="position:fixed" class="fixed block" width="480" />');
    expect(editor.getJSON().content?.[0]?.attrs?.sourceOpen).toBe('');
    const saved = getMarkdown(editor);
    expect(saved).not.toMatch(/onerror|style=|fixed/);
    expect(saved).not.toContain('class=');
  });
});

describe('inline data images', () => {
  it('uploads concurrent images at their original positions using cards, byte progress, and the normal asset path', async () => {
    const pending: { file: File; progress?: (percent: number) => void; resolve: (url: string) => void }[] = [];
    const uploader: ImageUploader = (file, progress) => new Promise((resolve) => pending.push({ file, progress, resolve }));
    const editor = paste(`<p>One</p><img src="${dataImage}" alt="A"><p>Between</p><img src="${dataImage}" alt="B"><p>After</p>`, uploader);
    expect(pending).toHaveLength(2);
    expect(pending[0]?.file.type).toBe('image/png');
    expect(pending[0]?.file.size).toBe(atob(png).length);
    expect(getMarkdown(editor)).not.toMatch(/base64,|__nibleaf-paste-upload/);
    await vi.waitFor(() => expect(editor.view.dom.querySelectorAll('[role="status"]')).toHaveLength(2));
    pending[0]?.progress?.(35);
    await vi.waitFor(() => expect(editor.view.dom.querySelector('progress')?.value).toBe(35));
    pending[1]?.resolve('/b.png');
    pending[0]?.resolve('/a.png');
    await vi.waitFor(() => expect(getMarkdown(editor)).toBe('One\n\n![A](/a.png)\n\nBetween\n\n![B](/b.png)\n\nAfter'));
    for (const Renderer of [MarkdownRenderer, RichMarkdown])
      expectSafeDOM(inert(renderToStaticMarkup(createElement(Renderer, { content: getMarkdown(editor) }))));
  });
  it('keeps alt text without an uploader', () => {
    const editor = paste(`<img src="${dataImage}" alt="Keep this description">`);
    expect(getMarkdown(editor)).toBe('Keep this description');
    expect(editor.getJSON().content?.some((node) => node.type === 'image' || node.type === 'mdxOpaqueBlock')).toBe(false);
  });
  it.each(['data:text/html;base64,PHNjcmlwdD4=', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,not-base64!'])(
    'rejects %s with the existing plain-language toast',
    (src) => {
      vi.mocked(toast.error).mockClear();
      const upload = vi.fn();
      const editor = paste(`<img src="${src}" alt="Rejected image">`, upload);
      expect(upload).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith('Choose a PNG, JPEG, GIF, WebP, AVIF or ICO image.');
      expect(getMarkdown(editor)).toBe('Rejected image');
    },
  );
  it('rejects oversized decoded bytes before decoding or allocating a File', () => {
    vi.mocked(toast.error).mockClear();
    const decode = vi.spyOn(globalThis, 'atob');
    expect(fileFromPastedImage(`data:image/png;base64,${'A'.repeat(Math.ceil((50 * 1024 * 1024 + 1) / 3) * 4)}`)).toBeNull();
    expect(decode).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('This image is too large. Choose an image under 50 MB.');
  });
  it.each([`<img src="${dataImage}" alt="Legacy" />`, `![Legacy](${dataImage})`])(
    'renders and preserves existing saved data images, while BlockImage rejects base64',
    (source) => {
      const editor = editorFor();
      expect(editor.extensionManager.extensions.find((extension) => extension.name === 'image')?.options.allowBase64).toBe(false);
      editor.commands.setContent(source, { emitUpdate: false });
      expect(editor.getJSON().content?.[0]?.type).toBe('legacyImage');
      expect(editor.view.dom.querySelector(`img[src="${dataImage}"]`)).not.toBeNull();
      const saved = getMarkdown(editor);
      expect(saved).toContain(dataImage);
      expect(saved).toContain('Legacy');
      editor.commands.setContent(saved, { emitUpdate: false });
      expect(getMarkdown(editor)).toBe(saved);
    },
  );
  it('uploads a data image pasted as Markdown instead of letting an opaque source bypass the clipboard boundary', async () => {
    const upload = vi.fn().mockResolvedValue('/uploaded.png');
    const editor = editorFor(upload);
    pasteMarkdown(editor, `![Inline](${dataImage})`);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(getMarkdown(editor)).toBe('![Inline](/uploaded.png)'));
  });
});

describe('image values from source and paste', () => {
  it('preserves a pasted relative image filename containing spaces through reload', () => {
    const editor = paste('<img src="images/my diagram.png" alt="Diagram">');
    const saved = getMarkdown(editor);
    expect(saved).toContain('src="images/my diagram.png"');
    editor.commands.setContent(saved, { emitUpdate: false });
    expect(editor.state.doc.firstChild?.attrs.src).toBe('images/my diagram.png');
  });
  it.each(rejected.filter((src) => !/^data:image\//i.test(src)))('rejects source and pasted image scheme %j while keeping alt text (G)', (src) => {
    const source = `<img src="${src}" alt="Retained alt" />`;
    for (const editor of [editorFor(), paste(source)]) {
      if (!editor.state.doc.textContent) editor.commands.setContent(source, { emitUpdate: false });
      expect(editor.state.doc.textContent).toBe('Retained alt');
      expect(editor.getHTML()).not.toContain('<img');
      expect(getMarkdown(editor)).toBe('Retained alt');
    }
  });
  it('removes authored image handlers, styles, srcdoc and unknown attributes on save and after alt edits (F)', () => {
    const editor = editorFor();
    editor.commands.setContent(
      '<img src="/safe.png" onerror="evil()" style="position:fixed" srcdoc="evil" formaction="evil" data-evil="yes" class="block dark:hidden" width="480" alt="Original" />',
      { emitUpdate: false },
    );
    editor.commands.setNodeSelection(0);
    editor.commands.updateAttributes('image', { alt: 'Updated' });
    const saved = getMarkdown(editor);
    expect(saved).toBe('<img src="/safe.png" class="block dark:hidden" width="480" alt="Updated" />');
    expectSafeDOM(inert(saved));
  });
  it.each(['16', '4000', '1%', '100%', '49%'])('accepts width %s from both paths', (width) => {
    for (const editor of [paste(`<img src="/x.png" width="${width}">`), editorFor()]) {
      if (!editor.state.doc.firstChild?.attrs.src) editor.commands.setContent(`<img src="/x.png" width="${width}">`, { emitUpdate: false });
      expect(editor.getJSON().content?.[0]?.attrs?.width).toBe(width.endsWith('%') ? width : Number(width));
    }
  });
  it.each(['0', '-1', '15', '4001', '1.5', '12px', '0%', '101%', '50.5%', '1e3', '480&quot; onerror=&quot;x', '&gt;'])(
    'drops invalid width %s from both paths',
    (width) => {
      for (const source of [false, true]) {
        const html = `<img src="/safe.png" class="block" width="${width}" />`;
        const editor = source ? editorFor() : paste(html);
        if (source) editor.commands.setContent(html, { emitUpdate: false });
        expect(editor.getJSON().content?.[0]?.attrs?.width).toBeNull();
        expect(getMarkdown(editor)).not.toContain('width=');
        expectSafeDOM(inert(renderToStaticMarkup(createElement(RichMarkdown, { content: getMarkdown(editor) }))));
      }
    },
  );
  it.each(['class', 'className'])('drops mixed %s attributes on load and paste, and escapes malicious alt edits', (name) => {
    for (const source of [false, true]) {
      const html = `<img src="/safe.png" ${name}="fixed inset-0 z-50 block dark:hidden" width="480" />`;
      const editor = source ? editorFor() : paste(html);
      if (source) editor.commands.setContent(html, { emitUpdate: false });
      expect(editor.getJSON().content?.[0]?.attrs?.[name]).toBeNull();
      editor.commands.setNodeSelection(0);
      editor.commands.updateAttributes('image', { alt: '" onerror="x <tag> & more' });
      const saved = getMarkdown(editor);
      expect(saved).not.toContain(`${name}=`);
      expect(saved).toContain('alt="&quot; onerror=&quot;x &lt;tag&gt; &amp; more"');
      expectSafeDOM(inert(renderToStaticMarkup(createElement(RichMarkdown, { content: saved }))));
    }
  });
  it('records the existing reader boundary: direct authored utility classes are allowed, while editor output filters them', () => {
    const raw = '<img src="/x.png" class="fixed inset-0 block" />';
    const direct = inert(renderToStaticMarkup(createElement(RichMarkdown, { content: raw })));
    expect(direct.querySelector('img')?.classList.contains('fixed')).toBe(true);
    const editor = paste(raw);
    const hardened = inert(renderToStaticMarkup(createElement(RichMarkdown, { content: getMarkdown(editor) })));
    expect(hardened.querySelector('img')?.classList.contains('fixed')).toBe(false);
  });
  it('renders className on the reader and records its unrestricted dimension policy', () => {
    const direct = inert(
      renderToStaticMarkup(createElement(RichMarkdown, { content: '<img src="/x.png" className="block dark:hidden" width="99999" />' })),
    );
    expect(direct.querySelector('img')?.classList.contains('dark:hidden')).toBe(true);
    expect(direct.querySelector('img')?.getAttribute('width')).toBe('99999');
    const editor = editorFor();
    editor.commands.setContent('<img src="/x.png" className="block dark:hidden" width="99999" />', { emitUpdate: false });
    expect(getMarkdown(editor)).toContain('className="block dark:hidden"');
    expect(getMarkdown(editor)).not.toContain('width=');
  });
});
