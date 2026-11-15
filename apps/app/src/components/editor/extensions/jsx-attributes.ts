/**
 * An MDX component's opening tag, read with the grammar the MDX compiler uses
 * (`micromark-extension-mdx-jsx`, as `micromark-extension-mdxjs` configures it):
 *
 * - a name: an identifier (`-` allowed), then `.member`s or one `:local` part;
 * - attribute names the same way, namespaced (`xml:lang`) or not (`data-x`, `aria-label`);
 * - boolean attributes, with no value;
 * - `"…"` and `'…'` values with no escapes: a backslash is a literal character, so
 *   `caption="Old\"` ends at that quote, and a value may span lines;
 * - `{…}` values holding JavaScript, and spread attributes (`{...props}`);
 * - whitespace and line breaks between all of these, and a self-closing `/>`.
 *
 * The compiler ends a `{…}` at the first `}` after which acorn parses what it read
 * as an expression. For valid JavaScript that is the first `}` outside nested
 * brackets, strings, template literals and comments, which is where this reader
 * ends it. A regular expression or JSX inside the braces can't be told apart from
 * division or `<` without a JavaScript parser, so either one is left unread
 * (`unmodelled`): the caller keeps the whole component as written, byte for byte,
 * as it does an opener whose tag the compiler rejects. The code inside braces is
 * checked only for structure, never as JavaScript: the editor keeps it as written.
 */

type JsxAttribute = {
  kind: 'boolean' | 'string' | 'expression' | 'spread';
  /** `prefix:local` for a namespaced name, '' for a spread. */
  name: string;
  /** From the name (a spread's `{`) to the end of the value. */
  start: number;
  end: number;
  /** The value with its quotes or braces; a boolean's is empty, at its name's end. */
  valueStart: number;
  valueEnd: number;
};

type JsxOpeningTag = { name: string; start: number; end: number; selfClosing: boolean; attributes: JsxAttribute[] };

/** Where reading stopped: `eof` when a value or the tag runs to the end of the source. */
type JsxTagFailure = { at: number; eof: boolean; unmodelled: boolean };

// As `estree-util-is-identifier-name` (the compiler's): JSX names may also hold `-`.
// ZWNJ and ZWJ continue a name; they are written as alternatives, not in a class.
const ID_START = /[$_\p{ID_Start}]/u;
const ID_CONTINUE = /^(?:[-$_\p{ID_Continue}]|\u200C|\u200D)$/u;
const JS_ID_CONTINUE = /^(?:[$_\p{ID_Continue}]|\u200C|\u200D)$/u;
// Markdown spaces, line endings and Unicode whitespace, as the compiler reads them.
const WHITESPACE = /\s/;
const LINE_END = /[\n\r\u2028\u2029]/;
const UNICODE_ESCAPE = /^\\u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]{1,6}\})/;
/** Keywords after which a `/` starts a regular expression and `<` a JSX element. */
const OPERATOR_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
  'extends',
]);

/** Characters read, across every call: a test counts the editor's work with it. */
export const jsxGrammarWork = { steps: 0 };

class Stop {
  constructor(readonly failure: JsxTagFailure) {}
}

/**
 * Read the opening tag starting at `source[start]` (a `<`). Returns the tag, or
 * where and why it isn't one the editor reads.
 */
export function readJsxOpeningTag(source: string, start: number): JsxOpeningTag | JsxTagFailure {
  let result: JsxOpeningTag | JsxTagFailure;
  try {
    result = readTag(source, start);
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    result = error.failure;
  }
  // The reader goes forward only, so the span it read is the work it did.
  jsxGrammarWork.steps += Math.max(1, ('end' in result ? result.end : result.at) - start);
  return result;
}

/** Whether a reading failed: anything with `attributes` (a tag, or a test's view of one) is a success. */
export const isJsxTagFailure = <T extends { attributes: unknown }>(result: T | JsxTagFailure): result is JsxTagFailure => !('attributes' in result);

