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

/** Load and save gives `expected`; two more load/save cycles give the same bytes. */
const expectRoundTrip = (page: string, expected = page) => {
  const saved = getMarkdown(open(page));
  expect(saved).toBe(expected);
  const second = getMarkdown(open(saved));
  expect([second, getMarkdown(open(second))]).toEqual([saved, saved]);
};

/** The names of every node in the page as the editor loads it. */
const nodeTypes = (page: string) => {
  const names: string[] = [];
  open(page).state.doc.descendants((node) => {
    names.push(node.type.name);
  });
  return names;
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
    expect(nodeTypes(callout)).toContain('callout');
    expectRoundTrip(callout);
    expect(nodeTypes(reported)).not.toContain('mdxFrame');
  });

  it('never writes editor markup into a raw HTML table', () => {
    const saved = getMarkdown(open(`<table><tr><td>${I}</td></tr></table>`));
    expect(saved).not.toMatch(/pl-mdx-opaque|nibleaf-mdx|data-mdx-opaque/);
  });

  it('keeps a fenced block inside a blockquote as code, with no placeholder in it (JSX too)', () => {
    expectRoundTrip('> ```html\n> <Chart a="1" />\n> ```');
    expectRoundTrip(`> \`\`\`html\n> ${I}\n> \`\`\``);
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

// #574: a fence in a list item gained the item's indent on every save, until the
// third save turned it into text and the iframe in it was lost.
describe('code inside lists and blockquotes', () => {
  it.each([
    ['a list item', '- Item\n\n  ```html\n  <iframe src="x"></iframe>\n  ```'],
    ['a list item, with text after', '- Item\n\n  ```js\n  const a = 1;\n  ```\n\n- Next'],
    ['an ordered list item', '1. Step\n\n   ```sh\n   pnpm install\n   ```'],
    ['a nested list item', '- Outer\n\n  - Inner\n\n    ```js\n    const a = 1;\n    ```'],
    ['a blockquote', '> ```js\n> const a = 1;\n> ```'],
    ['a blockquote inside a list item', '- Item\n\n  > ```js\n  > const a = 1;\n  > ```'],
    ['a list item inside a blockquote', '> - Item\n>\n>   ```js\n>   const a = 1;\n>   ```'],
  ])('keeps a fence in %s byte for byte over three saves', (_name, page) => {
    expectRoundTrip(page);
  });

  // Containers nested in any order: each strips its own prefix, outermost first.
  const mixed: Array<[string, (code: string[]) => string]> = [
    ['a quote in a nested list item', (code) => `- Outer\n\n  - Inner\n\n${code.map((line) => `    > ${line}`).join('\n')}`],
    ['a list item in a quote in a list item', (code) => `- Outer\n\n  > - Inner\n  >\n${code.map((line) => `  >   ${line}`).join('\n')}`],
    ['a quote in a quote in a list item', (code) => `- Outer\n\n${code.map((line) => `  > > ${line}`).join('\n')}`],
    ['a quote in a list item in a quote', (code) => `> - Item\n>\n${code.map((line) => `>   > ${line}`).join('\n')}`],
    ['a quote in a list item in an ordered list item', (code) => `1. One\n\n   - Two\n\n${code.map((line) => `     > ${line}`).join('\n')}`],
  ];
  const fence = ['```html', '<iframe src="x"></iframe>', '```'];

  it.each(mixed)('keeps a fence in %s byte for byte over four saves', (_name, page) => {
    const source = page(fence);
    let saved = source;
    for (let cycle = 0; cycle < 4; cycle++) {
      saved = getMarkdown(open(saved));
      expect(saved).toBe(source);
    }
  });

  it.each(mixed)('keeps indented code in %s as code over four saves: saved fenced once, then unchanged', (_name, page) => {
    const source = page(['    <iframe src="x"></iframe>']);
    const fenced = page(['```', '<iframe src="x"></iframe>', '```']);
    let saved = source;
    for (let cycle = 0; cycle < 4; cycle++) {
      saved = getMarkdown(open(saved));
      expect(saved).toBe(fenced);
    }
  });

  // Tabs: CommonMark counts a tab up to the next multiple of four columns, and a tab
  // a container only partly uses (the space after `>`, a list item's indent) leaves
  // its other columns as spaces. The editor writes container prefixes as spaces,
  // as it always has, so each save gives the space form, with the code in its fence.
  const tabbed = (prefix: string, lines: string[]) => lines.map((line) => `${prefix}${line}`).join('\n');
  it.each([
    ['a quote in a list item indented with a tab', `- Item\n\n${tabbed('\t> ', fence)}`, `- Item\n\n${tabbed('  > ', fence)}`],
    ['a list item in a quote, a tab after the quote marker', `> - Item\n>\n${tabbed('>\t', fence)}`, `> - Item\n>\n${tabbed('>   ', fence)}`],
    ['a quote in a nested list item, tab-indented', `- Outer\n\n\t- Inner\n\n${tabbed('\t\t> ', fence)}`, mixed[0]?.[1](fence)],
    ['a list item in a quote in a list item, tabs and a partial tab', `- Outer\n\n\t> - Inner\n\t>\n${tabbed('\t>\t', fence)}`, mixed[1]?.[1](fence)],
    ['a quote in a quote in a list item, tabs and a partial tab', `- Outer\n\n${tabbed('\t>\t> ', fence)}`, mixed[2]?.[1](fence)],
    ['a quote in a list item in a quote, a partial tab', `> - Item\n>\n${tabbed('>\t> ', fence)}`, mixed[3]?.[1](fence)],
    ['a quote in a list item in an ordered list item, tabs and spaces', `1. One\n\n\t- Two\n\n${tabbed('\t  > ', fence)}`, mixed[4]?.[1](fence)],
  ])('keeps a fence in %s in its fence over four saves', (_name, source, saved) => {
    let markdown = source;
    for (let cycle = 0; cycle < 4; cycle++) {
      markdown = getMarkdown(open(markdown));
      expect(markdown).toBe(saved);
    }
    let code = '';
    open(markdown).state.doc.descendants((node) => {
      if (node.type.name === 'codeBlock') code = node.textContent;
    });
    expect(code).toBe('<iframe src="x"></iframe>');
  });

  it('keeps indented code in a list item as code with the same text over three saves', () => {
    // The editor saves every code block fenced; after that the page is stable.
    const page = '- Item\n\n      const a = 1;';
    const code = (markdown: string) => {
      let text = '';
      open(markdown).state.doc.descendants((node) => {
        if (node.type.name === 'codeBlock') text = node.textContent;
      });
      return text;
    };
    const first = getMarkdown(open(page));
    expect(first).toBe('- Item\n\n  ```\n  const a = 1;\n  ```');
    const second = getMarkdown(open(first));
    expect([second, getMarkdown(open(second))]).toEqual([first, first]);
    expect([code(page), code(first), code(second)]).toEqual(['const a = 1;', 'const a = 1;', 'const a = 1;']);
  });
});

describe('the council review of #573', () => {
  // 1. A `<!--` inside a quoted attribute is part of the value, not a comment.
  it('keeps an image whose alt holds "<!--" an image with that alt', () => {
    const page = 'Before.\n\n<img alt="<!-- note -->" src="https://x.test/a.png">\n\nAfter.';
    const alt = (markdown: string) => {
      let value: unknown;
      open(markdown).state.doc.descendants((node) => {
        if (node.type.name === 'image') value = node.attrs.alt;
      });
      return value;
    };
    expect(alt(page)).toBe('<!-- note -->');
    // The image's own serializer writes `<` in an attribute as `&lt;`, as on main
    // before #573: the same value, and stable from then on.
    const saved = 'Before.\n\n<img alt="&lt;!-- note --&gt;" src="https://x.test/a.png">\n\nAfter.';
    expectRoundTrip(page, saved);
    expect(alt(saved)).toBe('<!-- note -->');
  });

  it('keeps a Card whose title holds "<!--" a Card, closing tag included', () => {
    const page = 'Before.\n\n<Card title="<!-- note -->">\n\nBody\n\n</Card>\n\nAfter.';
    expect(nodeTypes(page)).toContain('mdxCard');
    expectRoundTrip(page);
  });

  // 3. Inline or block comes from the Markdown around the HTML, not from newlines in it.
  it('keeps a multi-line span inside a paragraph inline', () => {
    const page = 'Before <span>multi\nline</span> after.';
    expect(open(page).state.doc.childCount).toBe(1);
    expectRoundTrip(page);
  });

  it('keeps a multi-line span inside the link it was written in', () => {
    const page = 'See [a <span>multi\nline</span> b](https://x.test/) here.';
    const { doc } = open(page).state;
    let linked = false;
    doc.descendants((node) => {
      if (node.type.name === 'mdxOpaqueInline') linked = node.marks.some((mark) => mark.type.name === 'link');
    });
    expect(linked).toBe(true);
    expectRoundTrip(page);
  });

  // 6. An unterminated comment runs to the end of the page, as HTML reads it.
  it.each([
    ['at the start', '<!-- draft\n\nIntro.\n\nOutro.'],
    ['in the middle', 'Intro.\n\n<!-- draft\n\nOutro.'],
    ['at the end', 'Intro.\n\nOutro. <!-- draft'],
    ['inside a list', '- one\n- two <!-- draft\n- three'],
  ])('keeps an unterminated comment %s and everything after it', (_name, page) => {
    expectRoundTrip(page);
  });

  // 7. The editor's own markup is recognised from real attributes only.
  it.each([
    ['a div whose title mentions data-mdx', '<div title=" data-mdx=x">\n  Hello\n</div>'],
    ['an iframe with a data-mdx attribute', '<iframe data-mdx="something" src="https://x.test/e"></iframe>'],
    ['a div with data-mdx naming no component', '<div data-mdx="Nothing">\n  Hello\n</div>'],
    ['a span with data-mdx naming a block component', '<span data-mdx="Card">x</span>'],
  ])('keeps %s as written', (_name, form) => {
    expectRoundTrip(`Before.\n\n${form}\n\nAfter.`);
  });

  it("still reads the editor's own markup as its nodes", () => {
    expect(nodeTypes('<div data-mdx="Accordion" data-title="FAQ"><p>Body</p></div>')).toContain('mdxAccordion');
    expect(nodeTypes('<div data-callout="" data-variant="note"><p>Body</p></div>')).toContain('callout');
  });
});

// 5. Unknown HTML is kept by default; only what the editor writes back byte for
// byte is structured.
describe('every other HTML element', () => {
  it.each([
    ['<script>', '<script>window.a = "<b>";</script>'],
    ['<style>', '<style>.a { color: red; }</style>'],
    ['<template>', '<template><p>x</p></template>'],
    ['a custom element', '<my-widget foo="1"></my-widget>'],
    ['<hr>', '<hr>'],
    ['<button>', '<button type="button">Go</button>'],
    ['<p> holding a <kbd>', '<p>Press <kbd>K</kbd></p>'],
  ])('keeps a block %s byte for byte', (_name, form) => {
    expectRoundTrip(`Before.\n\n${form}\n\nAfter.`);
  });

  it.each([
    ['kbd', '<kbd>Ctrl</kbd>'],
    ['abbr', '<abbr title="HyperText">HTML</abbr>'],
    ['br', 'a<br>b'],
    ['s', '<s>old</s>'],
    ['del', '<del>old</del>'],
    ['ins', '<ins>new</ins>'],
    ['small', '<small>fine</small>'],
    ['q', '<q>quote</q>'],
    ['cite', '<cite>Book</cite>'],
    ['time', '<time datetime="2026-11-12">today</time>'],
    ['a custom element', '<my-chip>new</my-chip>'],
  ])('keeps an inline <%s> byte for byte', (_name, form) => {
    expectRoundTrip(`Press ${form} now.`);
  });

  // The HTML the editor takes as its own content (`<p><a href>…`) is structured, as
  // before, and saves as its Markdown form; pinned so it stays stable.
  it.each([
    ['<p align>', '<p align="center">Centered</p>', 'Centered'],
    ['<h2>', '<h2>Heading</h2>', '## Heading'],
    ['<ul>', '<ul>\n<li>one</li>\n</ul>', '- one'],
    ['<blockquote>', '<blockquote>Quoted</blockquote>', '> Quoted'],
    ['<pre>', '<pre>code</pre>', '```\ncode\n```'],
    ['<a>', '<a href="/x">link</a>', '[link](/x)'],
    ['<strong>', '<strong>bold</strong>', '**bold**'],
    ['<br> inside a <p>', '<p>a<br>b</p>', 'a\\\nb'],
  ])('still structures %s', (_name, form, saved) => {
    expectRoundTrip(`Before.\n\n${form}\n\nAfter.`, `Before.\n\n${saved}\n\nAfter.`);
  });

  it.each([
    ['sup', 'superscript'],
    ['sub', 'subscript'],
    ['mark', 'highlight'],
    ['u', 'underline'],
  ])('still structures <%s>, which the editor writes back byte for byte', (tag, mark) => {
    const page = `Press <${tag}>x</${tag}> now.`;
    let found = false;
    open(page).state.doc.descendants((node) => {
      if (node.marks.some((each) => each.type.name === mark)) found = true;
    });
    expect(found).toBe(true);
    expectRoundTrip(page);
  });
});
