// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * Raw HTML the editor has no node for (iframes, videos and the like) opens as an
 * opaque block, the way unknown MDX components do, and saves back byte for byte.
 * Before, the editor's HTML parser dropped it, and autosave wrote the page without it.
 */

const YT = 'M7lc1UVf-VE';
const LOOM = '0123456789abcdef0123456789abcdef';
const I = `<iframe src="https://www.youtube.com/embed/${YT}" title="Tour"></iframe>`;
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

/** Load and save gives `expected`; loading and saving that again gives the same bytes. */
const expectRoundTrip = (page: string, expected = page) => {
  const saved = getMarkdown(open(page));
  expect(saved).toBe(expected);
  expect(getMarkdown(open(saved))).toBe(saved);
};

/** Type a character after the second one of the page's first paragraph. */
const typeNearby = (editor: Editor) => {
  editor.commands.setTextSelection(3);
  editor.commands.insertContent('!');
};

const reported = `Intro.

<Frame caption="Tour">
  <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="Tour" allowFullScreen></iframe>
</Frame>

<video controls src="https://cdn.example.com/a.mp4"></video>

<iframe src="https://player.vimeo.com/video/76979871" title="V"></iframe>

Outro.`;

describe('raw video and iframe HTML', () => {
  it('keeps the reported page: a Frame around an iframe, a video and a Vimeo iframe', () => {
    expectRoundTrip(reported);
  });

  it('keeps every embed when the paragraph next to it is edited', () => {
    const editor = open(reported);
    typeNearby(editor);
    expect(getMarkdown(editor)).toBe(reported.replace('Intro.', 'In!tro.'));
  });

  it('gives the same bytes on every load and save', () => {
    const once = getMarkdown(open(reported));
    const twice = getMarkdown(open(once));
    const thrice = getMarkdown(open(twice));
    expect([once, twice, thrice]).toEqual([reported, reported, reported]);
  });

  // The storage forms of #567's Video and Embed block, which this keeps as written.
  it.each([
    ['YouTube', `<iframe src="https://www.youtube-nocookie.com/embed/${YT}" title="Product tour"></iframe>`],
    ['Vimeo', '<iframe src="https://player.vimeo.com/video/76979871#t=90s" title="Release notes"></iframe>'],
    ['Loom', `<iframe src="https://www.loom.com/embed/${LOOM}" title="Walkthrough"></iframe>`],
    ['Wistia', '<iframe src="https://fast.wistia.net/embed/iframe/abcde12345" title="Demo"></iframe>'],
    ['a video file', '<video controls src="https://cdn.example.com/demo.mp4"></video>'],
    [
      'a captioned Frame',
      `<Frame caption="The tour, start to finish">\n  <iframe src="https://www.youtube-nocookie.com/embed/${YT}?start=30" title="Product tour"></iframe>\n</Frame>`,
    ],
    ['an iframe with a character reference', '<iframe src="https://maps.example.com/embed?q=harbour&amp;z=4" title="Office map"></iframe>'],
    [
      'a video with source and track children',
      '<video controls poster="/api/public/assets/poster.png">\n  <source src="https://cdn.example.com/b.webm" type="video/webm" />\n  <track kind="captions" src="/captions/en.vtt" srclang="en" label="English" />\n</video>',
    ],
    [
      'a video with source, track and fallback text',
      '<video controls>\n  <source src="/a.mp4" type="video/mp4" />\n  <track kind="captions" src="/a.vtt" srclang="en" />\n  Your browser does not support video.\n</video>',
    ],
    [
      'a multi-line video',
      '<video\n  autoPlay\n  muted\n  loop\n  playsInline\n  className="w-full aspect-video rounded-xl"\n  src="https://cdn.example.com/demo.mp4"\n></video>',
    ],
    [
      'an iframe with unknown attributes and JSX expressions',
      `<iframe src="https://www.youtube.com/embed/${YT}" width={560} height={315} data-foo="bar" loading="lazy" style={{ width: "100%", height: 400 }} allowFullScreen></iframe>`,
    ],
  ])('keeps %s byte for byte, and when the text before it is edited', (_name, form) => {
    const page = `Watch this first.\n\n${form}\n\nThen read on.`;
    expectRoundTrip(page);
    const editor = open(page);
    typeNearby(editor);
    expect(getMarkdown(editor)).toBe(page.replace('Wa', 'Wa!'));
  });

  it("keeps Mintlify's documented page (#547's fixture) byte for byte", () => {
    const page = pageBody('mintlify-video-embeds.mdx');
    // The editor never writes a newline at the end of a page.
    expectRoundTrip(page, page.trimEnd());
  });

  it('keeps every embed of the page imported from Mintlify byte for byte', () => {
    const page = pageBody('mintlify-video-embeds.imported.mdx');
    // The rest of the page gets the editor's usual spacing, as on main: a blank
    // line after a heading, and no newline at the end.
    expectRoundTrip(page, page.replace('### Record a walkthrough\nShare', '### Record a walkthrough\n\nShare').trimEnd());
  });

  it('keeps an iframe left unclosed, and the text after it editable', () => {
    const page = `<iframe src="https://www.youtube.com/embed/${YT}">\n\n## Install\n\nRun it.`;
    const editor = open(page);
    expect(editor.state.doc.textContent).toContain('Install');
    expect(getMarkdown(editor)).toBe(page);
  });
});