function readTag(source: string, start: number): JsxOpeningTag {
  let i = start + 1;
  const fail = (at: number, unmodelled = false): never => {
    throw new Stop({ at, eof: at >= source.length, unmodelled });
  };
  const codePoint = (at: number) => {
    const value = source.codePointAt(at);
    return value === undefined ? '' : String.fromCodePoint(value);
  };
  const space = () => {
    while (i < source.length && WHITESPACE.test(source[i] ?? '')) i++;
  };
  /** An identifier (JSX: `-` allowed), or a failure at `i`. */
  const identifier = (): string => {
    const first = codePoint(i);
    if (!first || !ID_START.test(first)) fail(i);
    const from = i;
    i += first.length;
    for (let next = codePoint(i); next && ID_CONTINUE.test(next); next = codePoint(i)) i += next.length;
    return source.slice(from, i);
  };

  // `<` then the name, with no whitespace between (`< Frame` is not a tag).
  if (i >= source.length || WHITESPACE.test(source[i] ?? '') || source[i] === '/' || source[i] === '>') fail(i);
  let name = identifier();
  space();
  if (source[i] === ':') {
    i++;
    space();
    name += `:${identifier()}`;
    space();
  } else {
    while (source[i] === '.') {
      i++;
      space();
      name += `.${identifier()}`;
      space();
    }
  }

  const attributes: JsxAttribute[] = [];
  for (;;) {
    space();
    const char = source[i];
    if (char === undefined) fail(i);
    if (char === '>') return { name, start, end: i + 1, selfClosing: false, attributes };
    if (char === '/') {
      i++;
      space();
      if (source[i] !== '>') fail(i);
      return { name, start, end: i + 1, selfClosing: true, attributes };
    }
    if (char === '{') {
      const from = i;
      i = expressionEnd(source, i, true, fail);
      attributes.push({ kind: 'spread', name: '', start: from, end: i, valueStart: from, valueEnd: i });
      continue;
    }
    const from = i;
    let attributeName = identifier();
    let nameEnd = i;
    space();
    if (source[i] === ':') {
      i++;
      space();
      attributeName += `:${identifier()}`;
      nameEnd = i;
      space();
    }
    if (source[i] !== '=') {
      // A boolean attribute: what follows must start another attribute or end the tag,
      // which the next turn checks.
      i = nameEnd;
      attributes.push({ kind: 'boolean', name: attributeName, start: from, end: nameEnd, valueStart: nameEnd, valueEnd: nameEnd });
      continue;
    }
    i++;
    space();
    const quote = source[i];
    const valueStart = i;
    if (quote === '"' || quote === "'") {
      const close = source.indexOf(quote, i + 1);
      if (close < 0) fail(source.length);
      i = close + 1;
      attributes.push({ kind: 'string', name: attributeName, start: from, end: i, valueStart, valueEnd: i });
    } else if (quote === '{') {
      i = expressionEnd(source, i, false, fail);
      attributes.push({ kind: 'expression', name: attributeName, start: from, end: i, valueStart, valueEnd: i });
    } else fail(i);
  }
}

type Frame = '{' | '(' | '[' | '`' | '${';
const CLOSER: Record<string, Frame> = { '}': '{', ')': '(', ']': '[' };

/** The token before a `/` or `<`: an operand (an object literal's `}` too) makes it
 *  division or less-than; a block's `}` leaves it open, as does anything else, where
 *  it may start a regular expression or a JSX element. */
type Previous = 'start' | 'operand' | 'brace' | 'other';
/** Keywords a block may follow (`else {`, `try {`). */
const BLOCK_KEYWORDS = new Set(['else', 'try', 'finally', 'do']);

/**
 * The end (after its `}`) of the `{…}` opening at `open`. A spread holds one
 * `...value`, a value anything but a leading `...`; neither may be empty (only
 * whitespace and comments), as the compiler requires.
 *
 * Only structure is checked, and only what acorn rejects in every context fails:
 * an unclosed string, template literal, comment or bracket, a closing bracket of
 * the wrong kind, a line break inside a string. Statements, `;`, declarations,
 * getters, class bodies and the like are read as written: the editor keeps the
 * code byte for byte and never edits it. A regular expression or JSX element, which
 * would need a JavaScript parser to find, is left unread (`unmodelled`).
 */
