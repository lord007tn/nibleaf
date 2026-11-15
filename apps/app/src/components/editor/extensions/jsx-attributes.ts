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
 * ends it, regular expressions read as such (see `expressionEnd`). A JSX element
 * inside the braces, or a `/` read differently as a regular expression and as
 * division, is left unread (`unmodelled`): the caller keeps the whole component as
 * written, byte for byte, as it does an opener whose tag the compiler rejects. The
 * code inside braces is checked only for structure, never as JavaScript: the editor
 * keeps it as written.
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

/** Characters read, across every call: a test counts the editor's work with it. */
export const jsxGrammarWork = { steps: 0 };

class Stop {
  constructor(readonly failure: JsxTagFailure) {}
}

/**
 * Read the opening tag starting at `source[start]` (a `<`). Returns the tag, or
 * where and why it isn't one the editor reads. Nothing at or after `limit` is read:
 * a tag still open there fails (`eof`).
 */
export function readJsxOpeningTag(source: string, start: number, limit = source.length): JsxOpeningTag | JsxTagFailure {
  let result: JsxOpeningTag | JsxTagFailure;
  try {
    result = readTag(source, start, limit);
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

function readTag(source: string, start: number, limit: number): JsxOpeningTag {
  let i = start + 1;
  const fail = (at: number, unmodelled = false): never => {
    throw new Stop({ at, eof: at >= limit, unmodelled });
  };
  const ch = (at: number) => (at < limit ? source[at] : undefined);
  const codePoint = (at: number) => {
    const value = at < limit ? source.codePointAt(at) : undefined;
    return value === undefined ? '' : String.fromCodePoint(value);
  };
  const space = () => {
    while (i < limit && WHITESPACE.test(source[i] ?? '')) i++;
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
  if (i >= limit || WHITESPACE.test(source[i] ?? '') || source[i] === '/' || source[i] === '>') fail(i);
  let name = identifier();
  space();
  if (ch(i) === ':') {
    i++;
    space();
    name += `:${identifier()}`;
    space();
  } else {
    while (ch(i) === '.') {
      i++;
      space();
      name += `.${identifier()}`;
      space();
    }
  }

  const attributes: JsxAttribute[] = [];
  for (;;) {
    space();
    const char = ch(i);
    if (char === undefined) fail(i);
    if (char === '>') return { name, start, end: i + 1, selfClosing: false, attributes };
    if (char === '/') {
      i++;
      space();
      if (ch(i) !== '>') fail(i);
      return { name, start, end: i + 1, selfClosing: true, attributes };
    }
    if (char === '{') {
      const from = i;
      i = expressionEnd(source, i, true, fail, limit);
      attributes.push({ kind: 'spread', name: '', start: from, end: i, valueStart: from, valueEnd: i });
      continue;
    }
    const from = i;
    let attributeName = identifier();
    let nameEnd = i;
    space();
    if (ch(i) === ':') {
      i++;
      space();
      attributeName += `:${identifier()}`;
      nameEnd = i;
      space();
    }
    if (ch(i) !== '=') {
      // A boolean attribute: what follows must start another attribute or end the tag,
      // which the next turn checks.
      i = nameEnd;
      attributes.push({ kind: 'boolean', name: attributeName, start: from, end: nameEnd, valueStart: nameEnd, valueEnd: nameEnd });
      continue;
    }
    i++;
    space();
    const quote = ch(i);
    const valueStart = i;
    if (quote === '"' || quote === "'") {
      const close = source.indexOf(quote, i + 1);
      if (close < 0 || close >= limit) fail(limit);
      i = close + 1;
      attributes.push({ kind: 'string', name: attributeName, start: from, end: i, valueStart, valueEnd: i });
    } else if (quote === '{') {
      i = expressionEnd(source, i, false, fail, limit);
      attributes.push({ kind: 'expression', name: attributeName, start: from, end: i, valueStart, valueEnd: i });
    } else fail(i);
  }
}

/** What a `{` opened: an object literal, a block statement, or the body of a
 *  function, arrow function or class. `expression` says whether a function or
 *  class body belongs to an expression, after which `/` is division. */
type Brace = { kind: '{'; brace: 'object' | 'block' | 'function' | 'arrow' | 'class'; expression: boolean };
type Frame =
  | Brace
  /** `header`: the parentheses of `if (…)`, `for (…)` and the like; `params`: a
   *  function's parameters (`expression` as for its body). */
  | { kind: '('; role: 'header' | 'params' | 'plain'; expression: boolean }
  | { kind: '[' }
  | { kind: '`' }
  | { kind: '${' };

/**
 * The previous significant token, which decides what a `/`, `<` or `{` is:
 * - `operand`: an identifier, literal, `)`, `]`, or the `}` of an expression: `/` is
 *   division, `<` an operator (`<`, `<<`, `<=`);
 * - `operator`: punctuation, an expression keyword (`return`, `typeof`), the start:
 *   `/` starts a regular expression, `<` a JSX element, `{` an object literal;
 * - `statement`: the start of a statement in a block (after `{`, `;`, a statement's
 *   `}`): `{` opens a block, `function` and `class` are declarations;
 * - `dot`: after `.` or `?.`, a keyword is a property name, so an operand;
 * - `arrow`, `params`, `header`, `blockKeyword`: what the next `{` opens;
 * - `ambiguous`: after a word that is a keyword or an identifier by context
 *   (`yield`, `await`, `let`), or an arrow body's `}`: both readings are tried.
 */
type Previous = 'operand' | 'operator' | 'statement' | 'dot' | 'arrow' | 'params' | 'header' | 'blockKeyword' | 'ambiguous';

type ScanState = {
  i: number;
  stack: Frame[];
  previous: Previous;
  /** The last token closed plain parentheses: a `{` after it is a method's body. */
  afterPlainParens: boolean;
  /** After `function`, until its parameters open: whether it's an expression. */
  pendingFunction: boolean | null;
  /** After `if`, `for`, `while`, `with`, `switch` or `catch`, until its `(`. */
  pendingHeader: boolean;
  /** After `class`: the depth its body opens at, and whether it's an expression. */
  pendingClass: { depth: number; expression: boolean } | null;
  /** Whether the parameters just closed belong to a function expression. */
  paramsExpression: boolean;
  content: boolean;
  topComma: boolean;
};

/** Keywords after which a `/` starts a regular expression and `<` a JSX element. */
const EXPRESSION_KEYWORDS = new Set([
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
  'extends',
  'const',
  'var',
]);
/** Keywords a block follows (`else {`, `try {`). */
const BLOCK_KEYWORDS = new Set(['else', 'try', 'finally', 'do']);
/** Keywords whose `(…)` is a statement's header (`if (…) {`). */
const HEADER_KEYWORDS = new Set(['if', 'for', 'while', 'with', 'switch', 'catch']);
/** Words that are keywords in some contexts and identifiers in others. */
const CONTEXTUAL_WORDS = new Set(['yield', 'await', 'let']);
/** Readings of an undecidable `/` tried per expression, both ways; past it, unread. */
const FORK_BUDGET = 8;

class ExpressionStop {
  constructor(
    readonly at: number,
    readonly unmodelled: boolean,
  ) {}
}

/**
 * The end (after its `}`) of the `{…}` opening at `open`. A spread holds one
 * `...value`, a value anything but a leading `...`; neither may be empty (only
 * whitespace and comments), as the compiler requires.
 *
 * Tokens are read with the previous-significant-token rule (see `Previous`), so a
 * regular expression is read as one (`/"}/`), and division after `)`, `]`, an
 * identifier, a literal, an object literal or a function expression is division.
 * Only structure is checked, plus what acorn rejects in every context: an unclosed
 * string, template literal, comment, regular expression or bracket, a closing
 * bracket of the wrong kind, a line break inside a string. Statements, `;`,
 * declarations, getters, class bodies and the like are read as written. A `/` the
 * rule can't decide is read both ways, and read only if both end the expression in
 * the same place; a JSX element is left unread (`unmodelled`).
 */
function expressionEnd(source: string, open: number, spread: boolean, fail: (at: number, unmodelled?: boolean) => never, limit: number): number {
  let forks = 0;
  const src = (at: number) => (at < limit ? source[at] : undefined);
  const stop = (at: number, unmodelled = false): never => {
    throw new ExpressionStop(at, unmodelled);
  };
  const attempt = (read: () => number): number | null => {
    try {
      return read();
    } catch (error) {
      if (error instanceof ExpressionStop) return null;
      throw error;
    }
  };
  const regexEnd = (at: number): number => {
    let j = at + 1;
    let inClass = false;
    for (;;) {
      const char = src(j);
      if (char === undefined || LINE_END.test(char)) return stop(j);
      if (char === '\\') j += 2;
      else {
        j++;
        if (inClass) inClass = char !== ']';
        else if (char === '[') inClass = true;
        else if (char === '/') break;
      }
    }
    while (j < limit && JS_ID_CONTINUE.test(source[j] ?? '')) j++;
    return j;
  };

  function scan(state: ScanState): number {
    const s = state;
    for (;;) {
      const char = src(s.i);
      if (char === undefined) return stop(limit);
      const top = s.stack[s.stack.length - 1];
      if (top?.kind === '`') {
        // Template literal text, up to its closing backtick or a `${`.
        if (char === '\\') s.i += 2;
        else if (char === '`') {
          s.stack.pop();
          s.previous = 'operand';
          s.i++;
        } else if (char === '$' && source[s.i + 1] === '{') {
          s.stack.push({ kind: '${' });
          s.previous = 'operator';
          s.i += 2;
        } else s.i++;
        continue;
      }
      if (WHITESPACE.test(char)) {
        s.i++;
        continue;
      }
      if (char === '/' && source[s.i + 1] === '/') {
        while (s.i < limit && !LINE_END.test(source[s.i] ?? '')) s.i++;
        continue;
      }
      if (char === '/' && source[s.i + 1] === '*') {
        const close = source.indexOf('*/', s.i + 2);
        if (close < 0 || close + 2 > limit) return stop(limit);
        s.i = close + 2;
        continue;
      }
      if (char === '}' && s.stack.length === 0) {
        if (!s.content) return stop(s.i);
        return s.i + 1;
      }
      if (s.stack.length === 0) {
        if (!s.content) {
          s.content = true;
          if (source.startsWith('...', s.i) !== spread) return stop(s.i);
        } else if (s.topComma) return stop(s.i);
        if (spread && char === ',') s.topComma = true;
      }
      const afterPlainParens = s.afterPlainParens;
      s.afterPlainParens = false;
      if (char === '"' || char === "'") {
        s.i++;
        for (;;) {
          const inner = src(s.i);
          if (inner === undefined) return stop(limit);
          // An unescaped line break never ends a string: acorn rejects it.
          if (inner === '\n' || inner === '\r') return stop(s.i);
          // A backslash escapes the next character, or a whole `\r\n` line continuation.
          if (inner === '\\') s.i += source.startsWith('\r\n', s.i + 1) ? 3 : 2;
          else {
            s.i++;
            if (inner === char) break;
          }
        }
        s.previous = 'operand';
        continue;
      }
      if (char === '`') {
        s.stack.push({ kind: '`' });
        s.i++;
        continue;
      }
      if (char === '(') {
        const role = s.pendingHeader ? 'header' : s.pendingFunction !== null ? 'params' : 'plain';
        s.stack.push({ kind: '(', role, expression: s.pendingFunction ?? true });
        s.pendingHeader = false;
        s.pendingFunction = null;
        s.previous = 'operator';
        s.i++;
        continue;
      }
      if (char === '[') {
        s.stack.push({ kind: '[' });
        s.previous = 'operator';
        s.i++;
        continue;
      }
      if (char === '{') {
        let brace: Brace;
        if (s.pendingClass && s.pendingClass.depth === s.stack.length) {
          brace = { kind: '{', brace: 'class', expression: s.pendingClass.expression };
          s.pendingClass = null;
        } else if (s.previous === 'arrow') brace = { kind: '{', brace: 'arrow', expression: true };
        else if (s.pendingHeader) {
          // `catch {`, with no binding.
          brace = { kind: '{', brace: 'block', expression: false };
          s.pendingHeader = false;
        } else if (s.previous === 'params') brace = { kind: '{', brace: 'function', expression: s.paramsExpression };
        else if (s.previous === 'operand' && afterPlainParens) brace = { kind: '{', brace: 'function', expression: true };
        else if (s.previous === 'header' || s.previous === 'statement' || s.previous === 'blockKeyword')
          brace = { kind: '{', brace: 'block', expression: false };
        else brace = { kind: '{', brace: 'object', expression: true };
        s.stack.push(brace);
        s.previous = brace.brace === 'object' ? 'operator' : 'statement';
        s.i++;
        continue;
      }
      if (char === '}' || char === ')' || char === ']') {
        const opened = s.stack.pop();
        if (char === ')') {
          if (opened?.kind !== '(') return stop(s.i);
          if (opened.role === 'header') s.previous = 'header';
          else if (opened.role === 'params') {
            s.previous = 'params';
            s.paramsExpression = opened.expression;
          } else {
            s.previous = 'operand';
            s.afterPlainParens = true;
          }
        } else if (char === ']') {
          if (opened?.kind !== '[') return stop(s.i);
          s.previous = 'operand';
        } else if (opened?.kind === '${') s.previous = 'operand';
        else if (opened?.kind === '{') {
          if (opened.brace === 'block') s.previous = 'statement';
          else if (opened.brace === 'arrow') s.previous = 'ambiguous';
          else s.previous = opened.expression ? 'operand' : 'statement';
        } else return stop(s.i);
        s.i++;
        continue;
      }
      if (char === '/') {
        if (s.previous === 'operand') {
          s.previous = 'operator';
          s.i++;
          continue;
        }
        if (s.previous === 'dot') return stop(s.i);
        if (s.previous === 'ambiguous') {
          // Read it both ways: as a regular expression and as division.
          if (++forks > FORK_BUDGET) return stop(s.i, true);
          const one = attempt(() => scan({ ...s, stack: [...s.stack], i: regexEnd(s.i), previous: 'operand' }));
          const other = attempt(() => scan({ ...s, stack: [...s.stack], i: s.i + 1, previous: 'operator' }));
          if (one !== null && one === other) return one;
          return stop(s.i, true);
        }
        s.i = regexEnd(s.i);
        s.previous = 'operand';
        continue;
      }
      if (char === '<') {
        // After an operand, `<`, `<<`, `<=` or `<<=`; anywhere else a JSX element: unread.
        if (s.previous !== 'operand') return stop(s.i, true);
        s.i += source[s.i + 1] === '<' ? 2 : 1;
        if (source[s.i] === '=') s.i++;
        s.previous = 'operator';
        continue;
      }
      const point = String.fromCodePoint(source.codePointAt(s.i) ?? 0);
      if (ID_START.test(point) || char === '#' || char === '\\') {
        const from = s.i;
        for (let next = point; next; next = String.fromCodePoint(source.codePointAt(s.i) ?? 0)) {
          if (next === '\\') s.i += UNICODE_ESCAPE.exec(source.slice(s.i, s.i + 12))?.[0].length ?? 1;
          else if (s.i === from ? ID_START.test(next) || next === '#' : JS_ID_CONTINUE.test(next)) s.i += next.length;
          else break;
        }
        const word = source.slice(from, s.i);
        const atStatement = s.previous === 'statement';
        if (s.previous === 'dot') s.previous = 'operand';
        else if (word === 'function') {
          s.pendingFunction = !atStatement;
          s.previous = 'operator';
        } else if (word === 'class') {
          s.pendingClass = { depth: s.stack.length, expression: !atStatement };
          s.previous = 'operator';
        } else if (HEADER_KEYWORDS.has(word)) {
          s.pendingHeader = true;
          s.previous = 'operator';
        } else if (BLOCK_KEYWORDS.has(word)) s.previous = 'blockKeyword';
        else if (EXPRESSION_KEYWORDS.has(word)) s.previous = 'operator';
        else if (CONTEXTUAL_WORDS.has(word)) s.previous = 'ambiguous';
        else s.previous = 'operand';
        // `function*`'s star and its name keep it pending, as does `class Name extends …`.
        continue;
      }
      if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(source[s.i + 1] ?? ''))) {
        while (s.i < limit && /[\w.]/.test(source[s.i] ?? '')) s.i++;
        s.previous = 'operand';
        continue;
      }
      if (char === '.') {
        if (source.startsWith('...', s.i)) {
          s.i += 3;
          s.previous = 'operator';
        } else {
          s.i++;
          s.previous = 'dot';
        }
        continue;
      }
      if (char === '?' && source[s.i + 1] === '.' && !/[0-9]/.test(source[s.i + 2] ?? '')) {
        s.i += 2;
        s.previous = 'dot';
        continue;
      }
      if (char === '=' && source[s.i + 1] === '>') {
        s.i += 2;
        s.previous = 'arrow';
        continue;
      }
      // Postfix `++`/`--` leave an operand before them.
      if ((char === '+' || char === '-') && source[s.i + 1] === char && s.previous === 'operand') {
        s.i += 2;
        continue;
      }
      const inBlock = top?.kind === '{' && top.brace !== 'object';
      s.previous = char === ';' && inBlock ? 'statement' : char === '*' && s.pendingFunction !== null ? s.previous : 'operator';
      s.i++;
    }
  }

  try {
    return scan({
      i: open + 1,
      stack: [],
      previous: 'operator',
      afterPlainParens: false,
      pendingFunction: null,
      pendingHeader: false,
      pendingClass: null,
      paramsExpression: true,
      content: false,
      topComma: false,
    });
  } catch (error) {
    if (error instanceof ExpressionStop) return fail(error.at, error.unmodelled);
    throw error;
  }
}

/**
 * Where an opening tag the grammar rejects ends, read with only the compiler's
 * lexical structure: quoted values with no escapes, and `{…}` holding JavaScript
 * strings, template literals, comments and regular expressions, with no syntax
 * checks; then the first `>` outside them. -1 when it doesn't end before `limit`
 * (the caller passes where the component's closing tag, or another opener of its
 * name, starts). The editor keeps such a tag whole, so this only needs to find all
 * of it.
 */
export function looseJsxTagEnd(source: string, start: number, limit = source.length): number {
  let i = start + 1;
  while (i < limit) {
    const char = source[i];
    if (char === '>') return i + 1;
    if (char === '"' || char === "'") {
      const close = source.indexOf(char, i + 1);
      if (close < 0 || close >= limit) return -1;
      i = close + 1;
    } else if (char === '{') {
      i = looseExpressionEnd(source, i, limit);
      if (i < 0) return -1;
    } else i++;
  }
  return -1;
}

/** Punctuation after which a `/` starts a regular expression (loosely). */
const REGEX_AFTER = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);