describe('other raw HTML the editor has no node for', () => {
  // Each row was dropped or changed on main; see the PR's sweep table.
  it.each([
    ['<audio> with <source>', '<audio controls>\n  <source src="/a.mp3" type="audio/mpeg" />\n</audio>'],
    ['<object>', '<object data="/a.pdf" type="application/pdf" width="100%"></object>'],
    ['<embed>', '<embed src="/a.pdf" type="application/pdf" />'],
    ['<picture> with <source> and <img>', '<picture>\n  <source srcset="/a.webp" type="image/webp" />\n  <img src="/a.png" alt="A" />\n</picture>'],
    ['<details>/<summary>', '<details>\n<summary>More</summary>\n\nHidden **text**.\n\n</details>'],
    ['<svg>', '<svg width="10" height="10"><circle cx="5" cy="5" r="4" /></svg>'],
    ['<canvas>', '<canvas id="c" width="100"></canvas>'],
    ['<form> with <input>', '<form action="/s">\n  <input type="text" name="q" />\n</form>'],
    ['<div> with attributes', '<div className="grid" data-x="1">\n  Hello\n</div>'],
    ['an inline <span style="…">', 'A <span style="color: red">red</span> b.'],
    ['an inline <span style={…}>', 'A <span style={{ color: "red" }}>red</span> b.'],
    ['an HTML comment', '<!-- a comment with {braces} and <Chart /> -->'],
    ['an iframe in a line of text', `See ${I} here.`],
    ['Arabic text', '<iframe src="https://x.test/e" title="جولة"></iframe>\n\n<video controls src="/a.mp4">متصفحك لا يدعم الفيديو.</video>'],
  ])('keeps %s byte for byte', (_name, form) => {
    expectRoundTrip(`Before.\n\n${form}\n\nAfter.`);
  });

  // These already round-trip on main; pinned so they keep doing so.
  it.each([
    ['an unknown self-closing component', '<Widget foo="1" />'],
    ['an unknown component with children', '<Widget foo="1">\n  child **text**\n</Widget>'],
    ['an iframe inside an unknown component', `<Widget>\n${I}\n</Widget>`],
    ['an uppercase <IFRAME>', '<IFRAME SRC="https://x.test/e" TITLE="T"></IFRAME>'],
    ['an uppercase <VIDEO>', '<VIDEO controls src="/a.mp4"></VIDEO>'],
  ])('still keeps %s byte for byte', (_name, form) => {
    expectRoundTrip(`Before.\n\n${form}\n\nAfter.`);
  });

  it('keeps an iframe in a page with CRLF line endings, which saves with LF as before', () => {
    expectRoundTrip(`Before.\r\n\r\n${I}\r\n\r\nAfter.`, `Before.\n\n${I}\n\nAfter.`);
  });

  it('still opens a raw HTML <table> as a table: saved in the editor form once, then stable', () => {
    const saved = '<table><tbody><tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table>';
    expectRoundTrip('<table>\n  <tr><td>1</td><td>2</td></tr>\n</table>', saved);
  });
});

