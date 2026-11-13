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

/** The whitespace ahead of the cursor: its width in columns, and where it ends. */
const whitespaceAhead = (line: string, at: LineCursor) => {
  let { index, column } = at;
  let columns = at.spare;
  for (; line[index] === ' ' || line[index] === '\t'; index++) {
    const width = line[index] === '\t' ? tabWidth(column) : 1;
    column += width;
    columns += width;
  }
  return { columns, index, column };
};

/** Move past exactly `columns` columns of whitespace, splitting a tab when needed.
 * The caller has checked that there is that much whitespace ahead. */
const skipColumns = (line: string, at: LineCursor, columns: number): LineCursor => {
  let { index, column, spare } = at;
  let left = columns;
  const used = Math.min(spare, left);
  spare -= used;
  left -= used;
  while (left > 0) {
    const width = line[index] === '\t' ? tabWidth(column) : 1;
    index++;
    column += width;
    const taken = Math.min(width, left);
    spare = width - taken;
    left -= taken;
  }
  return { index, column, spare };
};

/** Past a `>` at `index`, with its optional following space (one column of a tab). */
const afterQuoteMarker = (line: string, index: number, column: number): LineCursor => {
  const next = { index: index + 1, column: column + 1, spare: 0 };
  return line[next.index] === ' ' || line[next.index] === '\t' ? skipColumns(line, next, 1) : next;
};

const contentAt = (line: string, at: LineCursor) => ' '.repeat(at.spare) + line.slice(at.index);
const blankFrom = (line: string, index: number) => index >= line.length || (index === line.length - 1 && line[index] === '\r');

/** The quote and list containers a line opens, and the text after them. The
 * first marker may sit after any number of spaces: an earlier line may have
 * opened a list item, and authors indent inside components. A tab before it
 * (an indented code block to CommonMark, or the body of an HTML block) opens
 * no container, as on main, so the line is not read as a fence. */
const openingContainers = (line: string): { containers: FenceContainer[]; content: string } => {
  const containers: FenceContainer[] = [];
  let at: LineCursor = { index: 0, column: 0, spare: 0 };
  for (;;) {
    const space = whitespaceAhead(line, at);
    if (containers.length > 0 ? space.columns > 3 : space.columns !== space.index) break;
    if (line[space.index] === '>') {
      containers.push({ kind: 'quote', indent: space.columns });
      at = afterQuoteMarker(line, space.index, space.column);
      continue;
    }
    LIST_MARKER.lastIndex = space.index;
    const marker = LIST_MARKER.exec(line)?.[0];
    const markerEnd = space.index + (marker?.length ?? 0);
    if (!marker || (line[markerEnd] !== ' ' && line[markerEnd] !== '\t')) break;
    const item: LineCursor = { index: markerEnd, column: space.column + marker.length, spare: 0 };
    const spacing = whitespaceAhead(line, item);
    if (blankFrom(line, spacing.index)) break;
    // More than four columns after the marker: one is the item's padding and the
    // rest indents its first line (CommonMark list items).
    const padding = spacing.columns > 4 ? 1 : spacing.columns;
    containers.push({ kind: 'list', indent: space.columns + marker.length + padding });
    at = skipColumns(line, item, padding);
  }
  return { containers, content: contentAt(line, at) };
};

/** A fence body line with its containers' prefixes removed, or undefined when the
 * line ends one of those containers: no `>` for a quote, or too little
 * indentation for a list item. A blank line continues a list item, not a quote. */
const fenceBodyContent = (line: string, containers: readonly FenceContainer[]): string | undefined => {
  let at: LineCursor = { index: 0, column: 0, spare: 0 };
  for (const [position, container] of containers.entries()) {
    const space = whitespaceAhead(line, at);
    if (container.kind === 'quote') {
      if (space.columns > container.indent + 3 || line[space.index] !== '>') return undefined;
      at = afterQuoteMarker(line, space.index, space.column);
    } else if (blankFrom(line, space.index)) {
      return containers.slice(position).some(({ kind }) => kind === 'quote') ? undefined : '';
    } else if (space.columns < container.indent) return undefined;
    else at = skipColumns(line, at, container.indent);
  }
  return contentAt(line, at);
};

/**
 * Flags each line that belongs to fenced code, fence lines included: same marker,
 * closing at least as long (CommonMark), also when the fence sits in list items
 * and blockquotes, in any nesting. The quotes and list items opened on the fence's
 * first line must continue on each body line, measured in columns (tabs to the next
 * multiple of 4, the optional space after `>`, list content columns). A line that
 * ends one of them ends the fence too; a `>` or list marker that first appears in
 * the body is code. Indentation is otherwise allowed because authors indent inside
 * components. One pass; each line is read at most twice (again only when it ends
 * a fence's container). Shared by the reader's MDX normalizer, heading extraction
 * and search sections, so all three agree on what is code.
 */
export const fencedMarkdownLines = (lines: readonly string[]): boolean[] => {
  let fence: (MarkdownFence & { containers: FenceContainer[] }) | undefined;
  return lines.map((line) => {
    if (fence) {
      const content = fenceBodyContent(line, fence.containers);
      if (content !== undefined) {
        if (closesMarkdownFence(content, fence, Number.POSITIVE_INFINITY)) fence = undefined;
        return true;
      }
      // The container ended, so the fence did; this line starts afresh.
      fence = undefined;
    }
    const { containers, content } = openingContainers(line);
    const opening = openingMarkdownFence(content, Number.POSITIVE_INFINITY);
    fence = opening && { ...opening, containers };
    return Boolean(fence);
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
