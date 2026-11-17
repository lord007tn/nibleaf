/*
 * A page keeps its line endings (#702). The editor reads and writes Markdown with
 * LF only: markdown-it turns every CRLF and lone CR into LF before any rule runs,
 * and the serializer writes LF. So a page written with CRLF (on Windows, or by a
 * Git checkout with `core.autocrlf`) came back with LF on every line the first
 * time it was edited, attribute values and code included, even lines the writer
 * never touched.
 *
 * Now the page is read as LF, with the ending each of its lines had kept aside,
 * and a save puts them back: every line the save writes exactly as the source had
 * it gets its own ending again, so a page with no edit saves byte for byte, and a
 * mixed CRLF/LF page keeps each line's own. A line the save writes differently
 * (edited, re-wrapped, new) gets the page's most common ending. A page with no CR
 * at all is not touched: it saves exactly as before.
 *
 * A lone CR is a line ending, as CommonMark and markdown-it read it, and is kept
 * like the others; it is never written into a line's text. It is never written
 * before an empty line and an LF either, which would read as one CRLF and lose
 * that line: a save always reads back line for line as the serializer wrote it.
 *
 * The pure compatibility helpers match lines the way a line diff finds them:
 * the lines the source and the save start and end with, then lines found once
 * in each, in order, and around
 * them again. The work is bounded by a small multiple of the page's length, so a
 * save stays linear; past it, lines not matched yet take the common ending.
 * The editor uses that alignment only when loading. It then attributes serialized
 * lines to document ranges and maps those ranges through editor steps (#754), so
 * repeated text cannot transfer an ending to a different surviving line.
 */

import type { Node as PMNode } from '@tiptap/pm/model';
import type { Mappable } from '@tiptap/pm/transform';

export type LineEnding = '\r\n' | '\n' | '\r';

const LINE_ENDING = /\r\n|\r|\n/g;
const CARRIAGE_RETURN = /\r\n?/g;

/** A page's source: its text with LF endings, its lines and the ending after each. */
export interface SourceLineEndings {
  /** The page as written. */
  readonly source: string;
  /** The page with LF endings, as the editor reads it. */
  readonly normalized: string;
  /** Its lines, without endings. */
  readonly lines: readonly string[];
  /** The ending after each line but the last. */
  readonly endings: readonly LineEnding[];
  /** The ending most lines have: what a line the save writes anew gets. */
  readonly dominant: LineEnding;
}

/** `source` with LF endings: what the editor reads. */
export const normalizeLineEndings = (source: string): string => (source.includes('\r') ? source.replace(CARRIAGE_RETURN, '\n') : source);

/** The line endings of `source`, or null when it has only LF (nothing to restore). */
export function readLineEndings(source: string): SourceLineEndings | null {
  if (!source.includes('\r')) return null;
  const lines: string[] = [];
  const endings: LineEnding[] = [];
  const counts = { '\r\n': 0, '\n': 0, '\r': 0 };
  let start = 0;
  for (const match of source.matchAll(LINE_ENDING)) {
    const ending = match[0] as LineEnding;
    lines.push(source.slice(start, match.index));
    endings.push(ending);
    counts[ending] += 1;
    start = match.index + ending.length;
  }
  lines.push(source.slice(start));
  // Ties go to CRLF, then LF: a page with any CR was written with CR in mind.
  const dominant: LineEnding = counts['\r\n'] >= counts['\n'] && counts['\r\n'] >= counts['\r'] ? '\r\n' : counts['\n'] >= counts['\r'] ? '\n' : '\r';
  return { source, normalized: lines.join('\n'), lines, endings, dominant };
}

/** The ending `source` ends with, or '' (a page's last line break, which the serializer leaves out). */
export const finalLineEnding = (source: string): '' | LineEnding =>
  source.endsWith('\r\n') ? '\r\n' : source.endsWith('\n') ? '\n' : source.endsWith('\r') ? '\r' : '';

/** How much matching work a save may do, per line of the source and the save together. */
const WORK_PER_LINE = 16;

/**
 * For each line of `saved`, the line of `source` it is, or -1 (see the note at the
 * top). Matches are in order: a later line of the save never matches an earlier
 * line of the source.
 */
