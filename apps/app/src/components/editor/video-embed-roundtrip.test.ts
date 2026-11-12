// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, describe, expect, it } from 'vitest';
import type { VideoEmbedAttributes } from './extensions/video-embed';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * The Video and Embed block stores canonical, Mintlify-compatible HTML: an
 * `<iframe src title>` or `<video controls src>`, optionally in `<Frame caption>`.
 * Opened and saved untouched, every form comes back byte for byte.
 */

const YT = 'M7lc1UVf-VE';
const LOOM = '0123456789abcdef0123456789abcdef';
const fixtures = resolve(import.meta.dirname, '../../../../../packages/shared/src/__fixtures__');
/** A fixture's body: the page content the editor holds, without its front matter. */
const pageBody = (file: string) =>
  readFileSync(resolve(fixtures, file), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/^---\n[\s\S]*?\n---\n\n/, '');

const editors: Editor[] = [];
const open = (markdown: string) => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  editors.push(editor);
  editor.commands.setContent(markdown, { emitUpdate: false });
  return editor;
};
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

const blocks = (editor: Editor) => {
  const found: Array<{ node: PMNode; pos: number }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'videoEmbed') found.push({ node, pos });
  });
  return found;
};
const values = (editor: Editor) =>
  blocks(editor).map(({ node }) => {
    const { kind, src, title, caption } = node.attrs as VideoEmbedAttributes;
    return { kind, src, title, caption };
  });
const setAttributes = (editor: Editor, index: number, attributes: Partial<VideoEmbedAttributes>) => {
  const block = blocks(editor)[index];
  if (!block) throw new Error(`No block ${index}`);
  editor.view.dispatch(editor.state.tr.setNodeMarkup(block.pos, undefined, { ...block.node.attrs, ...attributes }));
};

const storageForms: Array<[string, string, Partial<VideoEmbedAttributes>]> = [
  ['YouTube', `<iframe src="https://www.youtube-nocookie.com/embed/${YT}" title="Product tour"></iframe>`, { kind: 'iframe', title: 'Product tour' }],
  ['Vimeo', '<iframe src="https://player.vimeo.com/video/76979871#t=90s" title="Release notes"></iframe>', { kind: 'iframe' }],
  ['Loom', `<iframe src="https://www.loom.com/embed/${LOOM}" title="Walkthrough"></iframe>`, { kind: 'iframe' }],
  ['Wistia', '<iframe src="https://fast.wistia.net/embed/iframe/abcde12345" title="Demo"></iframe>', { kind: 'iframe' }],
  ['a video file', '<video controls src="https://cdn.example.com/demo.mp4"></video>', { kind: 'video', title: '' }],
  [
    'a captioned Frame',
    `<Frame caption="The tour, start to finish">\n  <iframe src="https://www.youtube-nocookie.com/embed/${YT}?start=30" title="Product tour"></iframe>\n</Frame>`,
    { kind: 'iframe', caption: 'The tour, start to finish' },
  ],
  [
    'another https page (kept an iframe)',
    '<iframe src="https://maps.example.com/embed?q=harbour&amp;z=4" title="Office map"></iframe>',
    { kind: 'iframe', src: 'https://maps.example.com/embed?q=harbour&z=4' },
  ],
];

