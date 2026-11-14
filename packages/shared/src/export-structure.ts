import type Token from 'markdown-it/lib/token.mjs';

type LineMap = [number, number] | null;
type Code = [string, string, string, string];
interface Block {
  type: string;
  nesting: number;
  hidden: boolean;
  map: LineMap;
  code?: Code[];
}
export interface ExportHtmlRun {
  start: number;
  end: number;
  first: number;
  last: number;
  prefix: string;
  continuation: string;
  blanks: number[];
  inList: boolean;
}
export interface ExportStructure {
  source: string;
  blocks: Block[];
  runs: ExportHtmlRun[];
}

/** Markdown's line maps count CR, CRLF and LF as one line ending. Keep the
 * original delimiter separately so structural checks never rewrite code. */
export const exportSourceLines = (source: string) => {
  const lines: Array<{ text: string; ending: string; start: number }> = [];
  let start = 0;
  for (let at = 0; at < source.length; at++) {
    if (source[at] !== '\r' && source[at] !== '\n') continue;
    const ending = source[at] === '\r' && source[at + 1] === '\n' ? '\r\n' : (source[at] ?? '');
    lines.push({ text: source.slice(start, at), ending, start });
    at += ending.length - 1;
    start = at + 1;
  }
  lines.push({ text: source.slice(start), ending: '', start });
  return lines;
};

const container = (type: string) =>
  !['paragraph_open', 'paragraph_close', 'heading_open', 'heading_close'].includes(type) && (type.endsWith('_open') || type.endsWith('_close'));

/** Capture main once. Adjacent HTML blocks form a run only without a blank
 * line or any intervening container/non-HTML token. No tree recursion. */
export const captureExportStructure = (source: string, tokens: Token[]): ExportStructure => {
  const lines = exportSourceLines(source).map((line) => line.text);
  const runs: ExportHtmlRun[] = [];
  const blocks: Block[] = [];
  let listDepth = 0;
  for (const [index, token] of tokens.entries()) {
    if (token.type === 'list_item_open') listDepth++;
    if (token.type === 'list_item_close') listDepth--;
    const block: Block = { type: token.type, nesting: token.nesting, hidden: token.hidden, map: token.map };
    const code: Code[] = [];
    const pending = [token];
    while (pending.length) {
      const child = pending.pop();
      if (!child) continue;
      if (['fence', 'code_block', 'code_inline'].includes(child.type)) code.push([child.type, child.content, child.markup, child.info]);
      if (child.children)
        for (let at = child.children.length - 1; at >= 0; at--) {
          const nested = child.children[at];
          if (nested) pending.push(nested);
        }
    }
    if (code.length) block.code = code;
    blocks.push(block);
    if (token.type !== 'html_block' || !token.map) continue;
    let run = runs.at(-1);
    if (!run || run.last !== index - 1 || run.end !== token.map[0]) {
      const line = lines[token.map[0]] ?? '';
      // The parser has already identified an HTML block. Its first '<' follows
      // only container syntax/indentation; token.content can have virtual tab
      // spaces or normalized NUL characters that are absent in source bytes.
      const at = line.indexOf('<');
      const prefix = at < 0 ? '' : line.slice(0, at);
      run = {
        start: token.map[0],
        end: token.map[1],
        first: index,
        last: index,
        prefix,
        continuation: Array.from(prefix, (c) => (c === '>' || c === ' ' || c === '\t' ? c : ' ')).join(''),
        blanks: [],
        inList: listDepth > 0,
      };
      runs.push(run);
    }
    run.end = token.map[1];
    run.last = index;
    const content = token.content.split('\n');
    for (let row = token.map[0]; row < token.map[1]; row++)
      if (Array.from(content[row - token.map[0]] ?? '').every((c) => c === ' ' || c === '\t')) run.blanks.push(row);
  }
  return { source, blocks, runs };
};

const literalLine = (source: string, output: string, escapes: boolean): boolean => {
  let at = 0;
  for (let index = 0; index < source.length; index++) {
    const c = source[index];
    if (c === output[at]) {
      at++;
      continue;
    }
    if (!escapes || !c || !'<[]`~\\*_{>+-#=.) \t'.includes(c)) return false;
    const entity = c === '<' ? '&lt;' : `&#${source.charCodeAt(index)};`;
    if (!output.startsWith(entity, at)) return false;
    at += entity.length;
  }
  return at === output.length;
};

const mapped = (map: LineMap, origins: readonly (number | null)[]): LineMap => {
  if (!map) return null;
  let first = map[0];
  let last = map[1] - 1;
  while (first <= last && origins[first] == null) first++;
  while (last >= first && origins[last] == null) last--;
  const start = origins[first];
  const end = origins[last];
  return start == null || end == null ? null : [start, end + 1];
};