export function matchLines(source: readonly string[], saved: readonly string[]): Int32Array {
  const match = new Int32Array(saved.length).fill(-1);
  let budget = WORK_PER_LINE * (source.length + saved.length);
  const ranges: Array<[number, number, number, number]> = [[0, source.length, 0, saved.length]];
  while (ranges.length > 0 && budget > 0) {
    let [a0, a1, b0, b1] = ranges.pop() as [number, number, number, number];
    while (a0 < a1 && b0 < b1 && source[a0] === saved[b0]) match[b0++] = a0++;
    while (a0 < a1 && b0 < b1 && source[a1 - 1] === saved[b1 - 1]) match[--b1] = --a1;
    if (a0 >= a1 || b0 >= b1) continue;
    budget -= a1 - a0 + (b1 - b0);
    // Lines found exactly once on each side, in the save's order.
    const seen = new Map<string, { inSource: number; at: number; inSaved: number }>();
    for (let a = a0; a < a1; a++) {
      const line = source[a] as string;
      const entry = seen.get(line);
      if (entry) entry.inSource += 1;
      else seen.set(line, { inSource: 1, at: a, inSaved: 0 });
    }
    const pairs: Array<[number, number]> = [];
    for (let b = b0; b < b1; b++) {
      const entry = seen.get(saved[b] as string);
      if (entry) entry.inSaved += 1;
    }
    for (let b = b0; b < b1; b++) {
      const entry = seen.get(saved[b] as string);
      if (entry && entry.inSource === 1 && entry.inSaved === 1) pairs.push([entry.at, b]);
    }
    const anchors = longestIncreasing(pairs);
    if (anchors.length === 0) continue;
    // The ranges between anchors, each read again for its own ends and unique lines.
    let sourceFrom = a0;
    let savedFrom = b0;
    for (const [a, b] of anchors) {
      match[b] = a;
      if (sourceFrom < a && savedFrom < b) ranges.push([sourceFrom, a, savedFrom, b]);
      sourceFrom = a + 1;
      savedFrom = b + 1;
    }
    if (sourceFrom < a1 && savedFrom < b1) ranges.push([sourceFrom, a1, savedFrom, b1]);
  }
  return match;
}

/** The longest run of `pairs` (in order of their second value) whose first values
 *  also increase: patience sorting, O(k log k). */
function longestIncreasing(pairs: ReadonlyArray<[number, number]>): Array<[number, number]> {
  const tails: number[] = [];
  const previous = new Int32Array(pairs.length);
  for (const [index, [a]] of pairs.entries()) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((pairs[tails[middle] as number] as [number, number])[0] < a) low = middle + 1;
      else high = middle;
    }
    previous[index] = low > 0 ? (tails[low - 1] as number) : -1;
    tails[low] = index;
  }
  const run: Array<[number, number]> = [];
  for (let index = tails.length > 0 ? (tails[tails.length - 1] as number) : -1; index >= 0; index = previous[index] as number) {
    run.push(pairs[index] as [number, number]);
  }
  return run.reverse();
}

/**
 * `saved` (LF only, as the serializer writes it) with the source's line endings
 * put back (see the note at the top). Unchanged when the source had only LF.
 */
export function restoreLineEndings(source: SourceLineEndings | null, saved: string): string {
  if (!source) return saved;
  const restored = putBackLineEndings(source, saved);
  // The save reads back as the serializer wrote it, line for line; if it ever
  // didn't, LF is saved rather than a page that loses a line.
  return normalizeLineEndings(restored) === saved ? restored : saved;
}

/** `restoreLineEndings` without its read-back check (tested on its own). */
export function putBackLineEndings(source: SourceLineEndings, saved: string): string {
  if (saved === source.normalized) return source.source;
  const lines = saved.split('\n');
  const match = matchLines(source.lines, lines);
  const last = source.lines.length - 1;
  const endings: LineEnding[] = [];
  for (let index = 0; index < lines.length - 1; index++) {
    const at = match[index] as number;
    endings.push(at >= 0 && at < last ? (source.endings[at] as LineEnding) : source.dominant);
  }
  return joinLineEndings(lines, endings, source.dominant);
}

