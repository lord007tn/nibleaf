import { randomUUID } from './uuid';
export interface MarkdownFence {
  marker: string;
  length: number;
}

export const openingMarkdownFence = (line: string, maxIndent = 3): MarkdownFence | undefined => {
  const match = /^( *)(`{3,}|~{3,})(.*)$/.exec(line);
  const delimiter = match?.[2];
  if (!delimiter || (match?.[1]?.length ?? 0) > maxIndent || (delimiter[0] === '`' && match?.[3]?.includes('`'))) return undefined;
  return { marker: delimiter.charAt(0), length: delimiter.length };
};

export const closesMarkdownFence = (line: string, fence: MarkdownFence, maxIndent = 3): boolean => {
  const match = /^( *)(`+|~+)\s*$/.exec(line);
  return Boolean(match && (match[1]?.length ?? 0) <= maxIndent && match[2]?.[0] === fence.marker && match[2].length >= fence.length);
};

/** A blockquote or list item that is open on a fence's opening line. `indent`
 * is in columns from the previous container's content: the spaces before `>`
 * for a quote, the item's content column for a list item. */
interface FenceContainer {
  kind: 'quote' | 'list';
  indent: number;
}

/** A position in a line, in CommonMark columns: a tab advances to the next
 * multiple of 4 and may be used in part (`spare` columns of it are left). */
interface LineCursor {
  index: number;
  column: number;
  spare: number;
}

const LIST_MARKER = /[-*+]|\d{1,9}[.)]/y;
const tabWidth = (column: number) => 4 - (column % 4);
const isSpace = (character: string | undefined) => character === ' ' || character === '\t';

/** The whitespace ahead of the cursor, read only until it is wider than `limit`
 * columns: its width in columns, and where the scan stopped. */
const whitespaceAhead = (line: string, at: LineCursor, limit = Number.POSITIVE_INFINITY) => {
  let { index, column } = at;
  let columns = at.spare;
  for (; columns <= limit && isSpace(line[index]); index++) {
    const width = line[index] === '\t' ? tabWidth(column) : 1;
    column += width;
    columns += width;
  }
  return { columns, index, column };
};

/** Move past at most `columns` columns of whitespace, splitting a tab when needed.
 * Reads only what it consumes; `full` says whether there was that much. */
const takeColumns = (line: string, at: LineCursor, columns: number): { cursor: LineCursor; full: boolean } => {
  let { index, column, spare } = at;
  let left = columns;
  const used = Math.min(spare, left);
  spare -= used;
  left -= used;
  while (left > 0 && isSpace(line[index])) {
    const width = line[index] === '\t' ? tabWidth(column) : 1;
    index++;
    column += width;
    const taken = Math.min(width, left);
    spare = width - taken;
    left -= taken;
  }
  return { cursor: { index, column, spare }, full: left === 0 };
};

/** Past a `>` at `index`, with its optional following space (one column of a tab). */
const afterQuoteMarker = (line: string, index: number, column: number): LineCursor => {
  const next = { index: index + 1, column: column + 1, spare: 0 };
  return isSpace(line[next.index]) ? takeColumns(line, next, 1).cursor : next;
};

const contentAt = (line: string, at: LineCursor) => ' '.repeat(at.spare) + line.slice(at.index);
const blankFrom = (line: string, index: number) => index >= line.length || (index === line.length - 1 && line[index] === '\r');

/** CommonMark's open containers: the quotes and list items the current line
 * sits in, outermost first, with the positions of its quotes (increasing). */
interface ContainerStack {
  items: FenceContainer[];
  quotes: number[];
}

const pushContainer = (stack: ContainerStack, container: FenceContainer) => {
  if (container.kind === 'quote') stack.quotes.push(stack.items.length);
  stack.items.push(container);
};
const closeContainers = (stack: ContainerStack, length: number) => {
  stack.items.length = length;
  while ((stack.quotes.at(-1) ?? -1) >= length) stack.quotes.pop();
};
/** The first quote at or after `position`, or -1. */
const quoteFrom = (quotes: readonly number[], position: number): number => {
  let low = 0;
  let high = quotes.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const value = quotes[middle] ?? -1;
    if (value >= position) {
      found = value;
      high = middle - 1;
    } else low = middle + 1;
  }
  return found;
};

