import { DOCUMENTATION_COMPONENT_CONTRACT } from './documentation-component-contract';
import { type MarkdownBlockLineKind, markdownBlockLineKinds } from './markdown-code';

/** The largest page body a write may store, in UTF-8 bytes (2 MiB). Editor
 *  saves, MCP writes, import and Git sync share it: public `.md`/llms output and
 *  exports are built from page content. */
export const MAX_PAGE_CONTENT_BYTES = 2 * 1024 * 1024;

/**
 * Bounded synchronous Markdown parsing for the reader and publish checks.
 *
 * Code (fenced, indented and inline) is never parsed as Markdown, so the line
 * and tag limits skip it. Only real elements nest: HTML elements, the
 * registry's components and tags that are closed somewhere on the page. A
 * generic such as `Promise<User>` doesn't nest anything, and neither do void
 * or optional-close elements (`<br>`, `<li>`, `<p>`). Prose lines may be long:
 * a whole chapter in one paragraph is ordinary in Arabic.
 */
export const MARKDOWN_PARSE_LIMITS = {
  pageBytes: 512 * 1024,
  lineCharacters: 128 * 1024,
  syntaxMarkers: 1024,
  nesting: 64,
} as const;

export type MarkdownParseLimit = keyof typeof MARKDOWN_PARSE_LIMITS;

/** The first place a page goes over a limit. */
export interface MarkdownParseOverflow {
  limit: MarkdownParseLimit;
  /** The line, numbered from 1 as the editor numbers them; 0 for the page size. */
  line: number;
  /** What was measured: UTF-8 bytes of the page, or the line's characters, markers or nesting levels. */
  amount: number;
  /** For `nesting`: what nests, tags or the line's own quotes, list markers and brackets. */
  nesting?: 'tags' | 'markers';
}

/** A page read against the parse budget. */
export interface MarkdownParseBudget {
  /** The first limit the page exceeds, or null when it is within budget. */
  overflow: MarkdownParseOverflow | null;
  /** Over the size cap nothing is parsed: the whole page shows as plain text. */
  whole: boolean;
  /** The blocks over budget, as 0-based [first, last] lines of `source.split('\n')`. */
  regions: ReadonlyArray<readonly [first: number, last: number]>;
  /** What the parsers read: the source with each region in a plain-text fence. */
  content: string;
}

/** The fence language of a region shown as plain text; the reader draws it as wrapped text, not code. */
export const MARKDOWN_PLAIN_LANGUAGE = 'nibleaf-plain';

