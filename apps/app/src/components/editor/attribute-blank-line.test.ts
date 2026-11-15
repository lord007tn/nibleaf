// @vitest-environment jsdom
import { DOCUMENTATION_COMPONENTS } from '@nibleaf/shared/documentation-components';
import { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterAll, describe, expect, it } from 'vitest';
import { calloutVariantAttributes } from './extensions/callout';
import { SUPPORTED_MDX_COMPONENTS } from './extensions/mdx-roundtrip';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * #721: a component opener whose attribute value holds a blank line (`caption="a\n\nb"`,
 * a multiline `{…}`) lost its whole component on load and save. The opener's HTML is
 * read as a Markdown HTML block, which the blank line ended. For every component in
 * the editor's registry, with a blank line in a `"…"`, a `'…'` and a `{…}` value:
 * the component is kept, holding the value as written; three load/save cycles give
 * the page byte for byte; and an edit rewrites only that attribute.
 */

const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
afterAll(() => editor.destroy());

interface Loaded {
  nodes: PMNode[];
  saved: string;
}

const load = (page: string): Loaded => {
  editor.commands.setContent(page, { emitUpdate: false });
  const nodes: PMNode[] = [];
  editor.state.doc.descendants((node) => {
    nodes.push(node);
  });
  return { nodes, saved: getMarkdown(editor) };
};

/** The page's save, three load/save cycles over. */
const cycles = (page: string): string[] => {
  const saves: string[] = [];
  let current = page;
  for (let cycle = 0; cycle < 3; cycle++) {
    current = load(current).saved;
    saves.push(current);
  }
  return saves;
};

/** Load the page, set `key` to `Edited` on the first node holding `value` there, and save. */
const edited = (page: string, key: string, value: string): string | null => {
  editor.commands.setContent(page, { emitUpdate: false });
  let target: { pos: number; attrs: Record<string, unknown> } | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (!target && node.attrs[key] === value) target = { pos, attrs: node.attrs };
  });
  if (!target) return null;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(target.pos, undefined, { ...target.attrs, [key]: 'Edited' }));
  return getMarkdown(editor);
};

/** Load the page, switch its first callout to the warning variant, and save. */
const editedCallout = (page: string): string | null => {
  editor.commands.setContent(page, { emitUpdate: false });
  let target: { pos: number; attrs: Record<string, unknown> } | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (!target && node.type.name === 'callout') target = { pos, attrs: node.attrs };
  });
  if (!target) return null;
  // As the callout's type menu does.
  editor.view.dispatch(
    editor.state.tr.setNodeMarkup(target.pos, undefined, { ...target.attrs, ...calloutVariantAttributes(target.attrs, 'warning') }),
  );
  return getMarkdown(editor);
};

/** A node of the component's type (`mdxCard`, or a callout) holding `value` in `key`. */
const holds = (nodes: PMNode[], key: string, value: string): boolean => nodes.some((node) => node.attrs[key] === value);

const registry = DOCUMENTATION_COMPONENTS.flatMap((component) => (component.tag ? [component] : []));
const definitions = Object.values(SUPPORTED_MDX_COMPONENTS);
/** A component that holds only certain children, and the one its test page gives it. */
const childOf = new Map<string, string>(
  registry.flatMap((component) => (component.tag && component.allowedChildren?.[0] ? [[component.tag, component.allowedChildren[0]]] : [])),
);
/** A component held only by certain parents (`<Step>` by `<Steps>`), and its parent. */
const parentOf = new Map<string, string>();
for (const [parent] of childOf)
  for (const child of registry.find((component) => component.tag === parent)?.allowedChildren ?? [])
    if (!parentOf.has(child) && child !== parent) parentOf.set(child, parent);

/** The attribute a value goes in: the first that isn't a switch, or `title` for a
 *  component with none, which the editor doesn't show (kept and saved, not edited). */
const keyOf = (tag: string): { key: string; editable: boolean } => {
  const definition = SUPPORTED_MDX_COMPONENTS[tag.toLowerCase()];
  const key = definition?.attrs.find((name) => !definition.booleans?.includes(name));
  return key ? { key, editable: true } : { key: 'title', editable: false };
};

const BODY = '\n\nBody text.\n\nA second paragraph.\n\n';

/** Components written self-closing (`<Icon icon="x" />`): they hold no children. */
const selfClosing = new Set<string>(registry.flatMap((component) => (component.selfClosing && component.tag ? [component.tag] : [])));

/** The opener as written: `<tag key=VALUE>`, or `<tag key=VALUE />`. */
const openerFor = (tag: string, key: string, value: string): string => `<${tag} ${key}=${value}${selfClosing.has(tag) ? ' />' : '>'}`;

