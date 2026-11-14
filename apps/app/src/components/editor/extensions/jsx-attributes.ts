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
 * (`unmodelled`): the caller keeps the whole component as written, byte for byte.
 * So does any opener the compiler rejects. The reader doesn't check that the code
 * inside braces is valid JavaScript; it keeps it as written.
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

/** The token before the current one: what may follow it. */
type Previous = 'start' | 'operand' | 'operator' | 'open' | 'comma';

/**
 * The end (after its `}`) of the `{…}` opening at `open`. A spread holds one
 * `...value`, a value anything but a leading `...`; neither may be empty (only
 * whitespace and comments), as the compiler requires. Token by token, it also
 * rejects what acorn always rejects there: an operator right before a closing
 * bracket, two operands in a row, a backslash outside strings and identifiers.
 */
function expressionEnd(source: string, open: number, spread: boolean, fail: (at: number, unmodelled?: boolean) => never): number {
  const stack: Frame[] = [];
  let i = open + 1;
  let content = false;
  let previous: Previous = 'start';
  // `>`s in a row after an operand (`>`, `>>`, `>>>`), or 3 after `=>`.
  let greater = 0;
  // A comma at the top of a spread: only whitespace and comments may follow it.
  let topComma = false;
  const operandStart = (at: number) => {
    if (previous === 'operand') fail(at);
    previous = 'operand';
  };
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
        previous = 'open';
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
    if (char !== '>') greater = 0;
    if (char === '}' && stack.length === 0) {
      if (!content || previous === 'operator') return fail(i);
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
      operandStart(i);
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
      continue;
    }
    if (char === '`') {
      // After an operand, a tagged template.
      stack.push('`');
      i++;
      continue;
    }
    if (char === '{' || char === '(' || char === '[') {
      stack.push(char);
      previous = 'open';
      i++;
      continue;
    }
    if (char === '}' || char === ')' || char === ']') {
      const opened = stack.pop();
      if ((opened !== CLOSER[char] && !(char === '}' && opened === '${')) || previous === 'operator') return fail(i);
      previous = 'operand';
      i++;
      continue;
    }
    if (char === '/' || char === '<') {
      // A regular expression or a JSX element: unread.
      if (previous !== 'operand') return fail(i, true);
      previous = 'operator';
      i++;
      continue;
    }
    if (char === '>') {
      // After an operand, or continuing `>>`/`>>>`, or ending `=>`; acorn rejects any other.
      if (previous === 'operand') greater = 1;
      else if (source[i - 1] === '>' && greater > 0 && greater < 3) greater++;
      else if (source[i - 1] === '=') greater = 3;
      else return fail(i);
      previous = 'operator';
      i++;
      continue;
    }
    if ((char === '+' || char === '-') && source[i + 1] === char && previous === 'operand') {
      // Postfix `++`/`--`: still an operand.
      i += 2;
      continue;
    }
    const point = String.fromCodePoint(source.codePointAt(i) ?? 0);
    if (ID_START.test(point) || char === '#' || char === '\\') {
      const from = i;
      for (let next = point; next; next = String.fromCodePoint(source.codePointAt(i) ?? 0)) {
        // Outside strings, templates and comments a backslash only starts an
        // identifier's `\u` escape; anywhere else acorn rejects it.
        if (next === '\\') {
          const unicodeEscape = UNICODE_ESCAPE.exec(source.slice(i, i + 12));
          if (!unicodeEscape) return fail(i);
          i += unicodeEscape[0].length;
        } else if (i === from ? ID_START.test(next) || next === '#' : JS_ID_CONTINUE.test(next)) i += next.length;
        else break;
      }
      if (OPERATOR_KEYWORDS.has(source.slice(from, i))) previous = 'operator';
      else operandStart(from);
      continue;
    }
    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      operandStart(i);
      while (i < source.length && /[\w.]/.test(source[i] ?? '')) i++;
      continue;
    }
    // Any other punctuation is an operator; a comma may also come before a closing bracket.
    previous = char === ',' ? 'comma' : 'operator';
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
