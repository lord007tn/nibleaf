// @vitest-environment jsdom
import { STARTER_PAGE_CONTENTS } from '@nibleaf/auth/starter-content';
import { DOCUMENTATION_COMPONENTS } from '@nibleaf/shared/documentation-components';
import { Editor } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';
import { HARD_WRAPPED_AR, HARD_WRAPPED_EN, IMPORTED_INTRODUCTION, IMPORTED_QUICKSTART } from './__fixtures__/hard-wrapped-pages';
import { markdownToEmit } from './editor-change-origin';
import { SUPPORTED_MDX_COMPONENTS } from './extensions/mdx-roundtrip';
import { buildEditorExtensions, getMarkdown, seedMarkdown } from './tiptap-editor';

/*
 * #702: a page written with CRLF line endings (or a mix of CRLF, LF and lone CR)
 * saves with the endings it was written with. Every page here is first checked
 * to save byte for byte with LF, so a failure below is about line endings only.
 */

const CRLF = (page: string) => page.replaceAll('\n', '\r\n');
const CR = (page: string) => page.replaceAll('\n', '\r');

/** `page` with each line ending picked from CRLF, LF and (with `withCr`) CR by a
 *  seeded generator. A CR right before an LF would read as one CRLF, not two
 *  endings (a blank line lost), so an empty line after a CR never ends in LF. */
function mixed(page: string, seed: number, withCr = false): string {
  let state = seed >>> 0 || 1;
  const endings = withCr ? ['\r\n', '\n', '\r'] : ['\r\n', '\n'];
  let previous = { at: -2, ending: '' };
  return page.replace(/\n/g, (_match, at: number) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    let ending = endings[(state >>> 0) % endings.length] as string;
    if (ending === '\n' && previous.at === at - 1 && previous.ending === '\r') ending = '\r\n';
    previous = { at, ending };
    return ending;
  });
}

const PAGES: ReadonlyArray<readonly [name: string, page: string]> = [
  ['prose', '# Title\n\nA paragraph with **bold**, `code` and a [link](/x).\n\n## Section\n\nSecond paragraph.'],
  [
    'hard-wrapped paragraphs',
    'A paragraph wrapped by hand, with **bold**\nat the end of a line and a [link](/a)\nbefore the last one.\n\nAnother one\nwrapped.',
  ],
  ['a hard break', 'Line one\\\nline two\\\nline three.'],
  ['a backtick fence', 'Intro.\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nOutro.'],
  ['a tilde fence', 'Intro.\n\n~~~python title="x.py"\nprint(1)\n~~~\n\nOutro.'],
  ['a fence in a quote', '> Quoted.\n>\n> ```js\n> const a = 1;\n> ```'],
  ['a fence in a list item', '- Item\n\n  ```js\n  const a = 1;\n  ```\n\n- Next'],
  ['a fence on its list item’s first line', '- ```js\n  const a = 1;\n  ```\n- Next'],
  ['a fence in a component', '<Note>\n\n~~~sh\nnpm install\n~~~\n\n</Note>'],
  ['an unclosed fence at the end', 'Intro.\n\n```js\nconst a = 1;'],
  ['a table', '| Name | Value |\n| --- | :---: |\n| a | 1 |\n| b | 2 |\n\nAfter.'],
  ['lists', '- one\n- two\n  - nested\n  - wrapped\n    item\n\n1. first\n2. second'],
  // Loose: a tight task list gains a blank line on save even with LF (not a line-ending matter).
  ['a task list', 'Intro.\n\n- [ ] todo\n\n- [x] done\n\nOutro.'],
  ['a quote', '> Quoted text\n> wrapped on two lines.\n>\n> A second paragraph.'],
  ['headings, rule and image', '# One\n\n---\n\n![Diagram](/diagram.png)\n\n### Three'],
  ['raw HTML', '<div class="note">\n  <b>Bold</b>\n</div>\n\nText.'],
  ['an iframe', 'Intro.\n\n<iframe src="https://www.youtube.com/embed/M7lc1UVf-VE" title="Tour"></iframe>\n\nOutro.'],
  ['a multiline opener', 'Intro.\n\n<Card\n  title="A card"\n  href="/x"\n>\n\nBody.\n\n</Card>\n\nOutro.'],
  ['nested components', '<Tabs>\n\n<Tab title="One">\n\n<Steps>\n\n<Step title="Step">\n\nDo it\nnow.\n\n</Step>\n\n</Steps>\n\n</Tab>\n\n</Tabs>'],
  ['the hard-wrapped English page', HARD_WRAPPED_EN.trimEnd()],
  ['the hard-wrapped Arabic page', HARD_WRAPPED_AR.trimEnd()],
  ['the imported Introduction page', IMPORTED_INTRODUCTION.trimEnd()],
  ['the imported Quickstart page', IMPORTED_QUICKSTART.trimEnd()],
  ...STARTER_PAGE_CONTENTS.map(({ title, content }) => [`starter page "${title}"`, content.trimEnd()] as const),
];

