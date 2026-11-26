import { DOCUMENTATION_COMPONENT_CONTRACT } from './documentation-component-contract';
import { type MarkdownBlockLineKind, type MarkdownLineFacts, markdownBudgetLines } from './markdown-code';

/** The largest page body a write may store, in UTF-8 bytes (2 MiB). Editor
 *  saves, MCP writes, import and Git sync share it: public `.md`/llms output and
 *  exports are built from page content. */
export const MAX_PAGE_CONTENT_BYTES = 2 * 1024 * 1024;

/**
 * Bounded synchronous Markdown parsing for the reader and publish checks.
 *
 * Code (fenced, indented and inline) is never parsed as Markdown, so the limits
 * skip it, and so do the lines of an HTML block (a one-line HTML table is raw
 * HTML, not Markdown). Markers are counted per unit of inline content, as the
 * parser reads it: a paragraph (however many lines it runs over), a heading or
 * a table row. Only real elements nest: HTML elements, the registry's
 * components and tags that are closed somewhere on the page. A generic such as
 * `Promise<User>` doesn't nest anything, and neither do void or optional-close
 * elements (`<br>`, `<li>`, `<p>`). Prose lines may be long: a whole chapter in
 * one paragraph is ordinary in Arabic.
 */
export const MARKDOWN_PARSE_LIMITS = {
  pageBytes: 512 * 1024,
  lineCharacters: 128 * 1024,
  syntaxMarkers: 1024,
  nesting: 64,
  tableRows: 2048,
} as const;

export type MarkdownParseLimit = keyof typeof MARKDOWN_PARSE_LIMITS;

/** The first place a page goes over a limit. */
export interface MarkdownParseOverflow {
  limit: MarkdownParseLimit;
  /** The line, numbered from 1 as the editor numbers them (for markers, the paragraph's first line); 0 for the page size. */
  line: number;
  /** What was measured: page bytes or table rows, line characters or nesting, or the paragraph's markers. */
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
  /** The fence language of those regions: one the page itself never writes, so an authored fence is never taken for one. */
  plainLanguage: string;
}

/** The fence language of a region shown as plain text; the reader draws it as wrapped text, not code. A page
 *  that writes it itself gets a numbered one instead (`MarkdownParseBudget.plainLanguage`). */
export const MARKDOWN_PLAIN_LANGUAGE = 'nibleaf-plain';

/** A plain-text fence language that `source` never writes: `nibleaf-plain`, or past every `nibleaf-plain-N` it holds. */
const plainLanguageFor = (source: string): string => {
  if (!source.includes(MARKDOWN_PLAIN_LANGUAGE)) return MARKDOWN_PLAIN_LANGUAGE;
  let next = 1;
  for (const match of source.matchAll(/nibleaf-plain-(\d{1,15})(?!\d)/g)) next = Math.max(next, Number(match[1]) + 1);
  return `${MARKDOWN_PLAIN_LANGUAGE}-${next}`;
};

const OPENERS = '[({';
const CLOSERS = '])}';
// Inline syntax besides backslashes, backticks and emphasis runs. `-`, `+`, `#`
// and `!` mean something at the start of a line (counted as nesting) or before
// `[`, not inside prose like "well-known"; `(` and `)` only after `](`, not
// around an aside. Their depth still counts.
const INLINE_SYNTAX = '[]{}<>|';
/** Emphasis and strikethrough: a run of up to two makes one element, so a run counts as half its length. */
const EMPHASIS = '*_~';
const NESTED_BLOCK_START = /[ \t]*(?:>|(?:[-*+]|\d{1,9}[.)])[ \t]+)/y;
/** With a `-`: a table's delimiter row (`| --- | :-: |`), a thematic break or a setext underline. */
const DELIMITER_ROW = /^[ \t>|:-]*$/;
/** One cell of a table's delimiter row. */
const DELIMITER_CELL = /^[ \t]*:?-+:?[ \t]*$/;
// A complete CommonMark open or closing tag on one line, no more permissive than
// the spec (and never past the line: a tag over two lines leaves the paragraph uncertain).
const HTML_TAG =
  /<[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:[^ \t"'=<>`\r\n]+|'[^'\r\n]*'|"[^"\r\n]*"))?)*[ \t]*\/?>|<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>/y;
/** Where raw HTML (a tag, comment, declaration) or an autolink may start. */
const MAY_START_HTML = /[A-Za-z/!?]/;
/** A complete single-line link reference definition, with an optional title. */
const REFERENCE_DEFINITION =
  /^\[((?!\^)(?:\\[\\[\]]|[^\\[\]]){1,999})\]:[ \t]*(?:<[^<>]*>|[^\s<>()\p{Cc}]+)(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^()]*\)))?[ \t]*$/u;
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