function looseExpressionEnd(source: string, open: number, limit: number): number {
  const stack: Array<'{' | '(' | '[' | '`' | '${'> = ['{'];
  let i = open + 1;
  // The last significant character, or word, before a `/`.
  let last = '';
  while (i < limit) {
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
      last = '`';
      continue;
    }
    if (WHITESPACE.test(char)) {
      i++;
      continue;
    }
    if (char === '/' && source[i + 1] === '/') {
      while (i < limit && !LINE_END.test(source[i] ?? '')) i++;
    } else if (char === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      if (close < 0 || close >= limit) return -1;
      i = close + 2;
    } else if (char === '/' && (REGEX_AFTER.has(last) || EXPRESSION_KEYWORDS.has(last))) {
      // A regular expression, to its closing `/` on this line; or else just a `/`.
      let j = i + 1;
      let inClass = false;
      while (j < limit && !LINE_END.test(source[j] ?? '') && (inClass || source[j] !== '/')) {
        if (source[j] === '\\') j++;
        else if (source[j] === '[') inClass = true;
        else if (source[j] === ']') inClass = false;
        j++;
      }
      i = source[j] === '/' ? j + 1 : i + 1;
      last = 'regex';
    } else if (char === '"' || char === "'") {
      // To its closing quote, or the end of its line, where acorn would stop it.
      for (i++; i < limit && source[i] !== char && source[i] !== '\n'; ) i += source[i] === '\\' ? 2 : 1;
      i++;
      last = 'string';
    } else if (char === '`' || char === '{' || char === '(' || char === '[') {
      stack.push(char);
      i++;
      last = char;
    } else if (char === '}') {
      stack.pop();
      i++;
      if (stack.length === 0) return i;
      last = char;
    } else if (/[\w$]/.test(char)) {
      const from = i;
      while (i < limit && /[\w$]/.test(source[i] ?? '')) i++;
      last = source.slice(from, i);
    } else {
      if ((char === ')' && top === '(') || (char === ']' && top === '[')) stack.pop();
      i++;
      last = char;
    }
  }
  return -1;
}