interface Continuation {
  /** How many of the open containers the line continues. */
  matched: number;
  /** Where the line's text starts after them. */
  cursor: LineCursor;
  blank: boolean;
}

/**
 * How far a line continues the open containers: a quote needs its `>` (after at
 * most its marker's indentation plus 3 columns), a list item its content
 * column of indentation. A blank line continues list items, not quotes. One
 * cursor moves through the line and each container reads only the columns it
 * consumes, so deep nesting stays linear.
 */
const continuation = (line: string, stack: ContainerStack): Continuation => {
  let at: LineCursor = { index: 0, column: 0, spare: 0 };
  for (const [position, container] of stack.items.entries()) {
    if (container.kind === 'quote') {
      const limit = container.indent + 3;
      const space = whitespaceAhead(line, at, limit);
      if (space.columns > limit || line[space.index] !== '>') {
        const blank = space.columns <= limit && blankFrom(line, space.index);
        return { matched: position, cursor: at, blank };
      }
      at = afterQuoteMarker(line, space.index, space.column);
      continue;
    }
    const taken = takeColumns(line, at, container.indent);
    if (!taken.full) {
      if (!blankFrom(line, taken.cursor.index)) return { matched: position, cursor: at, blank: false };
      const quote = quoteFrom(stack.quotes, position);
      return { matched: quote < 0 ? stack.items.length : quote, cursor: taken.cursor, blank: true };
    }
    at = taken.cursor;
  }
  const rest = whitespaceAhead(line, at);
  return { matched: stack.items.length, cursor: at, blank: blankFrom(line, rest.index) };
};

/** A line that starts a block of its own, so it cannot continue a paragraph
 * lazily (an HTML or MDX tag is decided by `interruptsParagraph`). */
const STARTS_BLOCK = /^ {0,3}(?:>|[-*+](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|([-*_])(?:[ \t]*\1){2,}[ \t\r]*$)/;
/** Text that is not a paragraph line: a heading, an HTML or MDX tag, a thematic break. */
const NOT_PARAGRAPH = /^(?:#{1,6}(?:[ \t]|$)|<|([-*_])(?:[ \t]*\1){2,}[ \t\r]*$)/;
/** Under a paragraph, a setext heading underline ends it. */
const SETEXT_UNDERLINE = /^(?:=+|-+)[ \t\r]*$/;

/** Where a line's thematic break (`- - -`, `***`, `_ _ _`) may start: one of
 * -*_ three or more times, with only spaces or tabs between and after. The tail
 * is read once per line; each query is a binary search. */
const thematicTail = (line: string) => {
  let index = line.length - 1;
  if (line[index] === '\r') index--;
  while (index >= 0 && isSpace(line[index])) index--;
  const char = line[index];
  const positions: number[] = [];
  if (char === '-' || char === '*' || char === '_')
    for (; index >= 0 && (line[index] === char || isSpace(line[index])); index--) if (line[index] === char) positions.push(index);
  positions.reverse();
  return (from: number): boolean => {
    if (line[from] !== char || positions.length < 3 || from < (positions[0] ?? 0)) return false;
    let low = 0;
    let high = positions.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((positions[middle] ?? 0) < from) low = middle + 1;
      else high = middle;
    }
    return positions.length - low >= 3;
  };
};

/**
 * Opens the quotes and list items a line starts at `at`, pushing them on the
 * stack. Outside an MDX component the first marker may be indented at most 3
 * columns (4 or more is indented code); inside one, any number of spaces,
 * because authors indent there. A tab at the very start opens nothing, as on
 * main. A thematic break opens no list item. Within a paragraph, an ordered item
 * other than 1 or an empty item does not interrupt it.
 */
const openContainers = (line: string, at: LineCursor, stack: ContainerStack, lenient: boolean, paragraph: boolean): LineCursor => {
  let cursor = at;
  let thematic: ((from: number) => boolean) | undefined;
  for (let opened = 0; ; opened++) {
    const space = whitespaceAhead(line, cursor, opened === 0 && lenient ? Number.POSITIVE_INFINITY : 3);
    if (cursor.index === 0 && space.columns !== space.index) break;
    if (space.columns > (opened === 0 && lenient ? Number.POSITIVE_INFINITY : 3)) break;
    if (line[space.index] === '>') {
      pushContainer(stack, { kind: 'quote', indent: space.columns });
      cursor = afterQuoteMarker(line, space.index, space.column);
      continue;
    }
    LIST_MARKER.lastIndex = space.index;
    const marker = LIST_MARKER.exec(line)?.[0];
    const markerEnd = space.index + (marker?.length ?? 0);
    const empty = blankFrom(line, markerEnd);
    if (!marker || !(empty || isSpace(line[markerEnd]))) break;
    if (marker === '-' || marker === '*') {
      thematic ??= thematicTail(line);
      if (thematic(space.index)) break;
    }
    const interrupts = paragraph && opened === 0;
    if (interrupts && (empty || (/^\d/.test(marker) && !/^0*1[.)]$/.test(marker)))) break;
    const item: LineCursor = { index: markerEnd, column: space.column + marker.length, spare: 0 };
    // Five or more columns after the marker: one is the item's padding and the
    // rest indents its first line (CommonMark list items). An item that starts
    // blank takes one column of padding.
    const spacing = whitespaceAhead(line, item, 4);
    const blank = empty || blankFrom(line, spacing.index);
    if (blank && interrupts) break;
    const padding = blank || spacing.columns > 4 ? 1 : spacing.columns;
    pushContainer(stack, { kind: 'list', indent: space.columns + marker.length + padding });
    if (blank) return { index: line.length, column: item.column, spare: 0 };
    cursor = takeColumns(line, item, padding).cursor;
  }
  return cursor;
};