/** A source range [from, to). */
type Range = [from: number, to: number];

/** One unit of inline content as it is read: its markers so far, and whether its code spans are still certain. */
interface InlineUnit {
  markers: number;
  /** Past raw HTML this scan can't bound (or a code span a table might cut), code spans are no longer certain. */
  uncertain: boolean;
}

/**
 * Reads `source[from, to)`, one unit of inline content (or one table cell), the
 * way inline Markdown reads it: counts its markers, and records its code spans
 * (`code`) and the spans that hold no Markdown (`quiet`: code spans and the
 * attributes of complete tags, such as an SVG path).
 *
 * Code and math delimiters can pair across lines in a unit. Raw HTML binds
 * before either, so from a `<` that may start HTML this scan can't bound to the
 * end of the unit everything is counted, which never undercounts. In a `strict`
 * unit (a paragraph that might hold a table this scan did not recognise), a span
 * that holds a `|` or a line break is not taken as code either: a cell boundary
 * could cut it first. Each delimiter run finds its closer through a
 * forward-only pointer per delimiter and length.
 */
const readInline = (source: string, from: number, to: number, unit: InlineUnit, code: Range[], quiet: Range[], strict: boolean): void => {
  const runs = new Map<number, number[]>();
  for (let at = from; at < to; at++) {
    const char = source[at];
    if (char !== '`' && char !== '$') continue;
    let end = at + 1;
    while (end < to && source[end] === char) end++;
    const key = char === '$' ? at - end : end - at;
    const starts = runs.get(key);
    if (starts) starts.push(at);
    else runs.set(key, [at]);
    at = end - 1;
  }
  const pointers = new Map<number, number>();
  const closerAfter = (length: number, after: number): number => {
    const starts = runs.get(length) ?? [];
    let pointer = pointers.get(length) ?? 0;
    while (pointer < starts.length && (starts[pointer] as number) < after) pointer++;
    pointers.set(length, pointer);
    return starts[pointer] ?? -1;
  };
  for (let at = from; at < to; ) {
    const char = source[at] as string;
    if (char === '\\') {
      unit.markers++;
      // A backslash before a line ending is a hard break: the next line still starts at its own first character.
      at += source[at + 1] === '\n' || source[at + 1] === '\r' ? 1 : 2;
      continue;
    }
    if (char === '`' || char === '$') {
      let end = at + 1;
      while (end < to && source[end] === char) end++;
      const length = end - at;
      const close = unit.uncertain ? -1 : closerAfter(char === '$' ? -length : length, end);
      if (close !== -1) {
        if (!strict || !/[|\r\n]/.test(source.slice(end, close))) {
          code.push([at, close + length]);
          quiet.push([at, close + length]);
          unit.markers += 2;
          at = close + length;
          continue;
        }
        unit.uncertain = true;
      }
      // No closer in the unit: literal delimiters.
      unit.markers += length;
      at = end;
      continue;
    }
    if (char === '<' && !unit.uncertain && MAY_START_HTML.test(source[at + 1] ?? '')) {
      HTML_TAG.lastIndex = at;
      const tag = HTML_TAG.exec(source)?.[0];
      if (tag && at + tag.length <= to && !tag.includes('`') && !(strict && tag.includes('|'))) {
        // Raw HTML is not inline Markdown: its tags are not markers.
        quiet.push([at, at + tag.length]);
        at += tag.length;
        continue;
      }
      unit.uncertain = true;
    }
    if (EMPHASIS.includes(char)) {
      let end = at + 1;
      while (end < to && source[end] === char) end++;
      unit.markers += Math.ceil((end - at) / 2);
      at = end;
      continue;
    }
    if (INLINE_SYNTAX.includes(char)) unit.markers++;
    at++;
  }
};

/** Unescaped `|` in `source[from, to)`: where a table row splits into cells. */
const pipesIn = (source: string, from: number, to: number): number[] => {
  const pipes: number[] = [];
  for (let at = from; at < to; at++) {
    if (source[at] === '\\') at++;
    else if (source[at] === '|') pipes.push(at);
  }
  return pipes;
};

