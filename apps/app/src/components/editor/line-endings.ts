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
 * Lines are matched the way a line diff finds them: the lines the source and the
 * save start and end with, then lines found once in each, in order, and around
 * them again. The work is bounded by a small multiple of the page's length, so a
 * save stays linear; past it, lines not matched yet take the common ending.
 */

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
  // A lone CR, an empty line and an LF read as one CRLF: the empty line would be
  // lost on the next load. That CR takes the page's ending instead (LF when the
  // page's ending is CR).
  const apart: LineEnding = source.dominant === '\r' ? '\n' : source.dominant;
  for (let index = endings.length - 2; index >= 0; index--) {
    if (endings[index] === '\r' && lines[index + 1] === '' && endings[index + 1] === '\n') endings[index] = apart;
  }
  const pieces: string[] = [];
  for (const [index, line] of lines.entries()) {
    pieces.push(line);
    if (index < endings.length) pieces.push(endings[index] as LineEnding);
  }
  return pieces.join('');
}
