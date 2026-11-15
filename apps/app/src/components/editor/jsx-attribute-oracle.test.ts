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
 *   names, value kinds and value spans, statement-level JavaScript inside `{…}`
 *   included (block bodies, `;`, declarations, getters, classes, labels), and the
 *   component stays editable: keywords as property names, shifts and comparisons,
 *   division after function and class expressions, regular expressions after
 *   `return`, `typeof`, `(`, `,`, `=`. The one exception is a JSX element inside
 *   `{…}`, or a `/` read differently as a regular expression and as division (after
 *   `yield`), which the editor doesn't read and keeps whole as written.
 * - Where the compiler rejects it, so does the editor's reader, except where only the
 *   JavaScript inside a `{…}` is invalid (checked by swapping each value for a valid
 *   one): the editor reads it as an expression value and keeps it byte for byte.
 * - Every generated page (the opener around an embed, an image or text) loads and
 *   saves byte for byte, and a rejected or unread opener loads as an opaque block
 *   starting at its `<`, never as the component.
 */

type MarkdownStorage = { markdown: { parser: { parse(content: string): unknown; md: { parse(source: string, env: object): unknown } } } };

const SEED = 0x57_9f_3a_c1;
const COUNT = 4096;

type Case = { opener: string; name: string; page: string; start: number; selfClosing: boolean; unread: boolean; embed: boolean };

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
  /** Statement-level JavaScript inside `{…}`: block bodies, declarations, `;`, ASI,
   *  getters and setters, classes, async and generator functions, labels. */
  const jsShape = (): string => {
    const a = atom(1);
    return pick([
      `() => { return ${a}; }`,
      `() => {\n  const v = ${a}\n  return v\n}`,
      `(function () { function inner(x) { return x; } return inner(${a}); })()`,
      '(function named(x) { return x })',
      `function named() { return ${a} }`,
      `{ get v() { return ${a}; }, set v(x) {}, m() { return 1; } }`,
      `() => { { let x = ${a}; } if (x) { return 1 } else { return 2 } }`,
      `() => { for (let i = 0; i < 3; i++) { if (i) break; } return ${a}; }`,
      `class { static s = ${a}; m() { return this.s; } get g() { return 1 } }`,
      `async () => { await ${a}; }`,
      `function* () { yield ${a}; }`,
      '() => { outer: for (;;) { break outer; } }',
      `() => { return ${a}; /* } */ }`,
      `() => { return ${a} // }\n}`,
      `() => ({ k: ${a} })`,
      `(x) => { switch (x) { case 1: return ${a}; default: return 0; } }`,
      `() => { try { return ${a} } catch (e) { return e } finally {} }`,
      `new class { constructor() { this.v = ${a}; } }()`,
      `() => { if (a) { return; } ; ; return ${a} }`,
      '[1, 2].map((n) => { const d = n * 2; return d; })',
      // Keywords as property names, shift and comparison operators.
      'obj.return / 2',
      `a.typeof / b + ${a}`,
      'x?.in / 2',
      'a.class / a.if',
      'a << b',
      `(a <<= 1) <= ${a}`,
      'a < b && b >= c',
      'a >>> 1',
      // Function and class expressions, then division.
      '(function () {}) / 2',
      'function () {} / 2',
      '() => { const x = function () {} / 2; return x; }',
      'class {} / 2',
      '() => { const C = class { m() {} } / 2; return C; }',
      // Regular expressions after return, typeof, (, ",", =, a statement's ) or }.
      '() => { return /a"}/.test(s); }',
      "typeof /x'/",
      'f(/}`/, 1)',
      '[1, /"/]',
      '(r = /\\//g)',
      '/[/"]/.source',
      '() => { if (a) /x"/.test(b); }',
      "() => { function f() {} /'/.test(s) }",
      // Division after ), ], identifiers and numbers.
      '(a) / 2',
      '[1][0] / 2',
      'a / b / c',
      `4 / 2 / ${a}`,
    ] as const);
  };
  /** Values the editor reads differently both ways, or JSX: unread, kept whole. */
  const undecided = (): string => {
    unread = true;
    return pick(['function* () { yield /"/; }', 'cond ? <A /> : null', '[<b key="}">x</b>]'] as const);
  };
  const expressionValue = () => {
    if (chance(4)) return `{${undecided()}}`;
    if (chance(30)) return `{${pick(['', ' ', '\n  '] as const)}${jsShape()}}`;
    if (chance(84)) {
      const space = pick(['', ' ', '\n  '] as const);
      return `{${space}${expression()}${space}}`;
    }
    // biome-ignore lint/suspicious/noTemplateCurlyInString: generated MDX, a template literal left open.
    const broken = pick(['{}', '{ }', '{/* c */}', '{"}', '{a', '{(}', '{...a}', '{"a\nb"}', '{`a${b`}', '{/}/}', '{<b>x</b>}', '{a // }'] as const);
    // `{/}/}` is a regular expression, read; `{<b>x</b>}` is JSX, unread.
    if (broken === '{<b>x</b>}') unread = true;
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
    cases.push({ opener, name, page, start: page.indexOf('<'), selfClosing, unread, embed: body.includes('<iframe') });
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

/**
 * Whether the compiler rejects the page only for the JavaScript inside the `{…}`
 * values the editor read: with each swapped for a valid one (`{0}`, a spread for
 * `{...a}`), it reads the same attribute names and kinds. The editor never edits
 * that code, and keeps it byte for byte; the component stays editable.
 */
function rejectedForJavaScriptOnly(page: string, reading: { attributes: Attribute[]; end: number }): boolean {
  const values = reading.attributes.filter((attr) => attr.kind === 'expression' || attr.kind === 'spread');
  if (values.length === 0) return false;
  let swapped = page;
  for (const attr of [...values].reverse()) {
    const [start, end] = attr.value ?? [0, 0];
    swapped = `${swapped.slice(0, start)}${attr.kind === 'spread' ? '{...a}' : '{0}'}${swapped.slice(end)}`;
  }
  const shape = (attributes: Attribute[]) => attributes.map((attr) => `${attr.kind}:${attr.name}`).join(' ');
  const tagEnd = reading.end + swapped.length - page.length;
  const compiled = compilerAttributes(swapped) ?? compilerAttributes(swapped.slice(0, tagEnd));
  return compiled !== null && compiled.end === tagEnd && shape(compiled.attributes) === shape(reading.attributes);
}

const cases = corpus();
const verdicts = cases.map((entry) => ({ entry, compiler: compilerAttributes(entry.page), editor: editorAttributes(entry.page, entry.start) }));

describe('component openers: the editor reads what the MDX compiler reads', () => {
  it(`agrees with the compiler’s tokenizer on all ${COUNT} generated openers`, () => {
    const counts = { acceptedAgreed: 0, acceptedUnread: 0, rejectedRejected: 0, rejectedAfterOpener: 0, rejectedJavaScriptOnly: 0 };
    const unreadAt: Record<string, number> = {};
    const disagreements: unknown[] = [];
    for (const { entry, compiler, editor } of verdicts) {
      const same = (reading: typeof compiler) => !isJsxTagFailure(editor) && JSON.stringify(editor) === JSON.stringify(reading);
      if (compiler) {
        if (same(compiler)) counts.acceptedAgreed++;
        // A regular expression or JSX inside `{…}`: unread, kept whole (see the round trip).
        else if (isJsxTagFailure(editor) && editor.unmodelled) {
          counts.acceptedUnread++;
          const char = entry.page[editor.at] ?? '';
          unreadAt[char] = (unreadAt[char] ?? 0) + 1;
          // Only JSX, or a `/` read differently as a regular expression and as division:
          // the values the generator made so (`undecided`), at a `/` or `<`.
          if ((char !== '/' && char !== '<') || !entry.unread) disagreements.push({ opener: entry.opener, compiler, editor });
        } else disagreements.push({ opener: entry.opener, compiler, editor });
      } else if (isJsxTagFailure(editor)) counts.rejectedRejected++;
      // The compiler reads the same tag up to its `>` and rejects the page after it
      // (text after the tag on its line, an expression on the next): the opener agrees.
      else if (same(compilerAttributes(entry.page.slice(0, editor.end)))) counts.rejectedAfterOpener++;
      // Only the code inside a `{…}` is invalid: read as an expression value, kept as written.
      else if (rejectedForJavaScriptOnly(entry.page, editor)) counts.rejectedJavaScriptOnly++;
      else disagreements.push({ opener: entry.opener, compiler: 'rejected', editor });
    }
    expect(disagreements.slice(0, 5)).toEqual([]);
    console.info(`[jsx-attribute-oracle] ${JSON.stringify(counts)} unread at ${JSON.stringify(unreadAt)}`);
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
    // Statement-level JavaScript inside `{…}`, read by both.
    const read = verdicts.filter(({ compiler, editor }) => compiler && !isJsxTagFailure(editor)).map(({ entry }) => entry.opener);
    const reads = (pattern: RegExp) => read.filter((opener) => pattern.test(opener)).length;
    expect(reads(/[=]> \{/)).toBeGreaterThan(100); // an arrow function with a block body
    expect(reads(/return [^;]*;/)).toBeGreaterThan(50); // `return …;`
    expect(reads(/\{ get v\(\)/)).toBeGreaterThan(10); // getters, setters and methods
    expect(reads(/class \{/)).toBeGreaterThan(10); // class bodies
    expect(reads(/function\* |async \(\)/)).toBeGreaterThan(10); // generator and async functions
    expect(reads(/outer: for/)).toBeGreaterThan(5); // a labelled statement
    expect(reads(/const v = [^\n]*\n {2}return v\n/)).toBeGreaterThan(5); // ASI
    expect(reads(/obj\.return \/ 2|x\?\.in \/ 2|a\.class \/ a\.if/)).toBeGreaterThan(10); // keywords as property names
    expect(reads(/a << b|a >>> 1|<<= 1|b >= c/)).toBeGreaterThan(10); // shift and comparison
    expect(reads(/function \(\) \{\} \/ 2|class (\{ m\(\) \{\} \} |\{\} )\/ 2/)).toBeGreaterThan(10); // function and class expressions, then division
    expect(reads(/return \/a"\}\/|typeof \/x'\/|f\(\/\}`\/|\[1, \/"\/\]|if \(a\) \/x"\//)).toBeGreaterThan(10); // regular expressions
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
    const counts = { pages: 0, byteIdentical: 0, opaqueAsRequired: 0, editable: 0, reshaped: 0 };
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
      const sources: string[] = [];
      let component = false;
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'mdxOpaqueBlock' || node.type.name === 'mdxOpaqueInline') sources.push(String(node.attrs.source));
        if (COMPONENT_NODES.has(node.type.name)) component = true;
      });
      if (!isJsxTagFailure(reading)) {
        // Read: the component is a node the writer edits. (Around an embed, #573's
        // rules still decide: a Card or an expression caption keeps it opaque.)
        if (component) counts.editable++;
        else if (!entry.embed) failures.push({ page: entry.page, editable: false });
        continue;
      }
      // Rejected, or unread: an opaque block from the opener's `<`, and no component node.
      if (!component && sources.some((source) => entry.page.startsWith(source, entry.start) && source.length > 0)) counts.opaqueAsRequired++;
      else failures.push({ page: entry.page, opaque: sources, component });
    }
    console.info(`[jsx-attribute-oracle] round trip ${JSON.stringify(counts)}`);
    expect(failures.slice(0, 5)).toEqual([]);
    expect(counts.pages).toBeGreaterThan(COUNT * 0.8);
  }, 600_000);
});
