// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { AllSelection } from '@tiptap/pm/state';
import { EditorContent } from '@tiptap/react';
import { act, createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownRenderer } from '../../markdown';
import RichMarkdown from '../../markdown-rich';
import { TableBubbleMenu } from '../table-menu';
import { buildEditorExtensions, getMarkdown } from '../tiptap-editor';
import { alignTableColumns } from './aligned-table';
import { imagePromptKey } from './block-image';
import { cleanPasteDOM } from './clean-paste';
import { addImageCaption, ImageControls } from './image-controls';
import { type ImageUploader, uploadEditorImage } from './image-upload';

beforeEach(() => {
  vi.stubGlobal('ClipboardEvent', class extends Event {});
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 1, 1);
});
const editors: Editor[] = [];
const mounts: { root: Root; host: HTMLElement }[] = [];
function make(canEdit = () => true) {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions({ canEdit }) });
  editors.push(editor);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(createElement(EditorContent, { editor })));
  mounts.push({ root, host });
  return editor;
}
function clean(html: string) {
  const root = document.createElement('div');
  root.innerHTML = html;
  return cleanPasteDOM(root);
}
function textPaste(editor: Editor, text: string) {
  editor.view.pasteText(
    text,
    Object.assign(new Event('paste'), {
      clipboardData: { getData: (type: string) => (type === 'text/plain' ? text : '') },
    }) as unknown as ClipboardEvent,
  );
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
});