function expressionEnd(source: string, open: number, spread: boolean, fail: (at: number, unmodelled?: boolean) => never): number {
  const stack: Frame[] = [];
  let i = open + 1;
  let content = false;
  let previous: Previous = 'start';
  // Whether a `{` here opens a block (after `)`, `=>`, `;`, `else`, or another
  // block's `{` or `}`) rather than an object literal, and which open `{` are blocks.
  let blockNext = false;
  const blocks: boolean[] = [];
  // A comma at the top of a spread: only whitespace and comments may follow it.
  let topComma = false;
  for (;;) {
    const char = source[i];
    if (char === undefined) return fail(source.length);
    const top = stack[stack.length - 1];
    if (top === '`') {
      // Template literal text, up to its closing backtick or a `${`.
      if (char === '\\') i += 2;
      else if (char === '`') {
        stack.pop();
        previous = 'operand';
        i++;
      } else if (char === '$' && source[i + 1] === '{') {
        stack.push('${');
        previous = 'start';
        i += 2;
      } else i++;
      continue;
    }
    if (WHITESPACE.test(char)) {
      i++;
      continue;
    }
    if (char === '/' && source[i + 1] === '/') {
      while (i < source.length && !LINE_END.test(source[i] ?? '')) i++;
      continue;
    }
    if (char === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      if (close < 0) return fail(source.length);
      i = close + 2;
      continue;
    }
    if (char === '}' && stack.length === 0) {
      if (!content) return fail(i);
      return i + 1;
    }
    if (stack.length === 0) {
      if (!content) {
        content = true;
        if (source.startsWith('...', i) !== spread) return fail(i);
      } else if (topComma) return fail(i);
      if (spread && char === ',') topComma = true;
    }
    if (char === '"' || char === "'") {
      i++;
      for (;;) {
        const inner = source[i];
        if (inner === undefined) return fail(source.length);
        // An unescaped line break never ends a string: acorn rejects it.
        if (inner === '\n' || inner === '\r') return fail(i);
        // A backslash escapes the next character, or a whole `\r\n` line continuation.
        if (inner === '\\') i += source.startsWith('\r\n', i + 1) ? 3 : 2;
        else {
          i++;
          if (inner === char) break;
        }
      }
      previous = 'operand';
      blockNext = false;
      continue;
    }
    if (char === '`') {
      stack.push('`');
      blockNext = false;
      i++;
      continue;
    }
    if (char === '{' || char === '(' || char === '[') {
      stack.push(char);
      if (char === '{') blocks.push(blockNext);
      else blockNext = false;
      previous = 'start';
      i++;
      continue;
    }
    if (char === '}' || char === ')' || char === ']') {
      const opened = stack.pop();
      if (opened !== CLOSER[char] && !(char === '}' && opened === '${')) return fail(i);
      const block = opened === '{' && blocks.pop() === true;
      previous = block ? 'brace' : 'operand';
      blockNext = block || char === ')';
      i++;
      continue;
    }
    if (char === '/' || char === '<') {
      // A regular expression or a JSX element: unread.
      if (previous !== 'operand') return fail(i, true);
      previous = 'other';
      blockNext = false;
      i++;
      continue;
    }
    const point = String.fromCodePoint(source.codePointAt(i) ?? 0);
    if (ID_START.test(point) || char === '#' || char === '\\') {
      const from = i;
      for (let next = point; next; next = String.fromCodePoint(source.codePointAt(i) ?? 0)) {
        if (next === '\\') i += UNICODE_ESCAPE.exec(source.slice(i, i + 12))?.[0].length ?? 1;
        else if (i === from ? ID_START.test(next) || next === '#' : JS_ID_CONTINUE.test(next)) i += next.length;
        else break;
      }
      const word = source.slice(from, i);
      previous = OPERATOR_KEYWORDS.has(word) ? 'other' : 'operand';
      blockNext = BLOCK_KEYWORDS.has(word);
      continue;
    }
    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      while (i < source.length && /[\w.]/.test(source[i] ?? '')) i++;
      previous = 'operand';
      blockNext = false;
      continue;
    }
    // Postfix `++`/`--` leave an operand before them.
    if ((char === '+' || char === '-') && source[i + 1] === char && previous === 'operand') {
      i += 2;
      continue;
    }
    // A `{` after `;` or an arrow's `=>` opens a block.
    blockNext = char === ';' || (char === '>' && source[i - 1] === '=');
    previous = 'other';
    i++;
  }
}

/**
 * Where an opening tag the grammar rejects ends, read with only the compiler's
 * lexical structure: quoted values with no escapes, and `{…}` holding JavaScript
 * strings, template literals and comments, with no syntax checks; then the first
 * `>` outside them. -1 when it never ends. The editor keeps such a tag whole, so
 * this only needs to find all of it.
 */
export function looseJsxTagEnd(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    const char = source[i];
    if (char === '>') return i + 1;
    if (char === '"' || char === "'") {
      const close = source.indexOf(char, i + 1);
      if (close < 0) return -1;
      i = close + 1;
    } else if (char === '{') {
      i = looseExpressionEnd(source, i);
      if (i < 0) return -1;
    } else i++;
  }
  return -1;
}

function looseExpressionEnd(source: string, open: number): number {
  const stack: Frame[] = ['{'];
  let i = open + 1;
  while (i < source.length) {
    const char = source[i] ?? '';
    const top = stack[stack.length - 1];
    if (top === '`') {
      if (char === '\\') i += 2;
      else if (char === '`') {
        stack.pop();
        i++;
      } else if (char === '$' && source[i + 1] === '{') {
        stack.push('${');
        i += 2;
      } else i++;
    } else if (char === '/' && source[i + 1] === '/') {
      while (i < source.length && !LINE_END.test(source[i] ?? '')) i++;
    } else if (char === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      if (close < 0) return -1;
      i = close + 2;
    } else if (char === '"' || char === "'") {
      // To its closing quote, or the end of its line, where acorn would stop it.
      for (i++; i < source.length && source[i] !== char && source[i] !== '\n'; ) i += source[i] === '\\' ? 2 : 1;
      i++;
    } else if (char === '`' || char === '{' || char === '(' || char === '[') {
      stack.push(char);
      i++;
    } else if (char === '}') {
      stack.pop();
      i++;
      if (stack.length === 0) return i;
    } else {
      if ((char === ')' && top === '(') || (char === ']' && top === '[')) stack.pop();
      i++;
    }
  }
  return -1;
}
