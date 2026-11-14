// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * Pages that grew, or changed, every time they were opened, edited and saved:
 *  - an unclosed code fence gained a copy of its last line (#602);
 *  - a `<Step>` holding a fence indented four columns had that fence wrapped in
 *    another fence, then gained a run of `</Step>`/`</Steps>` closers (#603);
 *  - a `<Frame caption="Old\">` lost its Frame (#579);
 *  - an unterminated `<script>`, `<style>`, `<textarea>` or `<title>` had its
 *    body rewritten as Markdown (#576).
 * Each saves back byte for byte, ten times over: within one session (one load,
 * ten saves, a character typed before the block between saves) and across
 * reloads (load, save, reload). In English and Arabic.
 */

const CYCLES = 10;
const T = '```';

interface Locale {
  name: string;
  before: string;
  after: string;
  item: string;
  next: string;
  text: string;
}

const LOCALES: readonly Locale[] = [
  { name: 'EN', before: 'Intro.', after: 'Outro.', item: 'Item', next: 'Next', text: 'Install it:' },
  { name: 'AR', before: 'مقدمة الصفحة.', after: 'خاتمة الصفحة.', item: 'عنصر', next: 'التالي', text: 'ثبّته أولاً:' },
];

/** A block, and whether prose may come before it and after it on the page. */
interface Variant {
  name: string;
  block: (locale: Locale) => string;
  /** Prose before the block (the place the session test types into). */
  before?: boolean;
  /** Prose after the block. A block that runs to the end of the page has none. */
  after?: boolean;
}

const page = (variant: Variant, locale: Locale): string =>
  [variant.before === false ? '' : `${locale.before}\n\n`, variant.block(locale), variant.after ? `\n\n${locale.after}` : ''].join('');

const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
afterAll(() => editor.destroy());
const load = (markdown: string) => editor.commands.setContent(markdown, { emitUpdate: false });

/** Load, save and reload `source` ten times: every save gives the page back as written. */
function expectStableAcrossReloads(source: string): void {
  let saved = source;
  for (let cycle = 0; cycle < CYCLES; cycle++) {
    load(saved);
    saved = getMarkdown(editor);
    expect({ cycle, saved }).toEqual({ cycle, saved: source });
  }
}

/** One load, then ten saves. Between saves a character is typed at the end of the
 *  page's first paragraph, when the page starts with one: the save is the page with
 *  only that character added, each time. */
function expectStableInOneSession(source: string, before: string | undefined): void {
  load(source);
  const first = editor.state.doc.firstChild;
  const typing = before !== undefined && first?.type.name === 'paragraph' && first.textContent === before && source.startsWith(before);
  for (let cycle = 0; cycle < CYCLES; cycle++) {
    if (typing && cycle > 0) editor.view.dispatch(editor.state.tr.insertText('x', 1 + before.length + cycle - 1));
    const expected = typing ? `${before}${'x'.repeat(cycle)}${source.slice(before.length)}` : source;
    expect({ cycle, saved: getMarkdown(editor) }).toEqual({ cycle, saved: expected });
  }
  if (before !== undefined) expect(typing).toBe(true);
}

function describeVariants(title: string, variants: readonly Variant[]): void {
  describe(title, () => {
    for (const locale of LOCALES)
      for (const variant of variants) {
        const source = page(variant, locale);
        const before = variant.before === false ? undefined : locale.before;
        it(`${variant.name} (${locale.name}): the first save is the page as written`, () => {
          load(source);
          expect(getMarkdown(editor)).toBe(source);
        });
        it(`${variant.name} (${locale.name}): ${CYCLES} saves in one session`, () => expectStableInOneSession(source, before));
        it(`${variant.name} (${locale.name}): ${CYCLES} reloads`, () => expectStableAcrossReloads(source));
      }
  });
}

describeVariants('an unclosed code fence (#602)', [
  { name: 'the issue’s repro', block: () => `${T}js\na\nb` },
  { name: 'with a trailing newline', block: () => `${T}js\na\nb\n` },
  { name: 'a page that is only a fence', block: () => `${T}\na\nb`, before: false },
  { name: 'a page that is only a fence, with a trailing newline', block: () => `${T}\na\nb\n`, before: false },
  { name: 'only an opening line', block: () => `${T}js` },
  { name: 'trailing blank lines', block: () => `${T}js\na\n\n\n` },
  { name: 'a tilde fence', block: () => '~~~py\na\nb' },
  { name: 'a longer opener with a shorter closer, which is code', block: () => `${T}\`js\na\n${T}` },
  { name: 'a longer tilde opener with a shorter closer', block: () => '~~~~py\na\n~~~\nb' },
  { name: 'in a list item, before the next item', block: (l) => `- ${T}js\n  a\n  b\n- ${l.next}`, after: true },
  { name: 'in a list item’s continuation, at the end of the page', block: (l) => `- ${l.item}\n\n  ${T}js\n  a\n  b` },
  { name: 'in a nested list item', block: (l) => `- ${l.item}\n\n  - ${T}js\n    a\n  - ${l.next}`, after: true },
  { name: 'in a quote', block: () => `> ${T}js\n> a\n> b`, after: true },
  { name: 'in a quote, at the end of the page', block: () => `> ${T}js\n> a\n> b` },
  { name: 'in a list item in a quote', block: (l) => `> - ${T}js\n>   a\n> - ${l.next}`, after: true },
  { name: 'in a `<Step>`, holding its closing tag', block: () => `<Step title="One">\n\n${T}js\na\n\n</Step>` },
  { name: 'in a `<Steps>`, holding its closing tags', block: () => `<Steps>\n<Step title="One">\n\n${T}js\na\n\n</Step>\n</Steps>` },
]);

const INDENTED = `    ${T}js\n    const a = 1;\n    ${T}`;

describeVariants('a fence indented four columns in a `<Step>` (#603)', [
  { name: 'the issue’s repro', block: () => `<Steps>\n<Step title="One">\n\n${INDENTED}\n\n</Step>\n</Steps>`, after: true },
  { name: 'indented tags', block: () => `<Steps>\n  <Step title="One">\n\n${INDENTED}\n\n  </Step>\n</Steps>`, after: true },
  { name: 'blank lines between the tags', block: () => `<Steps>\n\n<Step title="One">\n\n${INDENTED}\n\n</Step>\n\n</Steps>`, after: true },
  { name: 'text before the fence', block: (l) => `<Steps>\n<Step title="One">\n\n${l.text}\n\n${INDENTED}\n\n</Step>\n</Steps>`, after: true },
  {
    name: 'a second Step after it',
    block: (l) => `<Steps>\n<Step title="One">\n\n${INDENTED}\n\n</Step>\n<Step title="Two">\n\n${l.text}\n\n</Step>\n</Steps>`,
    after: true,
  },
  { name: 'a bare Step', block: () => `<Step title="One">\n\n${INDENTED}\n\n</Step>`, after: true },
  {
    name: 'text straight before the fence',
    block: (l) => `<Steps>\n\n<Step title="One">\n\n${l.text}\n${INDENTED}\n\n</Step>\n\n</Steps>`,
    after: true,
  },
  { name: 'in a Note', block: () => `<Note>\n\n${INDENTED}\n\n</Note>`, after: true },
  // No blank line between the tag (or text) and the fence: the issue saw these
  // collapse into one escaped paragraph. They already save as written on main.
  { name: 'no blank line after the tag', block: () => `<Step title="One">\n${INDENTED}\n</Step>`, after: true },
  { name: 'no blank line after text', block: (l) => `<Step title="One">\n${l.text}\n${INDENTED}\n</Step>`, after: true },
  { name: 'no blank line after the tag, in Steps', block: () => `<Steps>\n<Step title="One">\n${INDENTED}\n</Step>\n</Steps>`, after: true },
]);

const IFRAME = '<iframe src="https://www.youtube.com/embed/M7lc1UVf-VE" title="Tour"></iframe>';

describeVariants('a Frame caption ending in a backslash (#579)', [
  { name: 'the issue’s repro', block: () => `<Frame caption="Old\\" data-lightbox>\n  ${IFRAME}\n</Frame>`, after: true },
  { name: 'single quotes', block: () => `<Frame caption='Old\\' data-lightbox>\n  ${IFRAME}\n</Frame>`, after: true },
  // A Frame holding an image is the editor's own Frame node, which writes its child
  // between blank lines (as for any caption), so this is that layout.
  { name: 'an image inside', block: () => `<Frame caption="Old\\" data-lightbox>\n\n<img src="/a.png" alt="A" />\n\n</Frame>`, after: true },
  { name: 'a JSX caption, which keeps its escapes', block: () => `<Frame caption={"Say \\"hi\\""}>\n  ${IFRAME}\n</Frame>`, after: true },
]);

describe('a Frame caption ending in a backslash, read (#579)', () => {
  const captions = () => {
    const found: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'videoEmbed') found.push(String(node.attrs.caption));
    });
    return found;
  };
  it('reads the caption up to its closing quote, as HTML and MDX do', () => {
    load(`<Frame caption="Old\\" data-lightbox>\n  ${IFRAME}\n</Frame>`);
    expect(captions()).toEqual(['Old\\']);
  });
  it('keeps the Frame, its caption and its other attribute around an indented image', () => {
    load(`Intro.\n\n<Frame caption="Old\\" data-lightbox>\n  <img src="/a.png" alt="A" />\n</Frame>\n\nOutro.`);
    expect(getMarkdown(editor)).toBe(`Intro.\n\n<Frame caption="Old\\" data-lightbox>\n\n<img src="/a.png" alt="A" />\n\n</Frame>\n\nOutro.`);
  });
  it('still reads a JSX caption', () => {
    load(`<Frame caption={"Say hi"}>\n  ${IFRAME}\n</Frame>`);
    expect(editor.state.doc.firstChild?.type.name).toBe('mdxOpaqueBlock');
  });
});

const BODY = 'const s = "<b>KEEP</b>"; // **not bold**\n# not a heading\n<!-- not a comment';

describeVariants(
  'an unterminated raw-text element (#576)',
  ['script', 'style', 'textarea', 'title'].flatMap((tag): Variant[] => [
    { name: `<${tag}> at the start of the page`, block: () => `<${tag}>${BODY}`, before: false },
    { name: `<${tag}> in the middle of the page`, block: (l) => `<${tag}>${BODY}\n\n${l.after}\n\n## ${l.next}` },
    { name: `<${tag}> at the end of the page`, block: () => `<${tag}>${BODY}\n` },
    { name: `<${tag}> in a list item`, block: (l) => `- ${l.item}\n\n  <${tag}>${BODY}\n\n- ${l.next}` },
  ]),
);

describe('an unterminated raw-text element, read (#576)', () => {
  it.each(['script', 'style', 'textarea', 'title'])('keeps <%s> and everything after it as one block', (tag) => {
    const source = `Intro.\n\n<${tag}>${BODY}\n\n- item`;
    load(source);
    const blocks: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'mdxOpaqueBlock') blocks.push(String(node.attrs.source));
    });
    expect(blocks).toEqual([source.slice('Intro.\n\n'.length)]);
  });

  // In indented code a `<script>` is code: the components after it are still read.
  it.each(['script', 'style', 'textarea', 'title'])('reads the page after an unclosed <%s> in indented code', (tag) => {
    const source = `Intro.\n\n    <${tag}>example\n\n<Note>\n\nText\n\n</Note>`;
    load(source);
    // The editor adds an empty paragraph after a last block that isn't one.
    const names: string[] = [];
    editor.state.doc.forEach((node) => {
      names.push(node.type.name);
    });
    expect(names).toEqual(['paragraph', 'codeBlock', 'callout', 'paragraph']);
    expect(getMarkdown(editor)).toBe(`Intro.\n\n${T}\n<${tag}>example\n${T}\n\n<Note>\n\nText\n\n</Note>`);
  });
});