const COMPONENT_OPENER = /^<([A-Z][\w.]*)/;
const COMPONENT_CLOSER = /^<\/[A-Z]/;

/** CommonMark HTML blocks (types 1 to 7) and the line that ends each, `blank`
 * for one that ends before a blank line. A tag whose name starts with a capital
 * letter is an MDX component, read as Markdown, not HTML. Ends are plain
 * substring checks, exactly CommonMark's (a comment ends at `-->`, not `--!>`). */
type HtmlBlockEnd = ((line: string) => boolean) | 'blank';
const contains = (marker: string) => (line: string) => line.includes(marker);
const RAW_TEXT_ENDS = ['</script>', '</pre>', '</style>', '</textarea>'];
const HTML_BLOCK_STARTS: ReadonlyArray<readonly [start: RegExp, end: HtmlBlockEnd, interruptsParagraph: boolean]> = [
  [/^<(?:script|pre|style|textarea)(?:[ \t>]|$)/i, (line) => RAW_TEXT_ENDS.some((end) => line.toLowerCase().includes(end)), true],
  [/^<!--/, contains('-->'), true],
  [/^<\?/, contains('?>'), true],
  [/^<![A-Za-z]/, contains('>'), true],
  [/^<!\[CDATA\[/, contains(']]>'), true],
  [
    /^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t]|\/?>|\r?$)/i,
    'blank',
    true,
  ],
  [
    /^(?:<[a-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][\w.:-]*(?:[ \t]*=[ \t]*(?:[^"'=<>`\s]+|'[^']*'|"[^"]*"))?)*[ \t]*\/?>|<\/[a-z][A-Za-z0-9-]*[ \t]*>)[ \t\r]*$/,
    'blank',
    false,
  ],
];

/** Whether a line would end the paragraph before it: a block start, an MDX
 * component tag, or an HTML block of types 1 to 6. Type 7 (`<span>`, any other
 * tag alone on its line) never interrupts a paragraph; it continues it. */
const interruptsParagraph = (content: string): boolean => {
  if (STARTS_BLOCK.test(content)) return true;
  const text = content.trimStart();
  if (content.length - text.length > 3 || !text.startsWith('<')) return false;
  return (
    COMPONENT_OPENER.test(text) || COMPONENT_CLOSER.test(text) || HTML_BLOCK_STARTS.some(([start, , interrupts]) => interrupts && start.test(text))
  );
};

/**
 * Classifies each line as fenced code, a line of an HTML block, or prose. Fenced
 * code includes the fence lines: same marker,
 * closing at least as long (CommonMark), also when the fence sits in list items
 * and blockquotes, in any nesting. Like CommonMark, it carries the open quotes and
 * list items from line to line (lazy paragraph lines and blank lines in an item
 * keep them open), so a fence opened on an item's continuation line belongs to
 * that item. Each body line must continue all of the fence's containers, measured
 * in columns (tabs to the next multiple of 4, the optional space after `>`, list
 * content columns); a line that leaves one ends the fence. A `>` or list marker
 * that first appears in the body is code. A thematic break is not a list item,
 * and the lines of an HTML block are HTML, not fences.
 *
 * Inside an MDX component (`<Tabs>` … `</Tabs>`) a fence may sit at any
 * indentation, because authors indent there. Elsewhere a line indented 4 or more
 * columns past its containers is indented code and never opens a fence.
 *
 * One pass; each line is read at most twice (again only when it ends a fence's
 * or HTML block's container). Shared by the reader's MDX normalizer, heading
 * extraction and search sections, so all three agree on what is code.
 */
const scanMarkdownLines = (lines: readonly string[]): MarkdownLineKind[] => {
  let fence: MarkdownFence | undefined;
  let html: HtmlBlockEnd | undefined;
  const stack: ContainerStack = { items: [], quotes: [] };
  let paragraph = false;
  let components = 0;
  let pendingOpener = false;
  const read = (line: string, continued: Continuation): MarkdownLineKind => {
    if (continued.blank) {
      closeContainers(stack, continued.matched);
      paragraph = false;
      return 'prose';
    }
    if (continued.matched < stack.items.length) {
      // A paragraph line may continue lazily without its containers' prefixes.
      if (paragraph && !interruptsParagraph(contentAt(line, continued.cursor))) return 'prose';
      // Otherwise the paragraph closes with its container: what follows (a
      // sibling item, say) does not interrupt it.
      closeContainers(stack, continued.matched);
      paragraph = false;
    }
    const cursor = openContainers(line, continued.cursor, stack, components > 0, paragraph);
    const content = contentAt(line, cursor);
    const text = content.trim();
    if (!text) {
      paragraph = false;
      return 'prose';
    }
    const indent = content.length - content.trimStart().length;
    // Indented 4 or more columns past its containers: indented code, or a lazy
    // paragraph line, but never a fence (except inside a component).
    if (components === 0 && indent >= 4) return 'prose';
    const opening = openingMarkdownFence(content, Number.POSITIVE_INFINITY);
    if (opening) {
      fence = opening;
      paragraph = false;
      return 'code';
    }
    if (indent < 4 && text.startsWith('<') && !COMPONENT_OPENER.test(text) && !COMPONENT_CLOSER.test(text)) {
      const block = HTML_BLOCK_STARTS.find(([start, , interruptsParagraph]) => (interruptsParagraph || !paragraph) && start.test(text));
      if (block) {
        const end = block[1];
        html = end === 'blank' || !end(text) ? end : undefined;
        paragraph = false;
        return 'html';
      }
    }
    paragraph = paragraph && SETEXT_UNDERLINE.test(text) ? false : !NOT_PARAGRAPH.test(text);
    // MDX component depth: the indentation exception applies inside one.
    if (pendingOpener && text.includes('>')) {
      pendingOpener = false;
      if (text.endsWith('/>')) components = Math.max(0, components - 1);
    } else if (COMPONENT_CLOSER.test(text)) components = Math.max(0, components - 1);
    else {
      const name = COMPONENT_OPENER.exec(text)?.[1];
      if (name && !text.endsWith('/>') && !text.includes(`</${name}`)) {
        components++;
        pendingOpener = !text.slice(name.length + 1).includes('>');
      }
    }
    return 'prose';
  };
  return lines.map((line) => {
    const continued = continuation(line, stack);
    const inside = continued.matched === stack.items.length;
    if (fence) {
      if (inside) {
        if (!continued.blank && closesMarkdownFence(contentAt(line, continued.cursor), fence, Number.POSITIVE_INFINITY)) fence = undefined;
        return 'code';
      }
      // The line leaves a container, which ends the fence; it starts afresh.
      fence = undefined;
    }
    if (html) {
      if (inside && !(continued.blank && html === 'blank')) {
        if (html !== 'blank' && html(line)) html = undefined;
        return 'html';
      }
      // A blank line, or a line that leaves a container, ends the HTML block.
      html = undefined;
    }
    return read(line, continued);
  });
};

/** What a line is to CommonMark: `code` (a fence or its body), `html` (a line of an
 * HTML block, types 1 to 7), or `prose` (anything else, blank lines included). */
export type MarkdownLineKind = 'prose' | 'code' | 'html';

/** Each line's kind, from the same single pass as `fencedMarkdownLines`: heading
 * extraction skips both code and HTML-block lines, as the reader renders them. */
export const markdownLineKinds = (lines: readonly string[]): MarkdownLineKind[] => scanMarkdownLines(lines);

/** Whether each line belongs to fenced code (see `scanMarkdownLines`). */
export const fencedMarkdownLines = (lines: readonly string[]): boolean[] => scanMarkdownLines(lines).map((kind) => kind === 'code');

/** Hide literal code from regex-based import passes, then restore exact bytes.
 * Mintlify passes may opt into structural JSX indentation before normalization.
 * The normalizer itself keeps fences visible so it can remove only that indent. */
export const protectMarkdownCode = (source: string, { fences = true, maxFenceIndent = 3 } = {}) => {
  let prefix = `\uE000${randomUUID()}:`;
  while (source.includes(prefix)) prefix = `\uE000${randomUUID()}:`;
  const literals: string[] = [];
  const hide = (value: string) => `${prefix}${literals.push(value) - 1}\uE001`;
  const protectInline = (prose: string): string => {
    const runs = [...prose.matchAll(/`+/g)];
    const nextByLength = new Map<number, number>();
    const closingIndexes: number[] = [];
    for (let index = runs.length - 1; index >= 0; index--) {
      const run = runs[index];
      if (!run) continue;
      closingIndexes[index] = nextByLength.get(run[0].length) ?? -1;
      nextByLength.set(run[0].length, index);
    }
    let output = '';
    let cursor = 0;
    for (let index = 0; index < runs.length; index++) {
      const opening = runs[index];
      if (!opening) continue;
      let escapes = 0;
      for (let before = opening.index - 1; before >= 0 && prose[before] === '\\'; before--) escapes++;
      if (escapes % 2) continue;
      const closingIndex = closingIndexes[index] ?? -1;
      if (closingIndex < 0) continue;
      const closing = runs[closingIndex];
      if (!closing) continue;
      output += prose.slice(cursor, opening.index) + hide(prose.slice(opening.index, closing.index + closing[0].length));
      cursor = closing.index + closing[0].length;
      index = closingIndex;
    }
    return output + prose.slice(cursor);
  };

  let content = '';
  let prose = '';
  let code = '';
  let fence: MarkdownFence | undefined;
  for (const raw of source.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const line = raw.replace(/\r?\n$/, '');
    if (fence) {
      code += raw;
      if (closesMarkdownFence(line, fence, maxFenceIndent)) {
        content += fences ? hide(code) : code;
        code = '';
        fence = undefined;
      }
      continue;
    }
    fence = openingMarkdownFence(line, maxFenceIndent);
    if (fence) {
      content += protectInline(prose);
      prose = '';
      code = raw;
    } else prose += raw;
  }
  content += code ? (fences ? hide(code) : code) : protectInline(prose);
  const placeholder = new RegExp(`${prefix}(\\d+)\uE001`, 'g');
  return {
    content,
    restore: (value: string) => value.replace(placeholder, (match, index: string) => literals[Number(index)] ?? match),
  };
};
