// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { parse, postprocess, preprocess } from 'micromark';
import { mdxjs } from 'micromark-extension-mdxjs';
import { afterAll, describe, expect, it } from 'vitest';
import { isJsxTagFailure, jsxGrammarWork, readJsxOpeningTag } from './extensions/jsx-attributes';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * A differential oracle for component openers (#579): the MDX compiler's own
 * tokenizer (`micromark-extension-mdxjs`, what `@mdx-js/mdx` runs) against the
 * editor's reader (`./extensions/jsx-attributes`), over a seeded corpus of
 * openers covering the grammar and adversarial cases: backslashes anywhere, quotes
 * inside the other quote style, braces in strings, comments and template literals
 * inside expressions, unterminated values, `>` inside values, invalid names.
 *
 * - Where the compiler reads the opener, the editor reads the same attributes:
 *   names, value kinds and value spans. The one exception is a regular expression
 *   or JSX element inside `{…}` (generated on purpose, flagged), which the editor
 *   doesn't read and keeps whole as written.
 * - Where the compiler rejects it, so does the editor's reader.
 * - Every generated page (the opener around an embed, an image or text) loads and
 *   saves byte for byte, and a rejected or unread opener loads as an opaque block
 *   starting at its `<`, never as the component.
 */

type MarkdownStorage = { markdown: { parser: { parse(content: string): unknown; md: { parse(source: string, env: object): unknown } } } };

const SEED = 0x57_9f_3a_c1;
const COUNT = 4096;

type Case = { opener: string; name: string; page: string; start: number; selfClosing: boolean; unread: boolean };

/** The corpus: `COUNT` pages from the shared xorshift (see `@nibleaf/shared/testing/fence-cases`). */
function corpus(seed = SEED, count = COUNT): Case[] {
  let state = seed;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const pick = <T>(values: readonly T[]): T => values[next() % values.length] as T;
  const chance = (percent: number) => next() % 100 < percent;
  let unread = false;

  const VALUE_CHARS = ['a', 'Z', ' ', '\\', '\\\\', '"', "'", '>', '<', '{', '}', '`', '/', '\n', '&amp;', '&quot;', 'é', '\t', '=', '${'] as const;
  const quoted = () => {
    const quote = pick(['"', "'"] as const);
    let body = Array.from({ length: next() % 6 }, () => pick(VALUE_CHARS))
      // Mostly the other quote only, so most values close where they should.
      .filter((char) => char !== quote || chance(15))
      .join('');
    if (chance(35)) body += '\\';
    return `${quote}${body}${quote}`;
  };
  const jsString = () => {
    const quote = pick(['"', "'"] as const);
    const parts = Array.from({ length: next() % 5 }, () =>
      pick(['a', ' ', '}', '{', '>', '<', '/', '`', '${', '\\\\', `\\${quote}`, quote === '"' ? "'" : '"'] as const),
    );
    return `${quote}${parts.join('')}${quote}`;
  };
  const template = (depth: number): string => {
    const parts = Array.from({ length: next() % 4 }, () =>
      chance(30) && depth < 2 ? `\${${expression(depth + 1)}}` : pick(['a', '}', '{', '"', "'", '\\`', '\\${', '\n', '>', '/'] as const),
    );
    return `\`${parts.join('')}\``;
  };
  const atom = (depth: number): string => {
    switch (next() % 8) {
      case 0:
        return pick(['a', 'props.title', 'x1', '$v', '_u', 'ünï', 'null', 'true'] as const);
      case 1:
        return pick(['1', '2.5', '0x1F', '1e3', '.5'] as const);
      case 2:
      case 3:
        return jsString();
      case 4:
        return template(depth);
      case 5:
        return depth < 2 ? `[${expression(depth + 1)}, ${atom(depth + 1)}]` : 'b';
      case 6:
        return depth < 2 ? `{ k: ${expression(depth + 1)}, "}": ${atom(depth + 1)} }` : 'c';
      default:
        return depth < 2 ? `(${expression(depth + 1)})` : 'd';
    }
  };
  const expression = (depth = 0): string => {
    const a = atom(depth);
    switch (next() % 12) {
      case 0:
        return `${a} + ${atom(depth)}`;
      case 1:
        return `${a} / 2`;
      case 2:
        return `${a} ? ${atom(depth)} : ${atom(depth)}`;
      case 3:
        return `f(${a}, ${atom(depth)})`;
      case 4:
        return `/* } > */ ${a}`;
      case 5:
        return `${a} // } >\n`;
      case 6:
        return `() => (${a})`;
      case 7:
        return `(${a}).length > 1`;
      case 8:
        return `x < ${a}`;
      case 9:
        return `typeof ${a}`;
      default:
        return a;
    }
  };
  const expressionValue = () => {
    if (chance(88)) {
      const space = pick(['', ' ', '\n  '] as const);
      return `{${space}${expression()}${space}}`;
    }
    // biome-ignore lint/suspicious/noTemplateCurlyInString: generated MDX, a template literal left open.
    const broken = pick(['{}', '{ }', '{/* c */}', '{"}', '{a', '{(}', '{...a}', '{"a\nb"}', '{`a${b`}', '{/}/}', '{<b>x</b>}', '{a // }'] as const);
    if (broken === '{/}/}' || broken === '{<b>x</b>}') unread = true;
    return broken;
  };
  const spread = () =>
    pick([
      '{...props}',
      '{ ...props }',
      '{...{a: "}"}}',
      '{...a,}',
      '{...a, ...b}',
      '{x}',
      '{}',
      '{.../* } */a}',
      '{...f("{")}',
      '{\n...props\n}',
    ] as const);
  const attributeName = () =>
    chance(90)
      ? pick([
          'caption',
          'title',
          'data-lightbox',
          'aria-label',
          'xml:lang',
          'a-b:c',
          'a : b',
          '$x',
          '_y',
          'ünï',
          '名前',
          'dataX',
          'data-x-1',
          'hidden',
        ] as const)
      : pick(['1x', 'a.b', 'x::y', '-x', '@x', 'a:b:c'] as const);
  const attribute = () => {
    const kind = next() % 10;
    if (kind < 2) return attributeName();
    if (kind < 3) return spread();
    const equals = pick(['=', '=', ' = ', '=\n', ' ='] as const);
    return `${attributeName()}${equals}${kind < 7 ? quoted() : expressionValue()}`;
  };

  const cases: Case[] = [];
  for (let index = 0; index < count; index++) {
    unread = false;
    const name = pick(['Frame', 'Frame', 'Card', 'Accordion'] as const);
    const key = name === 'Frame' ? 'caption' : 'title';
    const first = chance(70) ? [`${key}=${chance(70) ? quoted() : expressionValue()}`] : [];
    const attributes = [...first, ...Array.from({ length: next() % 4 }, attribute)];
    let inside = '';
    for (const attr of attributes) inside += `${pick([' ', ' ', '', '\n', '\n  ', ' \t', '\u00a0'] as const)}${attr}`;
    const end = pick(['>', '>', ' >', '\n>', '/>', ' />', ' / >'] as const);
    let opener = `<${name}${inside.startsWith('{') ? inside : ` ${inside.trimStart()}`}${end}`;
    if (chance(30)) {
      // A backslash, or another adversarial character, anywhere after the name.
      const at = name.length + 1 + (next() % (opener.length - name.length - 1));
      opener = `${opener.slice(0, at)}${pick(['\\', '\\', '"', "'", '{', '}', '>', '`'] as const)}${opener.slice(at)}`;
    }
    const selfClosing = /\/\s*>$/.test(end);
    const body = pick([
      `\n  <iframe src="https://www.youtube.com/embed/M7lc1UVf-VE" title="Tour"></iframe>\n`,
      '\n\n![Diagram](/diagram.png)\n\n',
      '\n\n<img src="/diagram.png" alt="Diagram" />\n\n',
      '\n\nBody text.\n\n',
    ] as const);
    const component = selfClosing ? opener : `${opener}${body}</${name}>`;
    const page = `Intro.\n\n${component}\n\nOutro.`;
    cases.push({ opener, name, page, start: page.indexOf('<'), selfClosing, unread });
  }
  return cases;
}

type Attribute = { kind: string; name: string; start: number; value?: [number, number] };

/** The first JSX tag's attributes as the compiler's tokenizer reads them, or null when it rejects the page. */
function compilerAttributes(page: string): { attributes: Attribute[]; end: number } | null {
  let events: ReturnType<typeof postprocess>;
  try {
    events = postprocess(
      parse({ extensions: [mdxjs()] })
        .document()
        .write(preprocess()(page, undefined, true)),
    );
  } catch {
    return null;
  }
  const attributes: Attribute[] = [];
  let current: Attribute | undefined;
  let inTag = false;
  for (const [kind, token] of events) {
    const tag = /^mdxJsx(?:Flow|Text)Tag(.*)$/.exec(token.type);
    if (!tag) continue;
    const part = tag[1];
    const start = token.start.offset;
    const end = token.end.offset;
    if (part === '') {
      if (kind === 'enter') inTag = true;
      else if (inTag) return { attributes, end };
      continue;
    }
    if (!inTag || kind !== 'enter') continue;
    if (part === 'Attribute') {
      current = { kind: 'boolean', name: '', start };
      attributes.push(current);
    } else if (part === 'AttributeNamePrimary' && current) current.name = page.slice(start, end);
    else if (part === 'AttributeNameLocal' && current) current.name += `:${page.slice(start, end)}`;
    else if (part === 'AttributeValueLiteral' && current) Object.assign(current, { kind: 'string', value: [start, end] });
    else if (part === 'AttributeValueExpression' && current) Object.assign(current, { kind: 'expression', value: [start, end] });
    else if (part === 'ExpressionAttribute') attributes.push({ kind: 'spread', name: '', start, value: [start, end] });
  }
  return null;
}

/** The editor's reading of the opener at `start`, in the oracle's shape. */
function editorAttributes(page: string, start: number) {
  const tag = readJsxOpeningTag(page, start);
  if (isJsxTagFailure(tag)) return tag;
  return {
    attributes: tag.attributes.map(
      (attr): Attribute => ({
        kind: attr.kind,
        name: attr.name,
        start: attr.start,
        ...(attr.kind === 'boolean' ? {} : { value: [attr.valueStart, attr.valueEnd] as [number, number] }),
      }),
    ),
    end: tag.end,
  };
}

const cases = corpus();
const verdicts = cases.map((entry) => ({ entry, compiler: compilerAttributes(entry.page), editor: editorAttributes(entry.page, entry.start) }));

describe('component openers: the editor reads what the MDX compiler reads', () => {
  it(`agrees with the compiler’s tokenizer on all ${COUNT} generated openers`, () => {
    const counts = { acceptedAgreed: 0, acceptedUnread: 0, rejectedRejected: 0, rejectedAfterOpener: 0 };
    const disagreements: unknown[] = [];
    for (const { entry, compiler, editor } of verdicts) {
      const same = (reading: typeof compiler) => !isJsxTagFailure(editor) && JSON.stringify(editor) === JSON.stringify(reading);
      if (compiler) {
        if (same(compiler)) counts.acceptedAgreed++;
        // A regular expression or JSX inside `{…}`: unread, kept whole (see the round trip).
        else if (isJsxTagFailure(editor) && editor.unmodelled) counts.acceptedUnread++;
        else disagreements.push({ opener: entry.opener, compiler, editor });
      } else if (isJsxTagFailure(editor)) counts.rejectedRejected++;
      // The compiler reads the same tag up to its `>` and rejects the page after it
      // (text after the tag on its line, an expression on the next): the opener agrees.
      else if (same(compilerAttributes(entry.page.slice(0, editor.end)))) counts.rejectedAfterOpener++;
      else disagreements.push({ opener: entry.opener, compiler: 'rejected', editor });
    }
    expect(disagreements.slice(0, 5)).toEqual([]);
    console.info(`[jsx-attribute-oracle] ${JSON.stringify(counts)}`);
    // The corpus exercises both sides, and most of it is read.
    expect(counts.acceptedAgreed).toBeGreaterThan(COUNT * 0.4);
    expect(counts.rejectedRejected).toBeGreaterThan(COUNT * 0.15);
  });

  it('covers every grammar feature among the openers the compiler reads', () => {
    const accepted = verdicts.flatMap(({ compiler, entry }) => (compiler ? [{ compiler, entry }] : []));
    const kinds = new Set(accepted.flatMap(({ compiler }) => compiler.attributes.map((attr) => attr.kind)));
    expect([...kinds].sort()).toEqual(['boolean', 'expression', 'spread', 'string']);
    const openers = accepted.map(({ entry }) => entry.opener);
    const has = (pattern: RegExp) => openers.filter((opener) => pattern.test(opener)).length;
    expect(has(/[=]"[^"\n]*\\"/)).toBeGreaterThan(50); // a double-quoted value ending in a backslash
    expect(has(/[=]'[^'\n]*\\'/)).toBeGreaterThan(50); // a single-quoted value ending in a backslash
    expect(has(/\w:\w+=/)).toBeGreaterThan(20); // a namespaced name
    expect(has(/\n/)).toBeGreaterThan(200); // a multiline opener
    expect(has(/\/\s*>$/)).toBeGreaterThan(200); // self-closing
    expect(has(/[=]\{[^}]*\/\*/)).toBeGreaterThan(20); // a comment inside an expression
    expect(has(/[=]\{[^}]*`/)).toBeGreaterThan(20); // a template literal inside an expression
  });
});

describe('every generated page loads and saves byte for byte', () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  afterAll(() => editor.destroy());
  const COMPONENT_NODES = new Set(['mdxFrame', 'mdxCard', 'mdxAccordion', 'videoEmbed']);
  const { parser } = (editor.storage as unknown as MarkdownStorage).markdown;

  it.each([
    ['the whole corpus as one page', () => verdicts.map(({ entry }) => entry.page).join('\n\n')],
    // Each opener's comment hides the `>` the scan ends it at; the grammar reads on to
    // the `)` at the end and fails there. Read again from every opener, that's n².
    ['openers whose expressions fail far away', () => `${'<Frame caption={a /* } >\n\n'.repeat(2000)}*/ )}>`],
    ['openers rejected at a backslash', () => '<Frame caption="a \\"b\\" c">\n\nBody\n\n</Frame>\n\n'.repeat(2000)],
    ['openers with long attribute lists', () => `<Frame caption="Old\\"${' data-x="1" hidden'.repeat(400)}>\n\nBody\n\n</Frame>\n\n`.repeat(20)],
  ])('reads %s with the grammar in one pass: work linear in the page', (_name, page) => {
    const source = page();
    parser.parse('');
    jsxGrammarWork.steps = 0;
    parser.md.parse(source, {});
    const tags = source.split('<').length;
    // Each character read once by the scan, and each structured opener's text again
    // by at most three attribute lookups; a constant per tag besides.
    expect(jsxGrammarWork.steps).toBeLessThanOrEqual(4 * source.length + tags);
  });

  it(`round-trips all ${COUNT} pages, and keeps every opener the editor doesn't read whole`, () => {
    const counts = { pages: 0, byteIdentical: 0, opaqueAsRequired: 0, reshaped: 0 };
    const failures: unknown[] = [];
    for (const { entry, editor: reading } of verdicts) {
      // A mutation that ends the tag early (`<Frame c>aption=…`) or adds or removes its
      // `/` leaves text after the tag on its line, or a closing tag with nothing to
      // close: not an opener around its content. The oracle above still covers it.
      if (
        !isJsxTagFailure(reading) &&
        (reading.end !== entry.start + entry.opener.length || /\/\s*>$/.test(entry.opener.slice(0, reading.end - entry.start)) !== entry.selfClosing)
      ) {
        counts.reshaped++;
        continue;
      }
      counts.pages++;
      editor.commands.setContent(entry.page, { emitUpdate: false });
      const saved = getMarkdown(editor);
      if (saved === entry.page) counts.byteIdentical++;
      else failures.push({ page: entry.page, saved });
      if (!isJsxTagFailure(reading)) continue;
      // Rejected, or unread: an opaque block from the opener's `<`, and no component node.
      const sources: string[] = [];
      let component = false;
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'mdxOpaqueBlock' || node.type.name === 'mdxOpaqueInline') sources.push(String(node.attrs.source));
        if (COMPONENT_NODES.has(node.type.name)) component = true;
      });
      if (!component && sources.some((source) => entry.page.startsWith(source, entry.start) && source.length > 0)) counts.opaqueAsRequired++;
      else failures.push({ page: entry.page, opaque: sources, component });
    }
    console.info(`[jsx-attribute-oracle] round trip ${JSON.stringify(counts)}`);
    expect(failures.slice(0, 5)).toEqual([]);
    expect(counts.pages).toBeGreaterThan(COUNT * 0.8);
  }, 600_000);
});