describe('Video and Embed block storage', () => {
  it.each(storageForms)('opens %s as the block and saves it back byte for byte', (_name, form, expected) => {
    const page = `Watch this first.\n\n${form}\n\nThen read on.`;
    const editor = open(page);
    expect(values(editor)).toEqual([expect.objectContaining(expected)]);
    expect(getMarkdown(editor)).toBe(page);
    // Editing another block leaves it as written too.
    editor.commands.setTextSelection(3);
    editor.commands.insertContent('!');
    expect(getMarkdown(editor)).toBe(page.replace('Wa', 'Wa!'));
  });

  it('opens a page imported from Mintlify with every video as the block, and saves it unchanged', () => {
    const page = pageBody('mintlify-video-embeds.imported.mdx');
    const editor = open(page);
    expect(values(editor)).toEqual([
      { kind: 'iframe', src: 'https://www.youtube.com/embed/dQw4w9WgXcQ?si=abc123', title: 'YouTube video player', caption: '' },
      { kind: 'iframe', src: `https://www.loom.com/embed/${LOOM}`, title: 'Loom walkthrough', caption: '' },
      { kind: 'video', src: 'https://cdn.example.com/demo.mp4', title: '', caption: '' },
      { kind: 'video', src: 'https://cdn.example.com/b.mp4', title: '', caption: '' },
      { kind: 'iframe', src: 'https://codepen.io/team/embed/abc', title: 'A pen', caption: '' },
    ]);
    // Every embed saves byte for byte. The rest of the page gets the editor's usual Markdown
    // spacing, as on main: a blank line after a heading, and no newline at the end.
    expect(getMarkdown(editor)).toBe(page.replace('### Record a walkthrough\nShare', '### Record a walkthrough\n\nShare').trimEnd());
    expect(getMarkdown(open(getMarkdown(editor)))).toBe(getMarkdown(editor));
  });

  it("opens Mintlify's documented <Frame><iframe …></iframe></Frame> as one block and saves it unchanged", () => {
    const page = pageBody('mintlify-video-embeds.mdx');
    const frame = page.slice(page.indexOf('<Frame>'), page.indexOf('</Frame>') + '</Frame>'.length);
    const source = `Watch the tour first.\n\n${frame}\n\nMore below.`;
    const editor = open(source);
    expect(blocks(editor)).toHaveLength(1);
    expect(blocks(editor)[0]?.node.attrs.source).toBe(frame);
    expect(getMarkdown(editor)).toBe(source);
  });

  it('keeps every iframe and video of the original Mintlify page through a save, inside components too', () => {
    const page = pageBody('mintlify-video-embeds.mdx');
    const saved = getMarkdown(open(page));
    for (const embed of page.match(/<(iframe|video)[\s\S]*?<\/\1>/g) ?? []) expect(saved).toContain(embed);
    expect(getMarkdown(open(saved))).toBe(saved);
  });

  it('keeps a video with source and caption track children as written', () => {
    const form =
      '<video controls poster="/api/public/assets/poster.png">\n  <source src="https://cdn.example.com/b.webm" type="video/webm" />\n  <track kind="captions" src="/captions/en.vtt" srclang="en" label="English" />\n</video>';
    const editor = open(form);
    expect(values(editor)).toEqual([{ kind: 'video', src: '', title: '', caption: '' }]);
    expect(getMarkdown(editor)).toBe(form);
  });
});