/** A page holding the component's opener, inside its parent when it needs one and
 *  with a child when it holds only certain children. */
const pageFor = (tag: string, key: string, value: string): string => {
  const definition = SUPPORTED_MDX_COMPONENTS[tag.toLowerCase()];
  const opener = openerFor(tag, key, value);
  if (definition?.inline) return `Intro.\n\nSome ${selfClosing.has(tag) ? opener : `${opener}inline text</${tag}>`} more text.\n\nOutro.`;
  const child = childOf.get(tag);
  const childOpener = child ? openerFor(child, keyOf(child).key, '"Child"') : '';
  const childBody = child && selfClosing.has(child) ? `\n\n${childOpener}\n\n` : `\n\n${childOpener}\n\nChild text.\n\n</${child}>\n\n`;
  const body = child ? childBody : BODY;
  let component = selfClosing.has(tag) ? opener : `${opener}${body}</${tag}>`;
  const parent = parentOf.get(tag);
  if (parent) component = `<${parent}>\n\n${component}\n\n</${parent}>`;
  return `Intro.\n\n${component}\n\nOutro.`;
};

/** The three value forms, each with a blank line inside: as written, and as the editor holds it. */
const FORMS = [
  ['"…"', '"a\n\nb"', 'a\n\nb'],
  ["'…'", "'a\n\nb'", 'a\n\nb'],
  ['{…}', '{`a\n\nb`}', '{`a\n\nb`}'],
] as const;

describe('every registry component keeps a blank line inside an attribute value (#721)', () => {
  it('covers every component in the registry', () => {
    expect(definitions.map((definition) => definition.canonical).sort()).toEqual(registry.map((component) => component.tag).sort());
  });

  const cases = definitions.flatMap((definition) =>
    FORMS.map(([form, written, value]) => ({ tag: definition.canonical, form, written, value, ...keyOf(definition.canonical) })),
  );
  const counts = { kept: 0, edited: 0 };

  it.each(cases)('$tag with a blank line in a $form $key', ({ tag, written, value, key, editable }) => {
    const page = pageFor(tag, key, written);
    const { nodes, saved } = load(page);
    // The component is kept: its node is there, holding the value exactly as written
    // (a Callout's `type` picks its variant; its opener is kept as written).
    if (editable && tag !== 'Callout') expect(holds(nodes, key, value)).toBe(true);
    else expect(nodes.some((node) => node.attrs.sourceOpen === openerFor(tag, key, written))).toBe(true);
    expect(saved).toBe(page);
    expect(cycles(page)).toEqual([page, page, page]);
    counts.kept++;
    if (!editable) return;
    if (tag === 'Callout') expect(editedCallout(page)).toBe(page.replace(`${key}=${written}`, `${key}="warning"`));
    else expect(edited(page, key, value)).toBe(page.replace(`${key}=${written}`, `${key}="Edited"`));
    counts.edited++;
  });

  afterAll(() => {
    console.info(`[attribute-blank-line] ${definitions.length} components, ${cases.length} cases: ${counts.kept} kept, ${counts.edited} edited`);
  });
});

