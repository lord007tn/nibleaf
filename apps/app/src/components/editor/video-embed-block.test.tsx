/** @vitest-environment jsdom */
/**
 * AUTH-11: the editor's Video and Embed blocks, as a writer uses them: found
 * from the slash menu in English and Arabic, inserted, set up (address, a
 * required title, start, caption), checked, removed, pasted, and turned from a
 * link. The preview is the reader's own facade and requests nothing.
 */

import { type MessageKey, type MessageVariables, translateFn } from '@nibleaf/i18n';
import { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { AllSelection } from '@tiptap/pm/state';
import { EditorContent } from '@tiptap/react';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const translate = (key: MessageKey, variables?: MessageVariables) => translateFn(key, variables, 'en');
vi.mock('@nibleaf/i18n/react', async (original) => ({ ...(await original<object>()), useT: () => translate }));
vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ projectId: 'project-1' }) }));
vi.mock('./active-branch-context', () => ({ useActiveBranchId: () => 'main' }));
vi.mock('@/hooks/api', () => ({ useLanguages: () => ({ data: [{ id: 'en', code: 'en' }] }), usePages: () => ({ data: [] }) }));

import { LinkEditorPanel } from './editor-bubble-menu';
import { createSlashItems, rankSlashItems, slashSection } from './extensions/slash-command';
import { embedLinkedVideo, type VideoEmbedAttributes } from './extensions/video-embed';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const YT = 'M7lc1UVf-VE';
const en = (key: MessageKey, variables?: MessageVariables) => translateFn(key, variables, 'en');

const editors: Editor[] = [];
const roots: Root[] = [];
beforeEach(() => {
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
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
});

/** An editor rendered with React node views, as the app renders it. */
async function make(content = '', { editable = true, dir = 'ltr' }: { editable?: boolean; dir?: 'ltr' | 'rtl' } = {}) {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions({ dir }), editable });
  editors.push(editor);
  editor.commands.setContent(content, { emitUpdate: false });
  const host = document.createElement('div');
  host.dir = dir;
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(createElement(EditorContent, { editor })));
  return { editor, host };
}

const blocks = (editor: Editor) => {
  const found: PMNode[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'videoEmbed') found.push(node);
  });
  return found.map((node) => node.attrs as VideoEmbedAttributes);
};
/** The input a visible label names. */
const field = (host: HTMLElement, label: string): HTMLInputElement => {
  const element = Array.from(host.querySelectorAll('label')).find((candidate) => candidate.textContent?.startsWith(label));
  const input = element?.htmlFor ? host.ownerDocument.getElementById(element.htmlFor) : null;
  if (!(input instanceof HTMLInputElement)) throw new Error(`No field labelled ${label}`);
  return input;
};
const button = (host: HTMLElement, name: string): HTMLElement => {
  const found = Array.from(host.querySelectorAll<HTMLElement>('button, a')).find((candidate) => candidate.textContent?.trim().startsWith(name));
  if (!found) throw new Error(`No button ${name}`);
  return found;
};
const type = async (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const blur = async (input: HTMLInputElement) =>
  act(async () => {
    input.focus();
    input.blur();
  });
const press = async (target: HTMLElement, key: string) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
const click = async (target: HTMLElement) =>
  act(async () => {
    target.click();
  });
const slashItem = (key: MessageKey) => {
  const item = createSlashItems().find((candidate) => candidate.titleKey === key);
  if (!item) throw new Error(`No slash item ${key}`);
  return item;
};
/** Nothing in the block loads from anywhere before play: no frame, image, script or source element. */
const requestingElements = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('iframe, img, script, link, source, [poster]')).concat(
    Array.from(host.querySelectorAll('video')).filter((video) => video.getAttribute('preload') !== 'none'),
  );