const snapshot = (blocks: Block[], regions: ExportHtmlRun[], origins: readonly (number | null)[], separators: Set<number>) => {
  const result: unknown[] = [];
  const emitted = new Set<number>();
  let region: ExportHtmlRun | undefined;
  let next = 0;
  for (const block of blocks) {
    const map = mapped(block.map, origins);
    if (block.type === 'hr' && map === null && block.map && separators.has(block.map[0])) continue;
    const structural = container(block.type);
    if (structural) region = undefined;
    else if (map) {
      while (regions[next] && (regions[next]?.end ?? 0) <= map[0]) next++;
      const run = regions[next];
      region = run && map[0] >= run.start && map[1] <= run.end ? run : undefined;
      if (!region && run && map[0] < run.end && map[1] > run.start) result.push(['crossed region', map]);
    }
    if (!structural && region) {
      if (!emitted.has(region.start)) {
        result.push(['region', region.start, region.end]);
        emitted.add(region.start);
      }
      continue;
    }
    result.push([block.type, block.nesting, block.hidden, map, block.code]);
  }
  return JSON.stringify(result);
};

/** Align only the documented edits: escapes in original HTML, one separator
 * at either run boundary, and whitespace padding on that run's blank lines.
 * Every original line occurs once, in order. Code and block structure outside
 * the regions remain exact; literalization escapes never discard prose. */
export const compareExportStructure = (main: ExportStructure, output: string, tokens: Token[]) => {
  const originalLines = exportSourceLines(main.source);
  const outputLines = exportSourceLines(output);
  const source = originalLines.map((line) => line.text);
  const lines = outputLines.map((line) => line.text);
  const owned = new Map<number, ExportHtmlRun>();
  const starts = new Map<number, ExportHtmlRun>();
  const ends = new Map<number, ExportHtmlRun>();
  for (const run of main.runs) {
    starts.set(run.start, run);
    ends.set(run.end, run);
    for (let row = run.start; row < run.end; row++) owned.set(row, run);
  }
  const blanks = new Set(main.runs.flatMap((run) => run.blanks));
  const origins: Array<number | null> = [];
  const separators = new Set<number>();
  const before = new Set<number>();
  const after = new Set<number>();
  const changed = new Set<ExportHtmlRun>();
  const escaped = new Set<ExportHtmlRun>();
  let row = 0;
  let preserved = true;
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at] ?? '';
    const run = owned.get(row);
    const first = starts.get(row);
    const end = ends.get(row);
    let original = source[row];
    if (original === undefined) {
      preserved = false;
      origins.push(null);
      continue;
    }
    const boundary = end && !after.has(row) && (escaped.has(end) || before.has(end.start));
    let extra = false;
    if (boundary && original === line) {
      let mainEnd = row;
      let outputEnd = at;
      while (source[mainEnd] === line) mainEnd++;
      while (lines[outputEnd] === line) outputEnd++;
      extra = outputEnd - at > mainEnd - row;
    }
    if (boundary && line === `${end.continuation}***` && extra) {
      origins.push(null);
      separators.add(at);
      after.add(row);
      changed.add(end);
      continue;
    }
    if (boundary && !end.inList && line === end.continuation && extra) {
      origins.push(null);
      after.add(row);
      changed.add(end);
      continue;
    }
    if (first && before.has(first.start)) original = first.continuation + original.slice(first.prefix.length);
    const padding = blanks.has(row) && line.endsWith('&#32;');
    const actual = padding ? line.slice(0, -5) : line;
    if (literalLine(original, actual, true)) {
      if (originalLines[row]?.ending !== outputLines[at]?.ending) preserved = false;
      origins.push(row);
      if (source[row] !== line && run) changed.add(run);
      if (original !== actual && run) escaped.add(run);
      row++;
      continue;
    }
    if (first && !before.has(row) && line === `${first.prefix}***`) {
      origins.push(null);
      separators.add(at);
      before.add(row);
      changed.add(first);
      continue;
    }
    if (first && !first.inList && !before.has(row) && line === first.prefix) {
      origins.push(null);
      before.add(row);
      changed.add(first);
      continue;
    }
    if (boundary && line === `${end.continuation}***`) {
      origins.push(null);
      separators.add(at);
      after.add(row);
      changed.add(end);
      continue;
    }
    // Existing approved outside-list blank separator, immediately after HTML.
    if (boundary && !end.inList && line === end.continuation) {
      origins.push(null);
      after.add(row);
      changed.add(end);
      continue;
    }
    preserved = false;
    origins.push(row++);
  }
  if (row !== source.length) preserved = false;
  for (const run of changed) if (!escaped.has(run)) preserved = false;
  const regions = main.runs.filter((run) => escaped.has(run));
  const current = captureExportStructure(output, tokens);
  const identity = source.map((_, index) => index);
  const equal = snapshot(main.blocks, regions, identity, new Set()) === snapshot(current.blocks, regions, origins, separators);
  return { equal: equal && preserved, preserved, regions, origins, separators, boundaryCount: before.size + after.size };
};