function joinLineEndings(lines: readonly string[], endings: LineEnding[], dominant: LineEnding, retained?: readonly boolean[]): string {
  // A lone CR, an empty line and an LF read as one CRLF: the empty line would be
  // lost on the next load. That CR takes the page's ending instead (LF when the
  // page's ending is CR).
  const apart: LineEnding = dominant === '\r' ? '\n' : dominant;
  for (let index = endings.length - 2; index >= 0; index--) {
    if (endings[index] === '\r' && lines[index + 1] === '' && endings[index + 1] === '\n') {
      if (retained?.[index] && !retained[index + 1]) endings[index + 1] = '\r\n';
      else endings[index] = apart;
    }
  }
  const pieces: string[] = [];
  for (const [index, line] of lines.entries()) {
    pieces.push(line);
    if (index < endings.length) pieces.push(endings[index] as LineEnding);
  }
  return pieces.join('');
}

/** A serializer chunk's nearest block, with its position in the editor document. */
export interface SerializedLineOwner {
  readonly node: PMNode;
  readonly position: number;
  readonly depth: number;
  readonly edge: 'start' | 'body' | 'end';
}

export interface PositionedLine {
  readonly from: number;
  readonly to: number;
  readonly part: string;
  readonly slot: number;
  readonly assoc: -1 | 1;
  readonly text: string;
  readonly newline: boolean;
}

export interface SerializedPage {
  readonly markdown: string;
  readonly lines: readonly PositionedLine[];
}

interface EndingAnchor extends PositionedLine {
  readonly ending: LineEnding;
}

export interface PositionedLineEndings {
  readonly source: SourceLineEndings;
  readonly anchors: readonly EndingAnchor[];
  readonly pristine: boolean;
}

const blankLine = (text: string) => /^[ \t>]*$/.test(text);

/**
 * Attribute the serializer's lines to editor ranges. Container prefixes defer to
 * their deeper child. Delayed block separators retain the block that closed them.
 * Code lines use their actual text ranges, so identical lines remain distinct.
 */
export function positionedLines(pieces: Iterable<{ text: string; owner: SerializedLineOwner | null }>): PositionedLine[] {
  const rows: Array<{ text: string; owner: SerializedLineOwner | null; newline: boolean }> = [];
  let text = '';
  let owner: SerializedLineOwner | null = null;
  for (const piece of pieces) {
    let start = 0;
    for (;;) {
      const end = piece.text.indexOf('\n', start);
      const part = piece.text.slice(start, end < 0 ? undefined : end);
      if (part && piece.owner && (!owner || piece.owner.depth >= owner.depth)) owner = piece.owner;
      text += part;
      if (end < 0) break;
      rows.push({ text, owner: owner ?? piece.owner, newline: true });
      text = '';
      owner = null;
      start = end + 1;
    }
  }
  if (text !== '' || owner) rows.push({ text, owner, newline: false });
  const groups = new Map<string, number[]>();
  for (const [index, row] of rows.entries()) {
    if (!row.owner) continue;
    const key = `${row.owner.position}:${row.owner.edge}`;
    const group = groups.get(key);
    if (group) group.push(index);
    else groups.set(key, [index]);
  }
  const result: PositionedLine[] = rows.map((row) => ({
    from: -1,
    to: -1,
    part: 'unknown',
    slot: 0,
    assoc: 1,
    text: row.text,
    newline: row.newline,
  }));
  for (const indexes of groups.values()) {
    const first = rows[indexes[0] as number];
    const block = first?.owner;
    if (!block) continue;
    const { node, position, edge } = block;
    let last = indexes.length;
    while (last > 0 && blankLine(rows[indexes[last - 1] as number]?.text ?? '')) last--;
    const code = node.type.name === 'codeBlock';
    const table = node.type.name === 'table' && /^[ \t>]*(?:(?:[-+*]|\d+[.)])[ \t]+)?\|/.test(first?.text ?? '');
    const tableRows: Array<{ from: number; to: number }> = [];
    if (table)
      node.forEach((row, offset) => {
        tableRows.push({ from: position + 1 + offset, to: position + 1 + offset + row.nodeSize });
      });
    const codeLines = code && node.textContent !== '' ? node.textContent.split('\n') : [];
    // Empty code may have an authored blank body line, or close immediately.
    if (code && codeLines.length === 0 && last > 2) codeLines.push('');
    if (code) last = Math.max(last, Math.min(indexes.length, codeLines.length + 1));
    let offset = position + 1;
    for (const [ordinal, index] of indexes.entries()) {
      const row = rows[index];
      if (!row) continue;
      let from = position;
      let to = position + node.nodeSize;
      let part: string = edge;
      let slot = ordinal;
      let assoc: -1 | 1 = 1;
      if (ordinal >= last) {
        if (edge === 'start' && node.type.name !== 'table') {
          to = from + 1;
          part = 'start-after';
        } else {
          from = to;
          part = 'after';
        }
        slot = ordinal - last;
        assoc = -1;
      } else if (table) {
        const row = tableRows[ordinal === 0 ? 0 : ordinal - 1];
        if (row) {
          from = row.from;
          to = ordinal === 1 ? from + 1 : row.to;
          part = ordinal === 1 ? 'table-rule' : 'table-row';
          slot = 0;
        }
      } else if (code && ordinal > 0 && ordinal <= codeLines.length) {
        const line = codeLines[ordinal - 1] ?? '';
        from = offset;
        to = from + line.length;
        offset = to + 1;
        part = 'code';
        slot = 0;
      } else if (code || edge !== 'body') {
        const closing = edge === 'end' || (code && ordinal > 0);
        from = closing ? position + node.nodeSize - 1 : position;
        to = closing ? from : from + 1;
        part = closing ? 'end' : 'start';
        slot = code ? 0 : ordinal;
      }
      result[index] = { from, to, part, slot, assoc, text: row.text, newline: row.newline };
    }
  }
  return result;
}