describe('finding the blocks in the slash menu', () => {
  const titles = (query: string, locale: 'en' | 'ar' = 'en') => rankSlashItems(createSlashItems(), query, locale).map((item) => item.titleKey);

  it.each(['video', 'youtube', 'loom', 'vimeo', 'wistia', 'mp4'])('finds Video for "%s"', (query) => {
    expect(titles(query)[0]).toBe('editor.slash.video.title');
  });

  it('finds Embed first for "embed", and both blocks for "embed" and "iframe"', () => {
    expect(titles('embed')[0]).toBe('editor.slash.embed.title');
    for (const query of ['embed', 'iframe'])
      expect(titles(query)).toEqual(expect.arrayContaining(['editor.slash.video.title', 'editor.slash.embed.title']));
  });

  it('finds them by their Arabic names, and by English names in an Arabic menu', () => {
    expect(titles(translateFn('editor.slash.video.title', undefined, 'ar'), 'ar')[0]).toBe('editor.slash.video.title');
    expect(titles(translateFn('editor.slash.embed.title', undefined, 'ar'), 'ar')[0]).toBe('editor.slash.embed.title');
    expect(titles('youtube', 'ar')[0]).toBe('editor.slash.video.title');
  });

  it('lists them with images and tables, under Media', () => {
    expect(slashSection(slashItem('editor.slash.video.title'))).toBe('editor.slash.section.media');
    expect(slashSection(slashItem('editor.slash.embed.title'))).toBe('editor.slash.section.media');
    expect(en('editor.slash.section.media')).toBe('Media & tables');
  });
});