describe('review content regressions', () => {
  it('keeps Card groups, callouts, Frames, Tabs, Steps and code options through real internal clipboard serialization (1)', () => {
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
  it('does not trust a forged data-pm-slice marker (1)', () => {
    const editor = make();
    editor.view.pasteHTML('<div data-pm-slice="0 0 []" data-mdx="Card"><img src="x" onerror="alert(1)"><iframe srcdoc="evil"></iframe></div>');
    expect(getMarkdown(editor)).not.toMatch(/Card|onerror|iframe|srcdoc/);
  });
  it('keeps restarted Word numbering, list instances and non-one starts (3)', () => {
    const item = (ordinal: number, lfo: number) =>
      `<p style="mso-list:l0 level1 lfo${lfo}"><![if !supportLists]><span>${ordinal}.&nbsp;</span><![endif]>Item ${ordinal}</p>`;
    expect(clean(item(1, 1) + item(2, 1) + item(1, 1) + item(4, 2)).innerHTML).toBe(
      '<ol><li>Item 1</li><li>Item 2</li></ol><ol><li>Item 1</li></ol><ol start="4"><li>Item 4</li></ol>',
    );
    const editor = make();
    editor.view.pasteHTML(item(4, 2));
    expect(getMarkdown(editor)).toBe('4. Item 4');
    editor.commands.clearContent();
    editor.view.pasteHTML(item(1, 1) + item(2, 1) + item(1, 1) + item(4, 2));
    const listStarts = () =>
      editor.state.doc.content.content.filter((node) => node.type.name === 'orderedList').map((node) => [node.attrs.start, node.childCount]);
    const before = listStarts();
    expect(before).toEqual([
      [1, 2],
      [1, 1],
      [4, 1],
    ]);
    editor.commands.setContent(getMarkdown(editor), { emitUpdate: false });
    expect(listStarts()).toEqual(before);
  });
  it.each(['o is the variable', '1. is literal prose'])('never eats unmarked Word leading text: %s (3)', (text) => {
    expect(clean(`<p style="mso-list:l0 level1 lfo1">${text}</p>`).textContent).toBe(text);
  });
  it('unwraps form wrappers and unknown markup, dropping only controls and active/chrome content (H)', () => {
    const root = clean(
      '<form><main><h2>Article</h2><custom-box>Keep <b>this</b></custom-box><p>Before<input value="secret"><select><option>Control</option></select><textarea>Control</textarea><button>Control</button>After</p></main></form>',
    );
    expect(root.innerHTML).toBe('<h2>Article</h2>Keep <b>this</b><p>BeforeAfter</p>');
  });
  it('never wraps table or list structure in inline marks from container styles (I)', () => {
    const root = clean(
      '<table style="font-weight:bold"><tbody><tr><td>Cell</td></tr></tbody></table><ul style="font-style:italic"><li>Item</li></ul><p style="font-weight:bold">Bold</p>',
    );
    expect(root.querySelector('table > strong, ul > em')).toBeNull();
    expect(root.querySelector('p > strong')?.textContent).toBe('Bold');
    const editor = make();
    editor.view.pasteHTML(root.innerHTML);
    expect(getMarkdown(editor)).toContain('Cell');
  });
  it('keeps pasted underline as u markup and records the current reader gap (9)', () => {
    const editor = make();
    editor.view.pasteHTML('<p><span style="text-decoration:underline">Keep underline</span></p>');
    const saved = getMarkdown(editor);
    expect(saved).toBe('<u>Keep underline</u>');
    expect(renderToStaticMarkup(createElement(RichMarkdown, { content: saved }))).toContain('Keep underline');
    expect(renderToStaticMarkup(createElement(RichMarkdown, { content: saved }))).not.toContain('<u>');
    // The basic renderer intentionally does not parse raw HTML; routing uses RichMarkdown.
    expect(renderToStaticMarkup(createElement(MarkdownRenderer, { content: saved }))).toContain('Keep underline');
  });
  it.each(['/api/v1/users', 'https://example.com/old', 'www.example.com', 'example.com/path'])(
    'replaces URL-like selected text instead of linking it: %s (E)',
    (selected) => {
      const editor = make();
      editor.commands.setContent(selected, { emitUpdate: false });
      editor.commands.setTextSelection({ from: 1, to: selected.length + 1 });
      textPaste(editor, 'https://example.com/new');
      expect(editor.state.doc.textContent).toBe('https://example.com/new');
    },
  );
  it('replaces a selected relative path with the pasted path (E)', () => {
    const editor = make();
    editor.commands.setContent('/api/v1/users', { emitUpdate: false });
    editor.commands.setTextSelection({ from: 1, to: 14 });
    textPaste(editor, '/api/v2/users');
    expect(getMarkdown(editor)).toBe('/api/v2/users');
  });
  it.each([
    ['https://x.com/a.png?v=1', true],
    ['https://x.com/page?file=a.png', false],
  ] as const)('detects image pathname for %s (10)', (url, image) => {
    const editor = make();
    textPaste(editor, url);
    expect(editor.state.doc.firstChild?.type.name === 'image').toBe(image);
  });
  it('cleans a roughly 1 MB paste without per-element ancestor walks (L)', () => {
    // Many realistic spans/links, with text dominating the byte size as in articles.
    const fixture = `<form>${'<p class="word"><a href="/help"><span style="text-decoration:underline">Read this. </span></a>'.padEnd(4096, 'x').concat('</p>').repeat(256)}</form>`;
    expect(fixture.length).toBeGreaterThan(1024 * 1024);
    const root = document.createElement('div');
    root.innerHTML = fixture;
    const start = performance.now();
    cleanPasteDOM(root);
    const elapsed = performance.now() - start;
    console.info(`1 MB cleanup: ${elapsed.toFixed(1)} ms`);
    expect(elapsed).toBeLessThan(1000);
    expect(root.querySelector('form,span,[style]')).toBeNull();
  });
  it.each(['ltr', 'rtl'] as const)('shows active and default alignment and matching physical reader alignment in %s (J, C, 8)', async (dir) => {
    const editor = make();
    editor.commands.setContent('| A |\n| --- |\n| B |', { emitUpdate: false });
    editor.commands.setTextSelection(4);
    const mounted = mounts.at(-1);
    if (!mounted) throw new Error('Expected a mounted editor');
    const { root, host } = mounted;
    await act(async () =>
      root.render(
        <>
          <EditorContent editor={editor} />
          <TableBubbleMenu editor={editor} dir={dir} />
        </>,
      ),
    );
    const find = (label: string) => Array.from(host.querySelectorAll('button')).find((element) => element.getAttribute('aria-label') === label);
    expect(find('Default alignment')?.getAttribute('aria-pressed')).toBe('true');
    await act(async () => {
      find('Align to start')?.click();
    });
    const physical = dir === 'rtl' ? 'right' : 'left';
    expect(find('Align to start')?.getAttribute('aria-pressed')).toBe('true');
    expect(getMarkdown(editor)).toContain(dir === 'rtl' ? '---:' : ':---');
    for (const rich of [false, true]) {
      const render = (content: string) =>
        renderToStaticMarkup(rich ? createElement(RichMarkdown, { content }) : createElement(MarkdownRenderer, { content }));
      const parsed = document.createElement('div');
      parsed.innerHTML = render(getMarkdown(editor));
      expect(parsed.querySelector('th')?.getAttribute('align') ?? parsed.querySelector('th')?.style.textAlign).toBe(physical);
      editor.commands.toggleHeaderRow();
      alignTableColumns(editor, physical);
      parsed.innerHTML = renderToStaticMarkup(createElement(RichMarkdown, { content: getMarkdown(editor) }));
      expect(parsed.querySelector('td')?.getAttribute('align') ?? parsed.querySelector('td')?.style.textAlign).toBe(physical);
      editor.commands.toggleHeaderRow();
    }
    await act(async () => {
      find('Default alignment')?.click();
    });
    expect(getMarkdown(editor)).toContain('| --- |');
  });
});

describe('review image and upload regressions', () => {
  it('never moves selection or focus when typing during upload (D)', async () => {
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
  it('pastes an article with three images without selecting an image or focusing its prompt (D)', () => {
    const editor = make();
    const focus = document.activeElement;
    editor.view.pasteHTML('<p>Start</p><img src="/1.png"><p>Middle</p><img src="/2.png"><img src="/3.png"><p>End</p>');
    expect(editor.state.selection.toJSON().type).toBe('text');
    expect(imagePromptKey.getState(editor.state)).toBe(0);
    expect(document.activeElement).toBe(focus);
  });
  it('makes Retry idempotent, Remove aborts, and late completion inserts nothing (5, K)', async () => {
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
  it('restores upload progress, failure and retry state when widgets are recreated (12)', async () => {
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
  it('shows Finishing during confirm and a timeout with Retry after two minutes (K)', async () => {
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
  it('blocks every document mutation from image and upload controls in comment mode (4)', async () => {
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
  it('keeps preset width inside a Frame and labels both theme variants for writers (6, 7)', () => {
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
});