const NOTE = '<Note>\n\nEditable.\n\n</Note>';
const RAW_TEXT_TAGS = ['script', 'style', 'textarea', 'title'] as const;

/** The callouts on the page and their text, and the opaque blocks' sources. */
const structure = () => {
  const callouts: string[] = [];
  const opaque: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'callout') callouts.push(node.textContent);
    if (node.type.name === 'mdxOpaqueBlock' || node.type.name === 'mdxOpaqueInline') opaque.push(String(node.attrs.source));
  });
  return { callouts, opaque };
};

describe('a raw-text tag that Markdown reads as text (#622 review)', () => {
  // A backslash before `<` escapes it (CommonMark, as markdown-it reads it): the tag
  // is literal text and starts no raw text, so the Note after it stays editable.
  // The `\<tag>` itself still saves as an escaped placeholder
  // (`&lt;nibleaf-mdx-opaque-inline …&gt;`), as on main: a separate follow-up, so
  // only the page from the text after it is compared byte for byte.
  it.each(RAW_TEXT_TAGS)('an escaped \\<%s> leaves the page after it editable', (tag) => {
    const source = `Intro with \\<${tag}>literal.\n\n${NOTE}`;
    load(source);
    expect(structure().callouts).toEqual(['Editable.']);
    const saved = getMarkdown(editor);
    const tail = source.slice(source.indexOf('literal.'));
    expect(saved.startsWith('Intro with ') && saved.endsWith(tail)).toBe(true);
    load(saved);
    expect(getMarkdown(editor)).toBe(saved);
    expect(structure().callouts).toEqual(['Editable.']);
  });

  // In inline code the tag is code: guarded since #573's code mask.
  it.each(RAW_TEXT_TAGS)('<%s> in inline code leaves the page after it editable', (tag) => {
    const source = `Intro with \`<${tag}>\` literal.\n\n${NOTE}`;
    expectStableAcrossReloads(source);
    expect(structure().callouts).toEqual(['Editable.']);
  });

  // Two backslashes are an escaped backslash, then a real tag (markdown-it reads
  // `\\<title>` as `\` and inline HTML): its text runs to the end of the page.
  it.each(RAW_TEXT_TAGS)('<%s> after an escaped backslash is raw text through the end of the page', (tag) => {
    const source = `Intro with \\\\<${tag}>literal.\n\n${NOTE}`;
    expectStableAcrossReloads(source);
    expect(structure()).toEqual({ callouts: [], opaque: [source.slice(source.indexOf(`<${tag}>`))] });
  });
});