/** A row's cells as GFM splits it: at unescaped pipes, without the empty ends a leading or trailing pipe leaves. */
const cellsOf = (source: string, from: number, to: number): Range[] => {
  const pipes = pipesIn(source, from, to);
  const bounds = [from - 1, ...pipes, to];
  const cells: Range[] = [];
  for (let at = 0; at + 1 < bounds.length; at++) cells.push([(bounds[at] as number) + 1, bounds[at + 1] as number]);
  const blank = (cell: Range | undefined) => cell && !source.slice(cell[0], cell[1]).trim();
  if (pipes.length && blank(cells[0])) cells.shift();
  if (pipes.length && blank(cells.at(-1))) cells.pop();
  return cells;
};

const nestedBlockStarts = (text: string): number => {
  NESTED_BLOCK_START.lastIndex = 0;
  let blocks = 0;
  while (NESTED_BLOCK_START.test(text)) blocks++;
  return blocks;
};

const isCode = (kind: MarkdownBlockLineKind | undefined) => kind === 'code' || kind === 'indented';

/** Columns of indentation before a line's text, past its containers (a tab counts 4, never fewer). */
const indentOf = (line: SourceLine, facts: MarkdownLineFacts): number => {
  let columns = facts.indent;
  for (let at = facts.content; line.text[at] === ' ' || line.text[at] === '\t'; at++) columns += line.text[at] === '\t' ? 4 : 1;
  return columns;
};
/** An ordered list item or a GFM footnote definition can end a table. */
const NOT_A_ROW = /^(?:\[\^[^\]\s]+\]:|\d{1,9}[.)](?:[ \t]|$))/;
/** Whether a line in a table's containers can be one of its rows (or its header). */
const mayBeRow = (line: SourceLine, facts: MarkdownLineFacts): boolean => {
  if (indentOf(line, facts) > 3) return false;
  const text = line.text.slice(facts.content).trim();
  if (NOT_A_ROW.test(text)) return false;
  // A whole HTML tag on its own line starts a raw HTML block after a table.
  // An inline tag, autolink, link label, or dollar-delimited formula can be a cell.
  if (!text.startsWith('<')) return true;
  HTML_TAG.lastIndex = 0;
  return HTML_TAG.exec(text)?.[0] !== text;
};

interface TagEvent {
  line: number;
  key: string;
  closing: boolean;
}