describe('scanner edge cases', () => {
  it.each([
    ['a "<" inside a quoted attribute', `<iframe src="https://www.youtube.com/embed/${YT}" title="a < b"></iframe>`],
    ['a 5 KB src and a long style', `<iframe src="https://x.test/e?${'a'.repeat(5000)}" style="${'color: red; '.repeat(300)}"></iframe>`],
    [
      'a <video> with a blank line before <source>',
      '<video controls>\n\n<source src="/a.mp4" type="video/mp4" />\n<track kind="captions" src="/a.vtt" />\nYour browser does not support video.\n</video>',
    ],
    // HTML has no backslash escapes: the title ends at the quote after `Old\`.
    ['a backslash before a closing quote', `<iframe src="https://www.youtube.com/embed/${YT}" title="Old\\" allowFullScreen></iframe>`],
  ])('keeps %s byte for byte', (_name, form) => {
    expectRoundTrip(`Before.\n\n${form}\n\nAfter.`);
  });
});

describe('raw HTML inside containers', () => {
  it.each([
    ['a list item, inline', `- one\n- ${I}\n- three`],
    ['a list item, as its own block', `- First\n\n  ${I}\n\n- Next`],
    ['a callout', `<Callout type="info">\n\n${I}\n\n</Callout>`],
    ['a tab', '<Tabs>\n\n<Tab title="A">\n\n<video controls src="/a.mp4"></video>\n\n</Tab>\n\n</Tabs>'],
    ['a blockquote', `> Quote\n>\n> ${I}`],
    ['a raw HTML table cell', `<table><tr><td>${I}</td></tr></table>`],
  ])('keeps an iframe or video in %s byte for byte', (_name, page) => {
    expectRoundTrip(page);
  });

  it('keeps a list item holding an iframe one list, with the iframe indented under it', () => {
    const { doc } = open(`- First\n\n  ${I}\n\n- Next`).state;
    const lists = doc.content.content.filter((node) => node.type.name === 'bulletList');
    expect(lists).toHaveLength(1);
    expect(lists[0]?.childCount).toBe(2);
    expect(lists[0]?.firstChild?.lastChild?.attrs.source).toBe(I);
  });

  it('keeps a component editable around inline raw HTML, and a Frame around an indented iframe whole', () => {
    const callout = '<Callout type="info">\n\nSome <span style="color: red">red</span> text.\n\n</Callout>';
    const types = (page: string) => {
      const names: string[] = [];
      open(page).state.doc.descendants((node) => {
        names.push(node.type.name);
      });
      return names;
    };
    expect(types(callout)).toContain('callout');
    expectRoundTrip(callout);
    expect(types(reported)).not.toContain('mdxFrame');
  });

  it('never writes editor markup into a raw HTML table', () => {
    const saved = getMarkdown(open(`<table><tr><td>${I}</td></tr></table>`));
    expect(saved).not.toMatch(/pl-mdx-opaque|nibleaf-mdx|data-mdx-opaque/);
  });

  it('keeps a fenced block inside a blockquote as code, with no placeholder in it (JSX too)', () => {
    expectRoundTrip('> ```html\n> <Chart a="1" />\n> ```');
    expectRoundTrip(`> \`\`\`html\n> ${I}\n> \`\`\``);
  });

  it('keeps a fenced block inside a list item as code with its text unchanged', () => {
    // As on main, the editor re-indents a fence in a list item on each save (any
    // language, not only HTML); the code's text is kept and nothing is replaced in it.
    const editor = open(`- Item\n\n  \`\`\`html\n  ${I}\n  \`\`\``);
    expect(getMarkdown(editor)).toBe(`- Item\n\n    \`\`\`html\n  ${I}\n    \`\`\``);
    let code = '';
    open(getMarkdown(editor)).state.doc.descendants((node) => {
      if (node.type.name === 'codeBlock') code = node.textContent;
    });
    expect(code).toBe(I);
  });

  it('keeps an indented iframe as a code block with its text unchanged', () => {
    // As on main, the editor saves every code block fenced.
    const editor = open(`Before.\n\n    ${I}\n\nAfter.`);
    expect(editor.state.doc.child(1).type.name).toBe('codeBlock');
    expect(editor.state.doc.child(1).textContent).toBe(I);
    expectRoundTrip(`Before.\n\n    ${I}\n\nAfter.`, `Before.\n\n\`\`\`\n${I}\n\`\`\`\n\nAfter.`);
  });

  it('keeps fenced and inline code as code', () => {
    expectRoundTrip(`\`\`\`html\n${I}\n\`\`\`\n\nUse \`<video src="a.mp4"></video>\` inline.`);
  });
});