/** Multiline attribute values in each form the editor reads. */
const MULTILINE_VALUES = ['"Line one\nline two"', "'Line one\nline two'", '{"Line one\\nline two"}', '{`Line one\nline two`}'] as const;

const childrenOf = new Map<string | undefined, readonly string[]>(
  DOCUMENTATION_COMPONENTS.map((component) => [component.tag, component.allowedChildren ?? []]),
);

/** The ways a component is written, tried in order: the first that saves byte for byte with LF is used. */
function componentForms(tag: string, key: string, value: string, inline: boolean): string[] {
  const child = childrenOf.get(tag)?.at(-1);
  const body = !child
    ? '\n\nBody text\nwrapped.\n\n'
    : child === 'File'
      ? '\n\n<File name="child.ts" />\n\n'
      : `\n\n<${child} title="Child">\n\nText.\n\n</${child}>\n\n`;
  const open = `<${tag} ${key}=${value}`;
  if (inline) return [`Intro ${open} /> end.\n\nOutro.`, `Intro ${open}>x</${tag}> end.\n\nOutro.`];
  return [`Intro.\n\n${open}>${body}</${tag}>\n\nOutro.`, `Intro.\n\n${open} />\n\nOutro.`];
}

describe('CRLF pages save byte for byte (#702)', () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  afterAll(() => editor.destroy());
  const save = (page: string) => {
    editor.commands.setContent(page, { emitUpdate: false });
    return getMarkdown(editor);
  };

  /** Load and save three times, each from the last save: always `page`. */
  const expectThreeCycles = (page: string) => {
    let saved = page;
    for (let cycle = 1; cycle <= 3; cycle++) {
      saved = save(saved);
      expect({ cycle, saved }).toEqual({ cycle, saved: page });
    }
  };

  const componentPages = Object.values(SUPPORTED_MDX_COMPONENTS).flatMap((definition) =>
    MULTILINE_VALUES.map((value) => {
      const key = definition.attrs[0] ?? 'title';
      const forms = componentForms(definition.canonical, key, value, Boolean(definition.inline));
      return [`<${definition.canonical} ${key}=${value.slice(0, 2)}…>`, forms] as const;
    }),
  );

  it('covers every component in the registry', () => {
    const registry = DOCUMENTATION_COMPONENTS.flatMap((component) => (component.tag ? [component.tag] : []));
    expect(new Set(componentPages.map(([name]) => name.slice(1, name.indexOf(' '))))).toEqual(new Set(registry));
  });

  it.each(PAGES)('%s, CRLF: 3 load → save cycles, byte for byte', (_name, page) => {
    expect(save(page)).toBe(page);
    expectThreeCycles(CRLF(page));
  });

  it.each(componentPages)('%s with a multiline value, CRLF: 3 cycles, byte for byte', (_name, forms) => {
    const page = forms.find((form) => save(form) === form);
    expect(page, 'a form that saves byte for byte with LF').toBeDefined();
    expectThreeCycles(CRLF(page as string));
  });

  it.each(PAGES)('%s, mixed CRLF/LF: each line keeps its own ending', (_name, page) => {
    for (const seed of [1, 2, 3]) expectThreeCycles(mixed(page, seed * 0x9e_37_79_b9));
  });

  it.each(PAGES)('%s, lone CR (alone and mixed with CRLF and LF): kept as written', (_name, page) => {
    expectThreeCycles(CR(page));
    expectThreeCycles(mixed(page, 0x51_ed_27, true));
  });

  it('loads and saves a CRLF page the same through every way a page is set', () => {
    const page = CRLF(HARD_WRAPPED_EN.trimEnd());
    const created = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions(), content: page });
    try {
      expect(getMarkdown(created)).toBe(page);
      seedMarkdown(created, CRLF('# Other\n\nText\nwrapped.'));
      expect(getMarkdown(created)).toBe(CRLF('# Other\n\nText\nwrapped.'));
      // A page set as anything but Markdown has no line endings to keep.
      created.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'JSON' }] }] });
      expect(getMarkdown(created)).toBe('JSON');
      seedMarkdown(created, '');
      expect(getMarkdown(created)).toBe('');
    } finally {
      created.destroy();
    }
  });

  it('reads a CRLF page as the same document as its LF form', () => {
    for (const [, page] of PAGES) {
      editor.commands.setContent(page, { emitUpdate: false });
      const lf = editor.state.doc.toJSON();
      editor.commands.setContent(CRLF(page), { emitUpdate: false });
      expect(editor.state.doc.toJSON()).toEqual(lf);
      expect(JSON.stringify(lf)).not.toContain('\\r');
    }
  });
});