/** The tags outside code (`masks`: code ranges, in order), keeping only those that nest. */
const nestingTags = (source: string, lines: readonly SourceLine[], masks: readonly Range[]) => {
  // Code reads as spaces, so a tag is never found in it and offsets stay put.
  let masked = '';
  let copied = 0;
  for (const [from, to] of masks) {
    masked += source.slice(copied, from) + ' '.repeat(to - from);
    copied = to;
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

/**
 * Each line's own overflow (a line too long, or nested too deep), and each unit
 * of inline content over the marker limit (at its first line), with the code
 * ranges the tag scan skips. One pass over the lines, linear in the source.
 *
 * Units follow the shared CommonMark line scanner: a paragraph line that it says
 * continues the paragraph before is read with it. A GFM table's rows are units
 * of their own, read cell by cell, but only where the scanner's facts make the
 * table certain (a header and delimiter row with the same number of cells, in the
 * same containers, neither lazy nor indented as code). Any other paragraph that
 * holds a delimiter-like line and a pipe is read `strict`ly (see `readInline`).
 */
const readLines = (source: string, lines: readonly SourceLine[]) => {
  const { kinds, facts } = markdownBudgetLines(lines.map((line) => line.text));
  const overflowAt: Array<MarkdownParseOverflow | undefined> = [];
  /** Fenced and indented code lines, and inline code spans, in source order. */
  const masks: Range[] = [];
  const quiet: Range[] = [];
  let quietFrom = 0;
  const blank = (index: number) => !lines[index]?.text.trim();
  const prose = (index: number) => kinds[index] === 'prose' && !blank(index);

  /** The line's own limits, outside its code and tags (`quiet`, read from `quietFrom` on). */
  const checkLine = (index: number) => {
    const line = lines[index] as SourceLine;
    const at = line.index + 1;
    let found: MarkdownParseOverflow | undefined;
    if (line.text.length > MARKDOWN_PARSE_LIMITS.lineCharacters) found = { limit: 'lineCharacters', line: at, amount: line.text.length };
    let depth = 0;
    let brackets = 0;
    for (let offset = line.start; offset < line.end && !found; ) {
      while ((quiet[quietFrom]?.[1] ?? Number.POSITIVE_INFINITY) <= offset) quietFrom++;
      const span = quiet[quietFrom];
      if (span && span[0] <= offset) {
        offset = span[1];
        continue;
      }
      const char = source[offset] as string;
      if (char === '\\') offset++;
      else if (OPENERS.includes(char)) brackets = Math.max(brackets, ++depth);
      else if (CLOSERS.includes(char) && depth) depth--;
      offset++;
    }
    const nesting = Math.max(nestedBlockStarts(line.text), brackets);
    if (!found && nesting > MARKDOWN_PARSE_LIMITS.nesting) found = { limit: 'nesting', line: at, amount: nesting, nesting: 'markers' };
    overflowAt[index] ??= found;
  };
  const checkMarkers = (first: number, unit: InlineUnit) => {
    if (unit.markers > MARKDOWN_PARSE_LIMITS.syntaxMarkers)
      overflowAt[first] ??= { limit: 'syntaxMarkers', line: (lines[first] as SourceLine).index + 1, amount: unit.markers };
  };

  /** Whether `index` is a table's delimiter row under the header row before it (see above). */
  const delimiterUnder = (index: number): boolean => {
    const header = index - 1;
    const [row, head] = [facts[index], facts[header]];
    if (!(row && head && prose(index) && prose(header) && row.continues && !row.lazy && !head.lazy && row.depth === head.depth)) return false;
    const [rowLine, headLine] = [lines[index] as SourceLine, lines[header] as SourceLine];
    if (indentOf(rowLine, row) > 3 || !mayBeRow(headLine, head)) return false;
    const delimiters = cellsOf(source, rowLine.start + row.content, rowLine.end);
    if (!delimiters.every(([from, to]) => DELIMITER_CELL.test(source.slice(from, to)))) return false;
    const headStart = headLine.start + head.content;
    return cellsOf(source, headStart, headLine.end).length === delimiters.length;
  };
  let lastRow = -2;
  let tableStart = -1;
  let tableRows = 0;
  /** A table row: one unit, read cell by cell. */
  const readRow = (index: number, delimiter: boolean) => {
    lastRow = index;
    const line = lines[index] as SourceLine;
    const unit: InlineUnit = { markers: 0, uncertain: false };
    if (!delimiter) {
      tableRows++;
      if (tableRows > MARKDOWN_PARSE_LIMITS.tableRows) overflowAt[tableStart] ??= { limit: 'tableRows', line: line.index + 1, amount: tableRows };
      const start = line.start + (facts[index]?.content ?? 0);
      unit.markers += pipesIn(source, start, line.end).length;
      for (const [from, to] of cellsOf(source, start, line.end)) {
        unit.uncertain = false;
        readInline(source, from, to, unit, masks, quiet, false);
      }
    }
    checkLine(index);
    checkMarkers(index, unit);
  };

  let first = -1;
  let strict = false;
  let delimiterShape = false;
  let pipe = false;
  /** Reads the paragraph from `first` through `last`. */
  const closeUnit = (last: number) => {
    if (first < 0) return;
    const unit: InlineUnit = { markers: 0, uncertain: false };
    readInline(source, (lines[first] as SourceLine).start, (lines[last] as SourceLine).end, unit, masks, quiet, strict || (delimiterShape && pipe));
    for (let index = first; index <= last; index++) checkLine(index);
    checkMarkers(first, unit);
    first = -1;
  };
  let table = -1;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] as SourceLine;
    const fact = facts[index];
    if (!prose(index)) {
      closeUnit(index - 1);
      table = -1;
      if (isCode(kinds[index])) masks.push([line.start, line.end]);
      continue;
    }
    // A table row continues its table in the same containers; anything else ends it.
    if (table >= 0 && !(fact?.continues && !fact.lazy && fact.depth === table && mayBeRow(line, fact))) table = -1;
    if (table >= 0) {
      readRow(index, false);
      continue;
    }
    if (index + 1 < lines.length && delimiterUnder(index + 1)) {
      // The header row ends the paragraph before it (a table interrupts one).
      closeUnit(index - 1);
      tableStart = index;
      readRow(index, false);
      readRow(++index, true);
      table = facts[index]?.depth ?? 0;
      continue;
    }
    // Definitions are recognized at the start of a block or after other
    // definitions. A definition-shaped line does not interrupt existing prose.
    if (fact && !fact.lazy && (first < 0 || !fact.continues) && indentOf(line, fact) <= 3) {
      const label = REFERENCE_DEFINITION.exec(line.text.slice(fact.content).trimStart())?.[1];
      if (label?.trim()) {
        closeUnit(index - 1);
        quiet.push([line.start, line.end]);
        masks.push([line.start, line.end]);
        checkLine(index);
        continue;
      }
    }
    const delimiterLike = DELIMITER_ROW.test(line.text) && line.text.includes('-');
    if (first >= 0 && fact?.continues) {
      delimiterShape ||= delimiterLike;
      pipe ||= line.text.includes('|');
      continue;
    }
    closeUnit(index - 1);
    first = index;
    // Right after a table, a line it did not take is read strictly, in case a parser took it as a row.
    strict = lastRow === index - 1;
    delimiterShape = delimiterLike;
    pipe = line.text.includes('|');
  }
  closeUnit(lines.length - 1);
  return { kinds, overflowAt, masks };
};