/** The load-time compatibility alignment happens once; edits never match text. */
export function createPositionedLineEndings(source: SourceLineEndings, serialize: () => SerializedPage): PositionedLineEndings {
  // Common endings need no anchors: new and untouched lines already use them.
  // Uniform CRLF/CR pages therefore need neither position collection nor mapping.
  if (source.endings.every((ending) => ending === source.dominant)) return { source, pristine: true, anchors: [] };
  const page = serialize();
  const endings = restoreLineEndings(source, page.markdown).match(LINE_ENDING) ?? [];
  return {
    source,
    pristine: true,
    anchors: page.lines.flatMap((line, index) => {
      const ending = (endings[index] as LineEnding) ?? source.dominant;
      return line.newline && line.from >= 0 && ending !== source.dominant ? [{ ...line, ending }] : [];
    }),
  };
}

/** Map source ownership through actual editor steps, including history mirrors. */
export function mapLineEndings(state: PositionedLineEndings, mapping: Mappable): PositionedLineEndings {
  if (state.anchors.length === 0) return { ...state, pristine: false };
  const anchors: EndingAnchor[] = [];
  for (const line of state.anchors) {
    const point = line.from === line.to;
    const from = mapping.mapResult(line.from, point ? line.assoc : 1);
    const to = mapping.mapResult(line.to, point ? line.assoc : -1);
    if (!from.deleted && !to.deleted && from.pos <= to.pos)
      anchors.push(from.pos === line.from && to.pos === line.to ? line : { ...line, from: from.pos, to: to.pos });
  }
  return { source: state.source, anchors, pristine: false };
}

const positionKey = (line: PositionedLine) => `${line.from}:${line.to}:${line.part}:${line.slot}`;

export function restorePositionedLineEndings(state: PositionedLineEndings, page: SerializedPage): string {
  if (state.pristine && page.markdown === state.source.normalized) return state.source.source;
  if (state.anchors.length === 0) return page.markdown.replace(/\n/g, state.source.dominant);
  const anchors = new Map(state.anchors.map((line) => [positionKey(line), line]));
  const endings: LineEnding[] = [];
  const retained: boolean[] = [];
  for (const line of page.lines) {
    if (!line.newline) continue;
    const original = anchors.get(positionKey(line));
    if (original && original.text === line.text) {
      endings.push(original.ending);
      retained.push(true);
    } else {
      endings.push(state.source.dominant);
      retained.push(false);
    }
  }
  const restored = joinLineEndings(
    page.lines.map((line) => line.text),
    endings,
    state.source.dominant,
    retained,
  );
  return normalizeLineEndings(restored) === page.markdown ? restored : page.markdown;
}