describe('editing the block rewrites only what changed', () => {
  it('changes the title in place, keeping the other authored attributes', () => {
    const form = `<iframe width="560" src="https://www.youtube.com/embed/${YT}" title="Old" allowFullScreen></iframe>`;
    const editor = open(form);
    setAttributes(editor, 0, { title: 'R&D "tour"' });
    const saved = getMarkdown(editor);
    expect(saved).toBe(`<iframe width="560" src="https://www.youtube.com/embed/${YT}" title="R&amp;D &quot;tour&quot;" allowFullScreen></iframe>`);
    expect(values(open(saved))[0]?.title).toBe('R&D "tour"');
  });

  it('adds a title to an untitled multi-line iframe', () => {
    const form = `<iframe\n  src="https://www.loom.com/embed/${LOOM}"\n  allowFullScreen\n></iframe>`;
    const editor = open(form);
    setAttributes(editor, 0, { title: 'Walkthrough' });
    expect(getMarkdown(editor)).toBe(`<iframe\n  src="https://www.loom.com/embed/${LOOM}"\n  allowFullScreen\n title="Walkthrough"></iframe>`);
  });

  it('wraps the block in <Frame caption> when a caption is added, and unwraps it when removed', () => {
    const form = `<iframe src="https://www.youtube-nocookie.com/embed/${YT}" title="Tour"></iframe>`;
    const editor = open(form);
    setAttributes(editor, 0, { caption: 'From start to finish' });
    const framed = getMarkdown(editor);
    expect(framed).toBe(`<Frame caption="From start to finish">\n  ${form}\n</Frame>`);
    const reopened = open(framed);
    expect(values(reopened)).toEqual([expect.objectContaining({ caption: 'From start to finish' })]);
    expect(getMarkdown(reopened)).toBe(framed);
    setAttributes(reopened, 0, { caption: '' });
    expect(getMarkdown(reopened)).toBe(form);
  });

  it("changes an authored Frame's caption and keeps the Frame's other props", () => {
    const form = `<Frame caption="Old" data-lightbox>\n  <iframe src="https://www.youtube-nocookie.com/embed/${YT}" title="Tour"></iframe>\n</Frame>`;
    const editor = open(form);
    setAttributes(editor, 0, { caption: '' });
    expect(getMarkdown(editor)).toBe(form.replace('caption="Old" ', ''));
  });

  it('writes the canonical form when a video becomes another kind', () => {
    const editor = open(`<iframe src="https://www.youtube.com/embed/${YT}" title="Tour" frameBorder="0"></iframe>`);
    setAttributes(editor, 0, { kind: 'video', src: 'https://cdn.example.com/demo.webm', title: '' });
    expect(getMarkdown(editor)).toBe('<video controls src="https://cdn.example.com/demo.webm"></video>');
  });

  it('writes a new block canonically, and nothing until it has an address', () => {
    const editor = open('Intro');
    editor.commands.setTextSelection(6);
    editor.commands.insertContent({ type: 'videoEmbed', attrs: { intent: 'video' } });
    expect(getMarkdown(editor).trim()).toBe('Intro');
    setAttributes(editor, 0, { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${YT}`, title: 'Tour' });
    expect(getMarkdown(editor)).toContain(`<iframe src="https://www.youtube-nocookie.com/embed/${YT}" title="Tour"></iframe>`);
    setAttributes(editor, 0, { caption: 'Caption' });
    const saved = getMarkdown(editor);
    expect(saved).toContain(
      `<Frame caption="Caption">\n  <iframe src="https://www.youtube-nocookie.com/embed/${YT}" title="Tour"></iframe>\n</Frame>`,
    );
    expect(getMarkdown(open(saved))).toBe(saved);
  });
});

describe('iframes and videos that are not a block of their own', () => {
  it('keeps an iframe inside a line of text as written', () => {
    const page = `See <iframe src="https://www.youtube.com/embed/${YT}"></iframe> here.`;
    const editor = open(page);
    expect(blocks(editor)).toEqual([]);
    expect(getMarkdown(editor)).toBe(page);
  });

  it('keeps an iframe the reader leaves unclosed as written, and the text after it editable', () => {
    const page = `<iframe src="https://www.youtube.com/embed/${YT}">\n\n## Install\n\nRun it.`;
    const editor = open(page);
    expect(blocks(editor)).toEqual([]);
    expect(editor.state.doc.textContent).toContain('Install');
    expect(getMarkdown(editor)).toBe(page);
  });

  it('leaves iframes in code as code', () => {
    const page = `\`\`\`html\n<iframe src="https://www.youtube.com/embed/${YT}"></iframe>\n\`\`\`\n\nUse \`<video src="a.mp4"></video>\` inline.`;
    const editor = open(page);
    expect(blocks(editor)).toEqual([]);
    expect(getMarkdown(editor)).toBe(page);
  });

  it('keeps an iframe that sits inside an unsupported component as part of its source', () => {
    const page = `<Widget>\n<iframe src="https://www.youtube.com/embed/${YT}"></iframe>\n</Widget>`;
    const editor = open(page);
    expect(blocks(editor)).toEqual([]);
    expect(getMarkdown(editor)).toBe(page);
  });

  it('opens a JSX expression value in the iframe without treating it as an expression block', () => {
    const page = `<iframe src="https://www.loom.com/embed/${LOOM}" title="Loom" style={{ width: "100%", height: 400 }} allowFullScreen></iframe>`;
    const editor = open(page);
    expect(values(editor)).toEqual([expect.objectContaining({ title: 'Loom' })]);
    expect(getMarkdown(editor)).toBe(page);
  });
});

/*
 * Council fixes for #567: each case was lost or rewritten on a3294ad2. Anything
 * the shared scanner doesn't read as one closed embed stays #573's opaque,
 * byte-for-byte block; nothing in code is ever replaced.
 */
const I = `<iframe src="https://www.youtube.com/embed/${YT}" title="Tour"></iframe>`;
/** Save, reopen, save again: the page comes back identical each time. */
const stable = (page: string) => {
  const saved = getMarkdown(open(page));
  expect(saved).toBe(page);
  expect(getMarkdown(open(saved))).toBe(page);
  return saved;
};
const nodeTypesAround = (editor: Editor, name: string): string[][] => {
  const chains: string[][] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== name) return;
    const $pos = editor.state.doc.resolve(pos);
    chains.push(Array.from({ length: $pos.depth }, (_, depth) => $pos.node(depth + 1).type.name));
  });
  return chains;
};
const codeTexts = (editor: Editor) => {
  const texts: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'codeBlock') texts.push(node.textContent);
  });
  return texts;
};

