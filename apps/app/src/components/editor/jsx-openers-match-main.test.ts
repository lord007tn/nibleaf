// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';
import main from './__fixtures__/jsx-openers-main.json';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * Generated component opening tags (valid MDX, as the MDX compiler accepts it, and
 * malformed: Unicode and namespaced names, spread attributes, `a.b`, `x::y`,
 * backslashes before quotes), against main's results (#579 reads openers with the
 * MDX grammar, `./extensions/jsx-attributes`):
 *
 * - A page MDX compiles with no backslash in its value gives what main gives: the
 *   same nodes, the same saved page, and the same page after the title or caption
 *   is edited.
 * - A page MDX compiles with a backslash in its value (`title="Old\"`, the title
 *   `Old\`): main dropped the component or misread its attributes. It now loads as
 *   the component, saves byte for byte, and an edit rewrites only that value.
 * - A page MDX rejects (`a.b="x"`, `x::y="1"`, `"a \"b\" c"`) loads as one opaque
 *   block from the opener to its closing tag and saves byte for byte. Main
 *   structured some of these and dropped others.
 *
 * `__fixtures__/jsx-openers-main.json` holds main's results (main 14209455) and
 * whether `@mdx-js/mdx` compiles each page; it was made by running this generator
 * against main's editor. The test checks that the fixture holds exactly these pages.
 */

const COMPONENTS = [
  ['Card', 'title'],
  ['Step', 'title'],
  ['Accordion', 'title'],
  ['Frame', 'caption'],
] as const;
const VALUES = ['"A"', "'A'", '"ü"', '{"x"}', String.raw`"Old\"`, String.raw`"a \"b\" c"`, String.raw`"a \"a.b="x"`] as const;
const FOLLOWERS = [
  '',
  ' id="x"',
  'id="x"',
  ' id = "x"',
  '{...props}',
  ' {...props}',
  ' data-x="1"',
  ' xml:lang="en"',
  ' a.b="x"',
  ' x::y="1"',
  ' ünï="1"',
  ' 名前="x"',
  ' $x="1"',
  ' disabled',
  'disabled',
  ' a-b:c="1"',
  ` ${'a'.repeat(300)}="x"`,
] as const;

/** Every page: a component whose opener is `<Tag key=VALUE FOLLOWER>`, with a body. */
const pages = COMPONENTS.flatMap(([tag, key]) =>
  VALUES.flatMap((value) =>
    FOLLOWERS.map((follower) => ({ tag, key, value, source: `Intro.\n\n<${tag} ${key}=${value}${follower}>\n\nBody\n\n</${tag}>` })),
  ),
);
const COMPONENT_NODE: Record<(typeof COMPONENTS)[number][0], string> = {
  Card: 'mdxCard',
  Step: 'mdxStep',
  Accordion: 'mdxAccordion',
  Frame: 'mdxFrame',
};

interface Result {
  nodes: string[];
  saved: string;
  edited: string | null;
}

describe('component opening tags, as main reads them', () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  afterAll(() => editor.destroy());

  /** The page's nodes, its save, and its save after the first node with the
   *  attribute has it set to `Edited` (null when no node has it). */
  const read = (source: string, key: string): Result => {
    editor.commands.setContent(source, { emitUpdate: false });
    const nodes: string[] = [];
    let target: { pos: number; attrs: Record<string, unknown> } | undefined;
    editor.state.doc.descendants((node, pos) => {
      nodes.push(node.type.name);
      if (!target && key in node.attrs) target = { pos, attrs: node.attrs };
    });
    const saved = getMarkdown(editor);
    if (!target) return { nodes, saved, edited: null };
    editor.view.dispatch(editor.state.tr.setNodeMarkup(target.pos, undefined, { ...target.attrs, [key]: 'Edited' }));
    return { nodes, saved, edited: getMarkdown(editor) };
  };

  it('has main’s results for exactly these pages, at least 214 of them valid MDX', () => {
    expect(main.map((entry) => entry.source)).toEqual(pages.map((page) => page.source));
    expect(main.filter((entry) => entry.valid).length).toBeGreaterThanOrEqual(214);
  });

  it(`gives main’s results, or the grammar’s where main misread, for all ${pages.length} pages`, () => {
    const differences: Array<{ source: string; expected: Result; head: Result }> = [];
    const counts = { asMain: 0, backslashRead: 0, rejectedOpaque: 0 };
    for (const [index, { tag, key, value, source }] of pages.entries()) {
      const fromMain = main[index] as (typeof main)[number];
      const head = read(source, key);
      let expected: Result;
      if (fromMain.valid && !value.includes('\\')) {
        expected = { nodes: fromMain.nodes, saved: fromMain.saved, edited: fromMain.edited };
        counts.asMain++;
      } else if (fromMain.valid) {
        // The component, its value read with no escapes, edited in place.
        expected = {
          nodes: ['paragraph', 'text', COMPONENT_NODE[tag], 'paragraph', 'text', 'paragraph'],
          saved: source,
          edited: source.replace(`${key}=${value}`, `${key}="Edited"`),
        };
        counts.backslashRead++;
      } else {
        // One opaque node and no component: a block, or inline where Markdown reads the
        // opener's line as a paragraph (`title="a \"b\" c"` isn't an HTML tag to it).
        const opaque = head.nodes.filter((node) => node.startsWith('mdxOpaque')).length === 1 && !head.nodes.includes(COMPONENT_NODE[tag]);
        expected = { nodes: opaque ? head.nodes : ['one opaque node, no component'], saved: source, edited: null };
        counts.rejectedOpaque++;
      }
      if (JSON.stringify(head) !== JSON.stringify(expected)) differences.push({ source, expected, head });
    }
    expect(differences.slice(0, 3)).toEqual([]);
    expect(counts.backslashRead).toBeGreaterThan(0);
    console.info(`[jsx-openers-match-main] ${JSON.stringify(counts)}`);
  }, 60_000);
});