describe('a component whose opening tag JSX reads with text left over (#622 review)', () => {
  // `title="a \"b\" c"`: JSX strings have no escapes, so the value ends at the
  // second quote and `b\" c"` is left over. The component is kept whole, with no
  // field to edit, so an edit can't leave `title="Edited"b\" c"` behind.
  const tags = [
    ['Card', 'title'],
    ['Step', 'title'],
    ['Accordion', 'title'],
    ['Frame', 'caption'],
  ] as const;
  const component = (tag: string, key: string) => `${String.raw`<${tag} ${key}="a \"b\" c">`}\n\nBody\n\n</${tag}>`;

  it.each(tags)('keeps <%s> as written over ten reloads', (tag, key) => {
    expectStableAcrossReloads(`Intro.\n\n${component(tag, key)}`);
  });

  it.each(tags)('offers no %s field to edit, and an edit elsewhere leaves it as written', (tag, key) => {
    const source = `Intro.\n\n${component(tag, key)}`;
    load(source);
    const editable: string[] = [];
    editor.state.doc.descendants((node) => {
      if (key in node.attrs) editable.push(node.type.name);
    });
    expect(editable).toEqual([]);
    expect(structure().opaque).toEqual([component(tag, key)]);
    expectStableInOneSession(source, 'Intro.');
  });

  it('offers no caption field on a Frame around an embed', () => {
    const frame = `${String.raw`<Frame caption="a \"b\" c">`}\n  ${IFRAME}\n</Frame>`;
    expectStableAcrossReloads(`Intro.\n\n${frame}`);
    expect(structure().opaque).toEqual([frame]);
  });
});