const OPENERS = '[({';
const CLOSERS = '])}';
// Inline syntax only. `-`, `+`, `#` and `!` mean something at the start of a
// line (counted as nesting) or before `[`, not inside prose like "well-known";
// `(` and `)` only after `](`, not around an aside. Their depth still counts.
const INLINE_SYNTAX = '[]{}<>`*_~|\\';
const NESTED_BLOCK_START = /[ \t]*(?:>|(?:[-*+]|\d{1,9}[.)])[ \t]+)/y;
/** With a `-`: a table's delimiter row (`| --- | :-: |`), a thematic break or a setext underline. */
const DELIMITER_ROW = /^[ \t>|:-]*$/;
// A complete CommonMark open or closing tag on one line, no more permissive than the spec.
const HTML_TAG =
  /<[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:[^ \t"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t]*\/?>|<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>/y;
/** Where raw HTML (a tag, comment, declaration) or an autolink may start. */
const MAY_START_HTML = /[A-Za-z/!?]/;
/** Any tag, as the reader's HTML and MDX parsers may read it, across lines. */
const TAG = /<(\/?)([A-Za-z][\w.:-]*)(?=[\s/>])[^<>]*>/g;

const COMPONENTS: ReadonlySet<string> = new Set(Object.keys(DOCUMENTATION_COMPONENT_CONTRACT));
const NOT_NESTING = new Set(
  // Void elements, and elements whose end tag may be left out.
  'area base br col embed hr img input link meta param source track wbr keygen li p dt dd tr td th thead tbody tfoot option optgroup rt rp colgroup caption html head body'.split(
    ' ',
  ),
);
const HTML_ELEMENTS = new Set(
  [
    // HTML
    'a abbr address article aside audio b bdi bdo big blockquote button canvas center cite code data datalist del details dfn dialog dir div dl em fieldset figcaption figure font footer form frameset h1 h2 h3 h4 h5 h6 header hgroup i iframe ins kbd label legend main map mark marquee menu meter nav nobr noframes noscript object ol output picture pre progress q ruby s samp script search section select slot small span strike strong style sub summary sup table template textarea time title tt u ul var video',
    // SVG and MathML
    'svg g defs symbol use path circle ellipse line polyline polygon rect text tspan textpath clippath mask pattern lineargradient radialgradient stop filter marker foreignobject image desc switch math mrow mi mo mn ms mtext msup msub msubsup mfrac msqrt mroot mtable mtr mtd semantics annotation',
  ]
    .join(' ')
    .split(' '),
);
/** How tags compare: registry components by their exact name, everything else as HTML does. */
const tagKey = (name: string) => (COMPONENTS.has(name) ? name : name.toLowerCase());

interface SourceLine {
  text: string;
  start: number;
  end: number;
  /** 0-based line of `source.split('\n')` (a lone CR also ends a line for the parser). */
  index: number;
}

const sourceLines = (source: string): SourceLine[] => {
  const lines: SourceLine[] = [];
  let start = 0;
  let index = 0;
  for (const match of source.matchAll(/\r\n|\r|\n/g)) {
    lines.push({ text: source.slice(start, match.index), start, end: match.index, index });
    if (match[0] !== '\r') index++;
    start = match.index + match[0].length;
  }
  lines.push({ text: source.slice(start), start, end: source.length, index });
  return lines;
};

/** One prose line, read the way inline Markdown reads it. */
interface InlineLine {
  markers: number;
  /** The deepest `[({` nesting outside code. */
  brackets: number;
  /** Inline code spans, as [start, end) offsets in the line, that hold no Markdown. */
  code: Array<[number, number]>;
  /** Whether a later line of the same paragraph could pair differently (see `readInline`). */
  uncertain: boolean;
}

/**
 * Markers and bracket depth on one line, outside inline code and outside the
 * attributes of a complete tag (an SVG path is not Markdown).
 *
 * A code span is skipped only when its pairing is certain: inline parsing runs
 * over the whole paragraph, so a backtick left open on an earlier line, raw HTML
 * this scan can't bound, or a table cell boundary (`|`) inside a span could pair
 * the backticks differently. From the first such doubt to the end of the
 * paragraph everything is counted, which never undercounts. Linear: each run of
 * backticks finds its closer through a forward-only pointer per length.
 */
const readInline = (text: string, doubtful: boolean): InlineLine => {
  const runs = new Map<number, number[]>();
  for (let at = text.indexOf('`'); at !== -1; ) {
    let end = at + 1;
    while (text[end] === '`') end++;
    const starts = runs.get(end - at);
    if (starts) starts.push(at);
    else runs.set(end - at, [at]);
    at = text.indexOf('`', end);
  }
  const pointers = new Map<number, number>();
  const closerAfter = (length: number, from: number): number => {
    const starts = runs.get(length) ?? [];
    let pointer = pointers.get(length) ?? 0;
    while (pointer < starts.length && (starts[pointer] as number) < from) pointer++;
    pointers.set(length, pointer);
    return starts[pointer] ?? -1;
  };
  let uncertain = doubtful;
  let markers = 0;
  let depth = 0;
  let brackets = 0;
  const code: Array<[number, number]> = [];
  for (let at = 0; at < text.length; ) {
    const char = text[at] as string;
    if (char === '\\') {
      markers++;
      at += 2;
      continue;
    }
    if (char === '`') {
      let end = at + 1;
      while (text[end] === '`') end++;
      const close = uncertain ? -1 : closerAfter(end - at, end);
      if (close !== -1 && !text.slice(end, close).includes('|')) {
        code.push([at, close + end - at]);
        markers += 2;
        at = close + end - at;
        continue;
      }
      // Left open on this line, or pairing across a table cell: a later line may close it.
      uncertain = true;
      markers += end - at;
      at = end;
      continue;
    }
    if (char === '<' && MAY_START_HTML.test(text[at + 1] ?? '') && !uncertain) {
      HTML_TAG.lastIndex = at;
      const tag = HTML_TAG.exec(text)?.[0];
      if (tag && !tag.includes('`') && !tag.includes('|')) {
        markers += 2;
        at += tag.length;
        continue;
      }
      uncertain = true;
    }
    if (OPENERS.includes(char)) brackets = Math.max(brackets, ++depth);
    else if (CLOSERS.includes(char) && depth) depth--;
    if (INLINE_SYNTAX.includes(char)) markers++;
    at++;
  }
  return { markers, brackets, code, uncertain };
};

const nestedBlockStarts = (text: string): number => {
  NESTED_BLOCK_START.lastIndex = 0;
  let blocks = 0;
  while (NESTED_BLOCK_START.test(text)) blocks++;
  return blocks;
};

const isCode = (kind: MarkdownBlockLineKind | undefined) => kind === 'code' || kind === 'indented';

/** What one line exceeds on its own, if anything. */
const lineOverflow = (line: SourceLine, inline: InlineLine | undefined): MarkdownParseOverflow | null => {
  const at = line.index + 1;
  if (line.text.length > MARKDOWN_PARSE_LIMITS.lineCharacters) return { limit: 'lineCharacters', line: at, amount: line.text.length };
  if (!inline) return null;
  const nesting = Math.max(nestedBlockStarts(line.text), inline.brackets);
  if (nesting > MARKDOWN_PARSE_LIMITS.nesting) return { limit: 'nesting', line: at, amount: nesting, nesting: 'markers' };
  if (inline.markers > MARKDOWN_PARSE_LIMITS.syntaxMarkers && !(DELIMITER_ROW.test(line.text) && line.text.includes('-')))
    return { limit: 'syntaxMarkers', line: at, amount: inline.markers };
  return null;
};

interface TagEvent {
  line: number;
  key: string;
  closing: boolean;
}

/** The tags outside code, in order, keeping only those that nest. */
const nestingTags = (
  source: string,
  lines: readonly SourceLine[],
  kinds: readonly MarkdownBlockLineKind[],
  inline: ReadonlyArray<InlineLine | undefined>,
) => {
  // Code reads as spaces, so a tag is never found in it and offsets stay put.
  let masked = '';
  let copied = 0;
  for (const [index, line] of lines.entries()) {
    const spans: Array<[number, number]> = isCode(kinds[index]) ? [[0, line.text.length]] : (inline[index]?.code ?? []);
    for (const [from, to] of spans) {
      masked += source.slice(copied, line.start + from) + ' '.repeat(to - from);
      copied = line.start + to;
    }
  }
  masked += source.slice(copied);
  const found: Array<{ at: number; key: string; closing: boolean; selfClosing: boolean }> = [];
  const closed = new Set<string>();
  for (const match of masked.matchAll(TAG)) {
    const key = tagKey(match[2] ?? '');
    const closing = match[1] === '/';
    if (closing) closed.add(key);
    found.push({ at: match.index, key, closing, selfClosing: match[0].endsWith('/>') });
  }
  const events: TagEvent[] = [];
  let line = 0;
  for (const tag of found) {
    if (tag.selfClosing || NOT_NESTING.has(tag.key)) continue;
    if (!(COMPONENTS.has(tag.key) || HTML_ELEMENTS.has(tag.key) || closed.has(tag.key))) continue;
    while (line + 1 < lines.length && (lines[line + 1]?.start ?? 0) <= tag.at) line++;
    events.push({ line, key: tag.key, closing: tag.closing });
  }
  return events;
};

const BUDGET_MEMO_LIMIT = 8;
const budgetMemo = new Map<string, MarkdownParseBudget>();

/**
 * Reads a page against the parse budget. Within it, `content` is the source
 * itself. Past a line or nesting limit, only the top-level blocks that go over
 * it (from the blank line before to the blank line after, never splitting a
 * fence or an HTML block) are put in a `nibleaf-plain` fence: the reader shows
 * their text as written and everything else as usual. A tag nested too deep
 * takes the block it opens in through the block it closes in (or the end of
 * the page). Only the page size can't be localized: past it, `whole` is set.
 * Linear in the source, and the same on the server and in the browser.
 */
export const markdownParseBudget = (source: string): MarkdownParseBudget => {
  const memo = budgetMemo.get(source);
  if (memo) return memo;
  const budget = readBudget(source);
  if (budgetMemo.size >= BUDGET_MEMO_LIMIT) budgetMemo.delete(budgetMemo.keys().next().value ?? '');
  budgetMemo.set(source, budget);
  return budget;
};

const readBudget = (source: string): MarkdownParseBudget => {
  if (exceedsUtf8Bytes(source, MARKDOWN_PARSE_LIMITS.pageBytes)) {
    const last = source.split('\n').length - 1;
    return { overflow: { limit: 'pageBytes', line: 0, amount: utf8ByteLength(source) }, whole: true, regions: [[0, last]], content: source };
  }
  const lines = sourceLines(source);
  const kinds = markdownBlockLineKinds(lines.map((line) => line.text));
  const inline: Array<InlineLine | undefined> = [];
  let doubtful = false;
  for (const [index, line] of lines.entries()) {
    const kind = kinds[index];
    const blank = !line.text.trim();
    if (isCode(kind) || blank) {
      doubtful = false;
      inline.push(undefined);
      continue;
    }
    // A line longer than the limit is over budget whatever it holds.
    const read: InlineLine | undefined = line.text.length > MARKDOWN_PARSE_LIMITS.lineCharacters ? undefined : readInline(line.text, doubtful);
    doubtful = kind === 'html' ? false : (read?.uncertain ?? true);
    inline.push(read ?? { markers: 0, brackets: 0, code: [], uncertain: true });
  }
  const events = nestingTags(source, lines, kinds, inline);

  // A block runs between blank lines that are prose (a blank line in a fence or
  // a comment is not a boundary).
  const boundary = (index: number) => kinds[index] === 'prose' && !lines[index]?.text.trim();
  const blockStart = (index: number) => {
    let at = index;
    while (at > 0 && !boundary(at - 1)) at--;
    return at;
  };
  const blockEnd = (index: number) => {
    let at = index;
    while (at + 1 < lines.length && !boundary(at + 1)) at++;
    return at;
  };

  const regions: Array<[number, number]> = [];
  let overflow: MarkdownParseOverflow | null = null;
  const stack: Array<{ key: string; line: number }> = [];
  /** Marks lines `first`..`last` (extended to their blocks) as plain; returns the region's last line. */
  const addRegion = (first: number, last: number, found: MarkdownParseOverflow): number => {
    overflow ??= found;
    const from = blockStart(first);
    const to = blockEnd(last);
    const previous = regions.at(-1);
    if (previous && from <= previous[1] + 1) previous[1] = Math.max(previous[1], to);
    else regions.push([from, to]);
    while ((stack.at(-1)?.line ?? -1) >= from) stack.pop();
    return to;
  };

  let event = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] as SourceLine;
    const own = isCode(kinds[index]) ? null : lineOverflow(line, inline[index]);
    if (own) {
      index = addRegion(index, index, own);
      while ((events[event]?.line ?? Number.POSITIVE_INFINITY) <= index) event++;
      continue;
    }
    for (; events[event]?.line === index; event++) {
      const tag = events[event] as TagEvent;
      if (tag.closing) {
        const open = stack.findLastIndex((entry) => entry.key === tag.key);
        if (open >= 0) stack.length = open;
        continue;
      }
      stack.push({ key: tag.key, line: index });
      if (stack.length <= MARKDOWN_PARSE_LIMITS.nesting) continue;
      // Too deep: the region runs from the tag that went over to where it closes.
      const deepest = stack[MARKDOWN_PARSE_LIMITS.nesting] as { key: string; line: number };
      let depth = stack.length;
      let last = lines.length - 1;
      for (event++; event < events.length; event++) {
        const next = events[event] as TagEvent;
        if (next.closing) {
          const open = stack.findLastIndex((entry) => entry.key === next.key);
          if (open >= 0) stack.length = open;
        } else depth = Math.max(depth, stack.push({ key: next.key, line: next.line }));
        if (stack.length <= MARKDOWN_PARSE_LIMITS.nesting) {
          last = next.line;
          break;
        }
      }
      index = addRegion(deepest.line, last, { limit: 'nesting', line: line.index + 1, amount: depth, nesting: 'tags' });
      while ((events[event]?.line ?? Number.POSITIVE_INFINITY) <= index) event++;
      break;
    }
  }
  if (!overflow) return { overflow: null, whole: false, regions: [], content: source };

  let content = '';
  let copied = 0;
  for (const [first, last] of regions) {
    const start = (lines[first] as SourceLine).start;
    const end = (lines[last] as SourceLine).end;
    const text = source.slice(start, end);
    let longest = 2;
    for (const run of text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
    const fence = '`'.repeat(longest + 1);
    content += `${source.slice(copied, start)}${fence}${MARKDOWN_PLAIN_LANGUAGE}\n${text}\n${fence}`;
    copied = end;
  }
  content += source.slice(copied);
  return {
    overflow,
    whole: false,
    regions: regions.map(([first, last]) => [(lines[first] as SourceLine).index, (lines[last] as SourceLine).index] as const),
    content,
  };
};

/** The first limit a page exceeds, or null. */
export const markdownParseLimit = (source: string): MarkdownParseLimit | null => markdownParseBudget(source).overflow?.limit ?? null;

/** A publish check's detail for an overflow: `limit:line:amount`, with `:tags` for nested tags. */
export const formatMarkdownParseOverflow = ({ limit, line, amount, nesting }: MarkdownParseOverflow): string =>
  `${limit}:${line}:${amount}${nesting === 'tags' ? ':tags' : ''}`;

/** The overflow a publish check's detail names, or null for a detail in another shape. */
export const parseMarkdownParseOverflow = (detail: string): MarkdownParseOverflow | null => {
  const [limit = '', line = '', amount = '', nesting] = detail.split(':');
  if (!(Object.hasOwn(MARKDOWN_PARSE_LIMITS, limit) && /^\d+$/.test(line) && /^\d+$/.test(amount))) return null;
  const overflow: MarkdownParseOverflow = { limit: limit as MarkdownParseLimit, line: Number(line), amount: Number(amount) };
  if (limit === 'nesting') overflow.nesting = nesting === 'tags' ? 'tags' : 'markers';
  return overflow;
};

const utf8Width = (code: number) => (code <= 0x7f ? 1 : code <= 0x7_ff ? 2 : code <= 0xff_ff ? 3 : 4);

/** Count UTF-8 bytes only up to the limit. Even a huge single line fails early.
 * Unpaired UTF-16 surrogates encode as a three-byte replacement character. */
export function exceedsUtf8Bytes(text: string, limit: number): boolean {
  // Every UTF-16 code unit encodes to at least one byte.
  if (text.length > limit) return true;
  let bytes = 0;
  for (const char of text) {
    bytes += utf8Width(char.codePointAt(0) ?? 0);
    if (bytes > limit) return true;
  }
  return false;
}

function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const char of text) bytes += utf8Width(char.codePointAt(0) ?? 0);
  return bytes;
}

/**
 * The UTF-8 size of `next` when writing it must be refused, otherwise null.
 *
 * Content over the cap is refused only when it is also larger than the
 * `stored` body. Pages saved before the cap existed may be larger than it, and
 * an edit that shrinks one must always succeed, even while the result is still
 * over the cap, so its owner is never locked out. A create has no stored body:
 * anything over the cap is refused. Content under the cap costs one bounded
 * scan; `stored` is only measured, up to the new size, when `next` is over it.
 * `limit` is the cap (tests pass a small one to exercise the rule cheaply).
 */
export function oversizedPageContent(next: string, stored?: string, limit = MAX_PAGE_CONTENT_BYTES): number | null {
  if (!exceedsUtf8Bytes(next, limit)) return null;
  const bytes = utf8ByteLength(next);
  // `stored` holding at least as many bytes means this write does not grow it.
  if (stored !== undefined && exceedsUtf8Bytes(stored, bytes - 1)) return null;
  return bytes;
}
