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

interface OpenedLine {
  containers: FenceContainer[];
  content: string;
  /** Spaces before the line's first marker or text; -1 when a tab comes first. */
  leading: number;
  /** Absolute column of the first marker or text after the line's leading quotes. */
  lead: number;
  /** Absolute column where `content` starts, and of its first non-space character. */
  contentColumn: number;
  textColumn: number;
  /** The list items this line opens: marker and content columns. */
  items: Array<{ marker: number; content: number }>;
}

/** The quote and list containers a line opens, and the text after them. The
 * first marker may sit after any number of spaces: an earlier line may have
 * opened a list item, and authors indent inside components. A tab before it
 * (an indented code block to CommonMark, or the body of an HTML block) opens
 * no container, as on main, so the line is not read as a fence. */
const openingContainers = (line: string): OpenedLine => {
  const containers: FenceContainer[] = [];
  const items: OpenedLine['items'] = [];
  let at: LineCursor = { index: 0, column: 0, spare: 0 };
  let leading = 0;
  let lead = -1;
  for (;;) {
    const first = containers.length === 0;
    const space = whitespaceAhead(line, at, first ? Number.POSITIVE_INFINITY : 3);
    if (first) leading = space.columns === space.index ? space.columns : -1;
    if (first ? leading < 0 : space.columns > 3) break;
    if (line[space.index] === '>') {
      containers.push({ kind: 'quote', indent: space.columns });
      at = afterQuoteMarker(line, space.index, space.column);
      continue;
    }
    if (lead < 0) lead = space.column;
    LIST_MARKER.lastIndex = space.index;
    const marker = LIST_MARKER.exec(line)?.[0];
    const markerEnd = space.index + (marker?.length ?? 0);
    if (!marker || !isSpace(line[markerEnd])) break;
    const item: LineCursor = { index: markerEnd, column: space.column + marker.length, spare: 0 };
    // Five or more columns after the marker: one is the item's padding and the
    // rest indents its first line (CommonMark list items).
    const spacing = whitespaceAhead(line, item, 4);
    if (blankFrom(line, spacing.index)) break;
    const padding = spacing.columns > 4 ? 1 : spacing.columns;
    containers.push({ kind: 'list', indent: space.columns + marker.length + padding });
    at = takeColumns(line, item, padding).cursor;
    items.push({ marker: space.column, content: at.column - at.spare });
  }
  const content = contentAt(line, at);
  const contentColumn = at.column - at.spare;
  const textColumn = contentColumn + (content.length - content.trimStart().length);
  return { containers, content, leading, lead: lead < 0 ? textColumn : lead, contentColumn, textColumn, items };
};

interface OpenFence extends MarkdownFence {
  containers: FenceContainer[];
  /** Whether a quote is among `containers[i..]`, which a blank line ends. */
  quoteFrom: boolean[];
}

/** A fence body line with its containers' prefixes removed, or undefined when the
 * line ends one of those containers: no `>` for a quote, or too little
 * indentation for a list item. A blank line continues a list item, not a quote.
 * One cursor moves through the line: each container reads only the columns it
 * consumes (a quote, at most its marker's indentation plus 3), so deep nesting
 * stays linear. */
const fenceBodyContent = (line: string, fence: OpenFence): string | undefined => {
  let at: LineCursor = { index: 0, column: 0, spare: 0 };
  for (const [position, container] of fence.containers.entries()) {
    if (container.kind === 'quote') {
      const limit = container.indent + 3;
      const space = whitespaceAhead(line, at, limit);
      if (space.columns > limit || line[space.index] !== '>') return undefined;
      at = afterQuoteMarker(line, space.index, space.column);
      continue;
    }
    const taken = takeColumns(line, at, container.indent);
    if (!taken.full) return blankFrom(line, taken.cursor.index) && !fence.quoteFrom[position] ? '' : undefined;
    at = taken.cursor;
  }
  return contentAt(line, at);
};

/** The innermost of the open list items (increasing content columns) whose
 * content column is at most `column`, or 0 when there is none. */
const listBase = (columns: readonly number[], column: number): number => {
  let low = 0;
  let high = columns.length - 1;
  let base = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const value = columns[middle] ?? 0;
    if (value <= column) {
      base = value;
      low = middle + 1;
    } else high = middle - 1;
  }
  return base;
};

const COMPONENT_OPENER = /^<([A-Z][\w.]*)/;
const COMPONENT_CLOSER = /^<\/[A-Z]/;

/**
 * Flags each line that belongs to fenced code, fence lines included: same marker,
 * closing at least as long (CommonMark), also when the fence sits in list items
 * and blockquotes, in any nesting. The quotes and list items opened on the fence's
 * first line must continue on each body line, measured in columns (tabs to the next
 * multiple of 4, the optional space after `>`, list content columns). A line that
 * ends one of them ends the fence too; a `>` or list marker that first appears in
 * the body is code.
 *
 * Inside an MDX component (`<Tabs>` … `</Tabs>`) a fence may sit at any
 * indentation, because authors indent there. Elsewhere a line indented 4 or more
 * columns past its containers, or past the list item it continues, is indented
 * code and never opens a fence.
 *
 * One pass; each line is read at most twice (again only when it ends a fence's
 * container). Shared by the reader's MDX normalizer, heading extraction and search
 * sections, so all three agree on what is code.
 */
export const fencedMarkdownLines = (lines: readonly string[]): boolean[] => {
  let fence: OpenFence | undefined;
  // Open list items, by content column (increasing), and MDX component depth.
  const lists: number[] = [];
  let components = 0;
  let pendingOpener = false;
  let previousBlank = true;
  const read = (line: string): boolean => {
    const opened = openingContainers(line);
    const text = opened.content.trim();
    if (!text && opened.items.length === 0) {
      previousBlank = true;
      return false;
    }
    // After a blank line, a line that starts left of an item's content ends it.
    if (previousBlank) while ((lists.at(-1) ?? 0) > opened.lead) lists.pop();
    previousBlank = false;
    const indentedCode =
      components === 0 &&
      (opened.leading >= 0 && opened.leading - listBase(lists, opened.leading) >= 4
        ? true
        : opened.containers.length > 0 && opened.textColumn - Math.max(opened.contentColumn, listBase(lists, opened.textColumn)) >= 4);
    if (indentedCode) return false;
    for (const item of opened.items) {
      while ((lists.at(-1) ?? 0) > item.marker) lists.pop();
      lists.push(item.content);
    }
    const opening = openingMarkdownFence(opened.content, Number.POSITIVE_INFINITY);
    if (opening) {
      const quoteFrom = opened.containers.map(({ kind }) => kind === 'quote');
      for (let index = quoteFrom.length - 2; index >= 0; index--) quoteFrom[index] = quoteFrom[index] || Boolean(quoteFrom[index + 1]);
      fence = { ...opening, containers: opened.containers, quoteFrom };
      return true;
    }
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
    return false;
  };
  return lines.map((line) => {
    if (fence) {
      const content = fenceBodyContent(line, fence);
      if (content !== undefined) {
        if (closesMarkdownFence(content, fence, Number.POSITIVE_INFINITY)) fence = undefined;
        return true;
      }
      // The container ended, so the fence did; this line starts afresh.
      fence = undefined;
    }
    return read(line);
  });
};

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