describe('inserting and setting up a Video block', () => {
  it('inserts from the slash menu with the address field focused, and checks the address with the shared rules', async () => {
    const { editor, host } = await make('/vid');
    await act(async () => slashItem('editor.slash.video.title').command({ editor, range: { from: 1, to: 5 }, locale: 'en' }));
    const url = field(host, en('editor.video.url'));
    await vi.waitFor(() => expect(document.activeElement).toBe(url));
    expect(blocks(editor)).toEqual([expect.objectContaining({ src: '', intent: 'video', focus: '' })]);
    expect(host.textContent).toContain(en('editor.video.empty'));

    await type(url, 'https://example.com/not-a-video');
    await blur(url);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(en('editor.video.invalidUrl'));
    expect(url.getAttribute('aria-invalid')).toBe('true');
    await type(url, 'https://cdn.example.com/a\u0000.mp4');
    await blur(url);
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(blocks(editor)[0]?.src).toBe('');

    await type(url, `https://www.youtube.com/watch?v=${YT}`);
    await press(url, 'Enter');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(blocks(editor)[0]).toEqual(expect.objectContaining({ kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${YT}` }));
  });

  it('marks the title as required, and saves the canonical iframe with it', async () => {
    const { editor, host } = await make('');
    await act(async () => slashItem('editor.slash.video.title').command({ editor, range: { from: 1, to: 1 }, locale: 'en' }));
    await type(field(host, en('editor.video.url')), `https://youtu.be/${YT}`);
    await blur(field(host, en('editor.video.url')));
    const title = field(host, en('editor.video.title'));
    expect(title.getAttribute('aria-required')).toBe('true');
    expect(title.labels?.[0]?.textContent).toBe(`${en('editor.video.title')}(${en('editor.video.required')})`);
    expect(document.getElementById(title.getAttribute('aria-describedby') ?? '')?.textContent).toBe(en('editor.video.titleMissing'));
    await type(title, 'Product tour');
    expect(document.getElementById(title.getAttribute('aria-describedby') ?? '')?.textContent).toBe(en('editor.video.titleHint'));
    expect(getMarkdown(editor)).toBe(`<iframe src="https://www.youtube-nocookie.com/embed/${YT}" title="Product tour"></iframe>`);
  });

  it('sets a start time for YouTube and Vimeo, and a caption that writes <Frame caption>', async () => {
    const { editor, host } = await make(`<iframe src="https://www.youtube-nocookie.com/embed/${YT}" title="Tour"></iframe>`);
    await click(button(host, en('editor.video.settings')));
    const start = field(host, en('editor.video.start'));
    await type(start, '1:75');
    await blur(start);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(en('editor.video.invalidStart'));
    await type(start, '1:30');
    await blur(start);
    expect(blocks(editor)[0]?.src).toBe(`https://www.youtube-nocookie.com/embed/${YT}?start=90`);
    await type(field(host, en('editor.video.caption')), 'From start to finish');
    expect(getMarkdown(editor)).toBe(
      `<Frame caption="From start to finish">\n  <iframe src="https://www.youtube-nocookie.com/embed/${YT}?start=90" title="Tour"></iframe>\n</Frame>`,
    );
  });

  it('has no start time for Loom, Wistia or a video file, and no title for a video file', async () => {
    const { host } = await make('<video controls src="https://cdn.example.com/demo.mp4"></video>');
    await click(button(host, en('editor.video.settings')));
    expect(() => field(host, en('editor.video.start'))).toThrow();
    expect(() => field(host, en('editor.video.title'))).toThrow();
    expect(field(host, en('editor.video.caption'))).toBeTruthy();
  });

  it('opens and closes its settings from the keyboard, returning focus to the Settings button', async () => {
    const { host } = await make(`<iframe src="https://www.youtube-nocookie.com/embed/${YT}" title="Tour"></iframe>`);
    const settings = button(host, en('editor.video.settings'));
    expect(settings.getAttribute('aria-expanded')).toBe('false');
    await click(settings);
    expect(settings.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(settings.getAttribute('aria-controls') ?? '')?.getAttribute('aria-label')).toBe(en('editor.video.settings'));
    await press(field(host, en('editor.video.title')), 'Escape');
    expect(settings.getAttribute('aria-expanded')).toBe('false');
    await vi.waitFor(() => expect(document.activeElement).toBe(settings));
  });

  it('removes the block', async () => {
    const { editor, host } = await make(`Before\n\n<iframe src="https://www.youtube-nocookie.com/embed/${YT}" title="Tour"></iframe>\n\nAfter`);
    await click(button(host, en('editor.video.remove')));
    expect(blocks(editor)).toEqual([]);
    expect(getMarkdown(editor)).toBe('Before\n\nAfter');
  });

  it('is named for screen readers, and offers nothing to change when read-only', async () => {
    const { host } = await make(`<iframe src="https://www.youtube-nocookie.com/embed/${YT}" title="Tour"></iframe>`, { editable: false });
    expect(host.querySelector('[data-video-embed]')?.getAttribute('aria-label')).toBe(en('editor.video.blockLabel', { name: 'Tour' }));
    expect(() => button(host, en('editor.video.settings'))).toThrow();
    expect(() => button(host, en('editor.video.remove'))).toThrow();
    expect(button(host, en('editor.video.preview')).textContent).toContain(en('editor.video.opensInNewTab'));
  });
});

describe('the preview is the reader facade and requests nothing', () => {
  it('shows the poster with the title and provider, and a Preview link to the provider page in a new tab', async () => {
    const { host } = await make(`<iframe src="https://www.youtube-nocookie.com/embed/${YT}?start=30" title="Tour"></iframe>`);
    const poster = host.querySelector('[data-theme-component="video-embed"]');
    expect(poster?.getAttribute('data-provider')).toBe('youtube');
    expect(poster?.textContent).toContain('Tour');
    expect(poster?.textContent).toContain('YouTube');
    expect(poster?.querySelector('button, a')).toBeNull();
    expect(requestingElements(host)).toEqual([]);
    const preview = button(host, en('editor.video.preview'));
    expect(preview.getAttribute('href')).toBe(`https://www.youtube.com/watch?v=${YT}&t=30s`);
    expect(preview.getAttribute('target')).toBe('_blank');
    expect(preview.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('shows a video file with controls that loads nothing before play', async () => {
    const { host } = await make('<video controls src="https://cdn.example.com/demo.mp4" poster="https://cdn.example.com/p.png"></video>');
    const video = host.querySelector('video');
    expect(video?.getAttribute('preload')).toBe('none');
    expect(video?.hasAttribute('poster')).toBe(false);
    expect(requestingElements(host)).toEqual([]);
  });

  it('shows another https page as the reader’s link card, and says why', async () => {
    const { host } = await make('<iframe src="https://maps.example.com/embed?q=1" title="Office map"></iframe>');
    const card = host.querySelector<HTMLAnchorElement>('[data-theme-component="embed-link"]');
    expect(card?.textContent).toContain('Office map');
    expect(card?.textContent).toContain('maps.example.com');
    expect(card?.target).toBe('_blank');
    expect(host.textContent).toContain('Shown as a link: only YouTube, Vimeo, Loom and Wistia play inline');
    expect(host.querySelector('[data-video-embed]')?.getAttribute('aria-label')).toBe(en('editor.video.embedBlockLabel', { name: 'Office map' }));
    expect(requestingElements(host)).toEqual([]);
  });

  it('shows a non-https address as text, as the reader does', async () => {
    const { host } = await make('<iframe src="http://example.com/x" title="Old"></iframe>');
    expect(host.querySelector('[data-theme-component="embed-link"]')).toBeNull();
    expect(host.textContent).toContain('http://example.com/x');
    expect(host.textContent).toContain(en('editor.video.shownAsText'));
  });

  it('takes an Embed address from the Embed block', async () => {
    const { editor, host } = await make('');
    await act(async () => slashItem('editor.slash.embed.title').command({ editor, range: { from: 1, to: 1 }, locale: 'en' }));
    const url = field(host, en('editor.video.embedUrl'));
    await type(url, 'http://maps.example.com/embed');
    await blur(url);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(en('editor.video.invalidEmbedUrl'));
    await type(url, 'https://maps.example.com/embed');
    await blur(url);
    await type(field(host, en('editor.video.title')), 'Map');
    expect(getMarkdown(editor)).toBe('<iframe src="https://maps.example.com/embed" title="Map"></iframe>');
  });

  it('hides its own caption field inside a Frame that holds more than the video', async () => {
    const { host } = await make(
      `<Frame caption="Both">\n\n<iframe src="https://www.youtube-nocookie.com/embed/${YT}" title="Tour"></iframe>\n\nAnd text.\n\n</Frame>`,
    );
    await click(button(host, en('editor.video.settings')));
    expect(() => field(host, en('editor.video.caption'))).toThrow();
  });
});

describe('pasting a video link', () => {
  const pasteText = (editor: Editor, text: string) =>
    editor.view.pasteText(
      text,
      Object.assign(new Event('paste'), {
        clipboardData: { getData: (kind: string) => (kind === 'text/plain' ? text : '') },
      }) as unknown as ClipboardEvent,
    );

  it('turns a bare video link on an empty line into the block, asking for its title', async () => {
    const { editor, host } = await make('<p>Intro</p><p></p>');
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(editor.state.selection.$from.parent.content.size).toBe(0);
    await act(async () => pasteText(editor, `https://www.youtube.com/watch?v=${YT}`));
    expect(blocks(editor)).toEqual([expect.objectContaining({ kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${YT}` })]);
    await vi.waitFor(() => expect(document.activeElement).toBe(field(host, en('editor.video.title'))));
  });

  it('keeps a video link pasted into a line of text a link', async () => {
    const { editor } = await make('Watch this: ');
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    await act(async () => pasteText(editor, `https://www.youtube.com/watch?v=${YT}`));
    expect(blocks(editor)).toEqual([]);
    expect(getMarkdown(editor)).toContain(`https://www.youtube.com/watch?v=${YT}`);
    expect(getMarkdown(editor)).not.toContain('<iframe');
  });

  it('keeps any other link on an empty line a link', async () => {
    const { editor } = await make('');
    await act(async () => pasteText(editor, 'https://example.com/docs'));
    expect(blocks(editor)).toEqual([]);
  });

  it('keeps iframe markup pasted as text, text', async () => {
    const { editor } = await make('');
    await act(async () => pasteText(editor, `<iframe src="https://www.youtube.com/embed/${YT}" onload="alert(1)"></iframe>`));
    expect(blocks(editor)).toEqual([]);
    expect(getMarkdown(editor)).not.toContain('<iframe');
  });

  it('never takes a block, or its saved source, from pasted HTML', async () => {
    const { editor } = await make('');
    const source = encodeURIComponent('<iframe src="javascript:alert(1)" srcdoc="x"></iframe>');
    await act(async () =>
      editor.view.pasteHTML(
        `<nibleaf-video-embed data-source="${source}" data-frame-open="0" data-frame-close="54"></nibleaf-video-embed><iframe src="https://www.youtube.com/embed/${YT}"></iframe>`,
        new Event('paste') as ClipboardEvent,
      ),
    );
    expect(blocks(editor)).toEqual([]);
    expect(getMarkdown(editor)).not.toMatch(/iframe|javascript|srcdoc/);
  });
});

describe('copying the block to another editor', () => {
  it('carries its validated address, title and caption across independent editors', async () => {
    const page = `<Frame caption="From start to finish">\n  <iframe src="https://www.youtube.com/embed/${YT}?si=track" title="Tour" onload="x()"></iframe>\n</Frame>`;
    const { editor: from } = await make(page);
    const { editor: to } = await make('');
    from.view.dispatch(from.state.tr.setSelection(new AllSelection(from.state.doc)));
    const { dom } = from.view.serializeForClipboard(from.state.selection.content());
    await act(async () => to.view.pasteHTML(dom.innerHTML, new Event('paste') as ClipboardEvent));
    expect(blocks(to)).toEqual([
      expect.objectContaining({
        kind: 'iframe',
        src: `https://www.youtube-nocookie.com/embed/${YT}`,
        title: 'Tour',
        caption: 'From start to finish',
      }),
    ]);
    expect(getMarkdown(to)).toBe(
      `<Frame caption="From start to finish">\n  <iframe src="https://www.youtube-nocookie.com/embed/${YT}" title="Tour"></iframe>\n</Frame>`,
    );
  });

  it('drops a copied block whose address the block would not accept', async () => {
    const { editor } = await make('');
    await act(async () =>
      editor.view.pasteHTML(
        '<div data-video-embed="iframe" data-src="javascript:alert(1)" data-title="x"></div><div data-video-embed="iframe" data-src="http://example.com/x"></div>',
        new Event('paste') as ClipboardEvent,
      ),
    );
    expect(blocks(editor)).toEqual([]);
    expect(getMarkdown(editor)).not.toMatch(/iframe|javascript/);
  });
});

describe("turning a video link into the block from the link's menu", () => {
  it('replaces a paragraph that is only the link', async () => {
    const { editor } = await make(`[Tour](https://youtu.be/${YT})`);
    editor.commands.setTextSelection(3);
    expect(embedLinkedVideo(editor, `https://youtu.be/${YT}`)).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe('videoEmbed');
    expect(blocks(editor)).toEqual([expect.objectContaining({ src: `https://www.youtube-nocookie.com/embed/${YT}` })]);
  });

  it('adds the block after a paragraph with other words, which stay', async () => {
    const { editor } = await make(`Watch [the tour](https://youtu.be/${YT}) first.`);
    editor.commands.setTextSelection(10);
    expect(embedLinkedVideo(editor, `https://youtu.be/${YT}`)).toBe(true);
    expect(editor.state.doc.child(0).textContent).toBe('Watch the tour first.');
    expect(editor.state.doc.child(1).type.name).toBe('videoEmbed');
  });

  it('offers "Embed video" in the link menu for a video link only', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const editor = new Editor({ element: host, extensions: buildEditorExtensions(), content: `<p><a href="https://youtu.be/${YT}">Tour</a></p>` });
    editors.push(editor);
    editor.commands.setTextSelection(2);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const onDone = vi.fn();
    await act(async () => root.render(<LinkEditorPanel editor={editor} initialUrl={`https://youtu.be/${YT}`} onDone={onDone} />));
    await click(button(container, en('editor.video.embedVideo')));
    expect(onDone).toHaveBeenCalled();
    expect(editor.state.doc.firstChild?.type.name).toBe('videoEmbed');

    await act(async () => root.render(<LinkEditorPanel editor={editor} initialUrl="https://example.com/docs" onDone={onDone} />));
    expect(() => button(container, en('editor.video.embedVideo'))).toThrow();
  });
});
