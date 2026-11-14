// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';
import main from './__fixtures__/jsx-openers-main.json';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * This PR leaves component attributes as main reads them: #579 (a Frame caption
 * ending in a backslash) moves to its own PR, with a real JSX attribute grammar.
 * For every generated opening tag (valid MDX, as the MDX compiler accepts it, and
 * malformed: Unicode and namespaced names, spread attributes, `a.b`, `x::y`,
 * backslashes before quotes), the editor gives what main gives: the same nodes,
 * the same saved page, and the same page after the title or caption is edited.
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
    FOLLOWERS.map((follower) => ({ tag, key, source: `Intro.\n\n<${tag} ${key}=${value}${follower}>\n\nBody\n\n</${tag}>` })),
  ),
);

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

  it(`gives main’s nodes, save and edited save for all ${pages.length} pages`, () => {
    const differences: Array<{ source: string; main: Result; head: Result }> = [];
    for (const [index, { key, source }] of pages.entries()) {
      const expected = main[index] as (typeof main)[number];
      const head = read(source, key);
      const fromMain: Result = { nodes: expected.nodes, saved: expected.saved, edited: expected.edited };
      if (JSON.stringify(head) !== JSON.stringify(fromMain)) differences.push({ source, main: fromMain, head });
    }
    expect(differences.slice(0, 3)).toEqual([]);
  }, 60_000);
});