describe('an edit to a CRLF page keeps its line endings (#702)', () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  afterAll(() => editor.destroy());

  /** Load `source`, replace the first `word` as typing does, and emit the page as the editor does. */
  const edit = (source: string, ...replacements: Array<[word: string, replacement: string]>) => {
    seedMarkdown(editor, source);
    const loaded = { source, serialized: getMarkdown(editor) };
    for (const [word, replacement] of replacements) {
      let from = -1;
      editor.state.doc.descendants((node, pos) => {
        if (from >= 0) return false;
        const index = node.isText ? (node.text ?? '').indexOf(word) : -1;
        if (index >= 0) from = pos + index;
        return from < 0;
      });
      if (from < 0) throw new Error(`No ${word} in the page`);
      editor.view.dispatch(editor.state.tr.insertText(replacement, from, from + word.length));
    }
    return markdownToEmit(loaded, getMarkdown(editor));
  };

  it('a word changed in a one-line paragraph: only that word differs, CRLF everywhere', () => {
    const source = CRLF(HARD_WRAPPED_EN);
    expect(edit(source, ['A short item.', 'A tiny item.'])).toBe(source.replaceAll('A short item.', 'A tiny item.'));
  });

  it('a word changed in a wrapped paragraph: that paragraph is re-wrapped with CRLF after it, the rest byte for byte', () => {
    const source = CRLF(HARD_WRAPPED_EN);
    const before = CRLF('Install the package with your package manager of choice. The command below uses\nnpm.');
    const after = 'Install the package with your package manager of choice. The command below uses pnpm.';
    expect(edit(source, ['npm.', 'pnpm.'])).toBe(source.replace(before, after));
  });

  it('a page loaded with a last CRLF ends with one after an edit', () => {
    const source = CRLF('# Title\n\nText.\n');
    expect(edit(source, ['Text.', 'Edited.'])).toBe(CRLF('# Title\n\nEdited.\n'));
    expect(edit(CR('# Title\n\nText.\n'), ['Text.', 'Edited.'])).toBe(CR('# Title\n\nEdited.\n'));
  });

  it('a mixed page: edits far apart keep every other line’s own ending, and the edited lines take the most common one', () => {
    const page = HARD_WRAPPED_EN.trimEnd();
    const source = mixed(page, 0x70_2a);
    const saved = edit(source, ['A short item.', 'A tiny item.'], ['Another short item.', 'Another tiny item.']);
    expect(saved.replaceAll('\r\n', '\n')).toBe(page.replace('A short item.', 'A tiny item.').replace('Another short item.', 'Another tiny item.'));
    const sourceLines = source.split(/(?<=\n)/);
    const savedLines = saved.split(/(?<=\n)/);
    expect(savedLines).toHaveLength(sourceLines.length);
    const crlf = sourceLines.filter((line) => line.endsWith('\r\n')).length;
    const dominant = crlf * 2 >= sourceLines.length - 1 ? '\r\n' : '\n';
    for (const [index, line] of savedLines.entries()) {
      const original = sourceLines[index] as string;
      const ending = (text: string) => (text.endsWith('\r\n') ? '\r\n' : text.endsWith('\n') ? '\n' : '');
      if (line === original) continue;
      // Only the two edited lines differ, each by its text and with the common ending.
      expect(line).toContain('tiny item.');
      expect(ending(line)).toBe(dominant);
    }
  });

  it('an edit undone brings back the page as loaded, CRLF and all', () => {
    const source = CRLF(HARD_WRAPPED_EN);
    expect(edit(source, ['A short item.', 'A tiny item.'], ['A tiny item.', 'A short item.'])).toBe(source);
  });
});