describe('council fix 1: media the shared scanner rejects is kept as written', () => {
  it.each([
    ['a "<" in an attribute value', `<iframe src="https://www.youtube.com/embed/${YT}" title="a < b"></iframe>`],
    ['an over-long tag', `<iframe src="https://www.youtube.com/embed/${YT}" title="${'x'.repeat(5000)}"></iframe>`],
    [
      'a video with a blank line before its <source>',
      '<video controls>\n\n<source src="https://cdn.example.com/a.mp4" type="video/mp4" />\nYour browser cannot play this video.\n</video>',
    ],
  ])('%s', (_name, embed) => {
    const page = `Intro.\n\n${embed}\n\nOutro.`;
    stable(page);
    expect(blocks(open(page))).toEqual([]);
  });
});

describe('council fix 2: iframes in code stay code', () => {
  it('keeps an indented iframe as indented code, with its text unchanged', () => {
    const editor = open(`Intro.\n\n    ${I}\n\nOutro.`);
    expect(blocks(editor)).toEqual([]);
    expect(codeTexts(editor)).toEqual([I]);
    const saved = getMarkdown(editor);
    expect(saved).toContain(I);
    expect(saved).not.toMatch(/nibleaf-|data-source/);
    expect(getMarkdown(open(saved))).toBe(saved);
  });

  it.each([
    ['a fence in a blockquote', `> \`\`\`html\n> ${I}\n> \`\`\``],
    ['a fence in a list item', `- Example:\n\n  \`\`\`html\n  ${I}\n  \`\`\``],
    ['a fence in an ordered list item', `1. Example:\n\n   \`\`\`html\n   ${I}\n   \`\`\``],
  ])('keeps %s as code, byte for byte', (_name, page) => {
    const editor = open(page);
    expect(blocks(editor)).toEqual([]);
    expect(codeTexts(editor)).toEqual([I]);
    stable(page);
  });
});

describe('council fix 3: an iframe in a raw HTML table keeps the table as written', () => {
  it('saves no editor markup, and saves the same again after reopening', () => {
    const page = `Intro.\n\n<table><tr><td>${I}</td></tr></table>\n\nOutro.`;
    const saved = stable(page);
    expect(saved).not.toMatch(/pl-mdx-opaque|nibleaf-|data-source/);
  });
});

describe('council fix 4: editing a title changes only that attribute', () => {
  const setTitle = (page: string, title: string) => {
    const editor = open(page);
    setAttributes(editor, 0, { title });
    return getMarkdown(editor);
  };

  it('ends an HTML value at its quote: a trailing backslash is part of the value', () => {
    const src = `https://www.youtube.com/embed/${YT}`;
    expect(setTitle(`<iframe src="${src}" title="Old\\" allowFullScreen></iframe>`, 'New')).toBe(
      `<iframe src="${src}" title="New" allowFullScreen></iframe>`,
    );
  });

  it('gives a value to a bare title, keeping the attributes after it', () => {
    const src = `https://www.youtube.com/embed/${YT}`;
    expect(setTitle(`<iframe title src="${src}" allowFullScreen></iframe>`, 'New')).toBe(`<iframe title="New" src="${src}" allowFullScreen></iframe>`);
  });

  it('keeps every attribute after the title as written', () => {
    const src = `https://www.youtube.com/embed/${YT}`;
    const after = ` width="560" style={{ border: 0 }} data-x='a"b' allowFullScreen`;
    expect(setTitle(`<iframe src="${src}" title="Old"${after}></iframe>`, 'R&D "tour"')).toBe(
      `<iframe src="${src}" title="R&amp;D &quot;tour&quot;"${after}></iframe>`,
    );
  });
});

describe('council fix 5: an embed in a list item stays in the list', () => {
  it('opens as the block inside the first item, and saves byte for byte', () => {
    const page = `- First\n\n  ${I}\n\n- Next`;
    const editor = open(page);
    expect(nodeTypesAround(editor, 'videoEmbed')).toEqual([['bulletList', 'listItem']]);
    stable(page);
  });
});