describe('blank lines inside attribute values, in other shapes (#721)', () => {
  /** Load and save three times, and edit `key`: only that attribute changes. */
  const roundTrips = (page: string, key: string, written: string, value: string) => {
    const { nodes } = load(page);
    expect(holds(nodes, key, value)).toBe(true);
    expect(cycles(page)).toEqual([page, page, page]);
    expect(edited(page, key, value)).toBe(page.replace(`${key}=${written}`, `${key}="Edited"`));
  };

  it.each([
    ['several blank lines', '"a\n\n\n\nb\n\nc"', 'a\n\n\n\nb\n\nc'],
    ['blank lines holding spaces and tabs', '"a\n   \n\t\nb  \n \t \nc"', 'a\n   \n\t\nb  \n \t \nc'],
    ['a blank line at the start and end of the value', '"\n\na\n\n"', '\n\na\n\n'],
    ['a multiline object, indented after the blank line', '{{\n    a: 1,\n\n    b: 2,\n}}', '{{\n    a: 1,\n\n    b: 2,\n}}'],
    ['a template literal holding Markdown', '{`# Heading\n\n- item\n\n    code\n\n> quote`}', '{`# Heading\n\n- item\n\n    code\n\n> quote`}'],
    ['a value holding tag text', '"<b>\n\n</Card>"', '<b>\n\n</Card>'],
    ['character references with a blank line', '"R&amp;D\n\n&quot;x&quot;"', 'R&D\n\n"x"'],
    ['a blank line written as references', '"a&#10;&#10;b"', 'a\n\nb'],
  ])('%s', (_name, written, value) => {
    roundTrips(`Intro.\n\n<Card title=${written}>\n\nBody\n\n</Card>\n\nOutro.`, 'title', written, value);
  });

  it('a blank line in a value, then children holding blank lines, lists, code and a nested component', () => {
    const page =
      'Intro.\n\n<Card title="a\n\nb">\n\nFirst.\n\n- one\n\n- two\n\n```js\nconst x = 1;\n\nconst y = 2;\n```\n\n<Accordion title="Inner">\n\nInner text.\n\nMore.\n\n</Accordion>\n\n</Card>\n\nOutro.';
    roundTrips(page, 'title', '"a\n\nb"', 'a\n\nb');
  });

  it('blank lines inside nested components, at every level', () => {
    const page =
      'Intro.\n\n<CardGroup cols={\n\n2\n\n}>\n\n<Card title="Outer\n\ncard">\n\n<Steps>\n\n<Step title={`one\n\ntwo`}>\n\nStep text.\n\n</Step>\n\n</Steps>\n\n</Card>\n\n</CardGroup>\n\nOutro.';
    const { nodes } = load(page);
    expect(holds(nodes, 'cols', '{\n\n2\n\n}')).toBe(true);
    expect(holds(nodes, 'title', 'Outer\n\ncard')).toBe(true);
    expect(holds(nodes, 'title', '{`one\n\ntwo`}')).toBe(true);
    expect(cycles(page)).toEqual([page, page, page]);
    // Each edit rewrites its own attribute, at its own level.
    expect(edited(page, 'cols', '{\n\n2\n\n}')).toBe(page.replace('cols={\n\n2\n\n}', 'cols="Edited"'));
    expect(edited(page, 'title', 'Outer\n\ncard')).toBe(page.replace('title="Outer\n\ncard"', 'title="Edited"'));
    expect(edited(page, 'title', '{`one\n\ntwo`}')).toBe(page.replace('title={`one\n\ntwo`}', 'title="Edited"'));
  });

  it('two values with blank lines: an edit of one leaves the other as written', () => {
    const page = 'Intro.\n\n<Card title="a\n\nb" href={`/x\n\n`} icon=\'c\n\nd\'>\n\nBody\n\n</Card>\n\nOutro.';
    roundTrips(page, 'icon', "'c\n\nd'", 'c\n\nd');
    expect(edited(page, 'href', '{`/x\n\n`}')).toBe(page.replace('href={`/x\n\n`}', 'href="Edited"'));
  });

  it('an inline component in a list item and in a quote', () => {
    for (const page of [
      'Intro.\n\n- Some <Badge color="a\n\n  b">text</Badge> here.\n\nOutro.',
      "Intro.\n\nSome <Tooltip tip={`a\n\nb`}>text</Tooltip> and <Badge color='c\n\nd'>more</Badge>.\n\nOutro.",
    ])
      expect(cycles(page)).toEqual([page, page, page]);
    const page = 'Intro.\n\n- Some <Badge color="a\n\n  b">text</Badge> here.\n\nOutro.';
    expect(holds(load(page).nodes, 'color', 'a\n\n  b')).toBe(true);
  });

  it('a self-closing component and a Callout type', () => {
    roundTrips('Intro.\n\n<Icon icon="a\n\nb" />\n\nOutro.', 'icon', '"a\n\nb"', 'a\n\nb');
    const callout = 'Intro.\n\n<Callout type="note\n\nx">\n\nBody\n\n</Callout>\n\nOutro.';
    expect(cycles(callout)).toEqual([callout, callout, callout]);
  });

  it('a Frame holding an embed, with a blank line in its caption', () => {
    const page =
      'Intro.\n\n<Frame caption="a\n\nb">\n  <iframe src="https://www.youtube.com/embed/M7lc1UVf-VE" title="Tour"></iframe>\n</Frame>\n\nOutro.';
    const { nodes } = load(page);
    expect(nodes.some((node) => node.attrs.caption === 'a\n\nb')).toBe(true);
    expect(cycles(page)).toEqual([page, page, page]);
  });

  it('CRLF blank lines: kept, and the page keeps its CRLF endings (#702)', () => {
    const page = 'Intro.\r\n\r\n<Card title="a\r\n\r\nb">\r\n\r\nBody\r\n\r\n</Card>\r\n\r\nOutro.';
    const { nodes, saved } = load(page);
    expect(holds(nodes, 'title', 'a\n\nb')).toBe(true);
    expect(saved).toBe(page);
    expect(cycles(page)).toEqual([page, page, page]);
    expect(edited(page, 'title', 'a\n\nb')).toBe(page.replace('title="a\r\n\r\nb"', 'title="Edited"'));
  });
});