const BUDGET_MEMO_LIMIT = 8;
const budgetMemo = new Map<string, MarkdownParseBudget>();

/**
 * Reads a page against the parse budget. Within it, `content` is the source
 * itself. Past a line, marker or nesting limit, only the top-level blocks that
 * go over it (from the blank line before to the blank line after, never
 * splitting a fence or an HTML block) are put in a plain-text fence
 * (`plainLanguage`): the reader shows their text as written and everything else
 * as usual. A tag nested too deep takes the block it opens in through the block
 * it closes in (or the end of the page). Only the page size can't be localized:
 * past it, `whole` is set. Linear in the source, and the same on the server and
 * in the browser.
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
  const plainLanguage = plainLanguageFor(source);
  if (exceedsUtf8Bytes(source, MARKDOWN_PARSE_LIMITS.pageBytes)) {
    const last = source.split('\n').length - 1;
    return {
      overflow: { limit: 'pageBytes', line: 0, amount: utf8ByteLength(source) },
      whole: true,
      regions: [[0, last]],
      content: source,
      plainLanguage,
    };
  }
  const lines = sourceLines(source);
  const { kinds, overflowAt, masks } = readLines(source, lines);
  const events = nestingTags(source, lines, masks);

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
  // The open tags, with how many of each name are open, so a closing tag that
  // matches none costs nothing and one that does pops only what it closes.
  const stack: Array<{ key: string; line: number }> = [];
  const open = new Map<string, number>();
  const push = (key: string, line: number) => {
    open.set(key, (open.get(key) ?? 0) + 1);
    return stack.push({ key, line });
  };
  const pop = () => {
    const top = stack.pop();
    if (top) open.set(top.key, (open.get(top.key) ?? 1) - 1);
    return top;
  };
  const close = (key: string) => {
    if (!open.get(key)) return;
    while (pop()?.key !== key);
  };
  /** Marks lines `first`..`last` (extended to their blocks) as plain; returns the region's last line. */
  const addRegion = (first: number, last: number, found: MarkdownParseOverflow): number => {
    overflow ??= found;
    const from = blockStart(first);
    const to = blockEnd(last);
    const previous = regions.at(-1);
    if (previous && from <= previous[1] + 1) previous[1] = Math.max(previous[1], to);
    else regions.push([from, to]);
    while ((stack.at(-1)?.line ?? -1) >= from) pop();
    return to;
  };

  let event = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] as SourceLine;
    const own = overflowAt[index];
    if (own) {
      index = addRegion(index, index, own);
      while ((events[event]?.line ?? Number.POSITIVE_INFINITY) <= index) event++;
      continue;
    }
    for (; events[event]?.line === index; event++) {
      const tag = events[event] as TagEvent;
      if (tag.closing) {
        close(tag.key);
        continue;
      }
      push(tag.key, index);
      if (stack.length <= MARKDOWN_PARSE_LIMITS.nesting) continue;
      // Too deep: the region runs from the tag that went over to where it closes.
      const deepest = stack[MARKDOWN_PARSE_LIMITS.nesting] as { key: string; line: number };
      let depth = stack.length;
      let last = lines.length - 1;
      for (event++; event < events.length; event++) {
        const next = events[event] as TagEvent;
        if (next.closing) close(next.key);
        else depth = Math.max(depth, push(next.key, next.line));
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
  if (!overflow) return { overflow: null, whole: false, regions: [], content: source, plainLanguage };

  let content = '';
  let copied = 0;
  for (const [first, last] of regions) {
    const start = (lines[first] as SourceLine).start;
    const end = (lines[last] as SourceLine).end;
    const text = source.slice(start, end);
    let longest = 2;
    for (const run of text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
    const fence = '`'.repeat(longest + 1);
    content += `${source.slice(copied, start)}${fence}${plainLanguage}\n${text}\n${fence}`;
    copied = end;
  }
  content += source.slice(copied);
  return {
    overflow,
    whole: false,
    regions: regions.map(([first, last]) => [(lines[first] as SourceLine).index, (lines[last] as SourceLine).index] as const),
    content,
    plainLanguage,
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
