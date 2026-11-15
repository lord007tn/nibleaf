// Frozen main at ec2d10d8; test-only byte reference for #664.
import type Token from 'markdown-it/lib/token.mjs';
import {
  authoredExportText,
  exportTextEnd,
  mayHaveActiveExportHtml,
  parseExportTokens,
  readExportHtml,
  renderedExportText,
} from './export-html-source';
import {
  captureExportStructure,
  compareExportStructure,
  type ExportHtmlRun,
  type ExportStructure,
  exportSourceLines,
  literalExportText,
} from './export-structure';

export { mayHaveActiveExportHtml } from './export-html-source';

const neutralize = (source: string, remaining = false, state = readExportHtml(source)) => {
  if (!state) return { output: source, active: 0 };
  const { tokens, spans, editable, code, leaders } = state;
  const ranges = new Int32Array(source.length + 1);
  const mark = (from: number, to: number) => {
    ranges[from] = (ranges[from] ?? 0) + 1;
    ranges[to] = (ranges[to] ?? 0) - 1;
  };
  for (const [from, to] of state.active) mark(from, to);
  for (const [from, to] of state.inert) mark(from, to);
  if (remaining)
    for (const span of spans)
      if (mayHaveActiveExportHtml(span.token.content)) {
        const first = span.positions[0];
        const last = span.positions.at(-1);
        if (first !== undefined && last !== undefined) mark(first, last + 1);
      }
  const inRange = new Uint8Array(source.length);
  let depth = 0;
  for (let at = 0; at < source.length; at++) {
    depth += ranges[at] ?? 0;
    if (depth > 0 && editable[at] && !code[at]) inRange[at] = 1;
  }
  const escaped = new Uint8Array(source.length);
  const model = captureExportStructure(source, tokens, state);
  const records = exportSourceLines(source);
  // Literalize the entire edited HTML run, including benign HTML that provided
  // shielding. The original inert contexts also remain protected beyond it.
  for (const run of model.runs) {
    const from = records[run.start]?.start ?? source.length;
    const to = records[run.end]?.start ?? source.length;
    if (!inRange.subarray(from, to).some(Boolean)) continue;
    for (let at = from; at < to; at++) if (editable[at] && !code[at]) inRange[at] = 1;
  }
  for (let at = 0; at < source.length; at++) if (inRange[at] && '<[]`~\\*_{'.includes(source[at] ?? '')) escaped[at] = 1;
  for (const at of leaders) if (inRange[at]) escaped[at] = 1;
  const output: string[] = [];
  let cursor = 0;
  for (let at = 0; at < source.length; at++)
    if (escaped[at]) {
      output.push(source.slice(cursor, at), source[at] === '<' ? '&lt;' : `&#${source.charCodeAt(at)};`);
      cursor = at + 1;
    }
  output.push(source.slice(cursor));
  return { output: output.join(''), active: state.active.length, escaped, tokens };
};

/** Neutralize only script/style/iframe/object/embed; URL/handler hardening is #664.
 * Main's projection remains authoritative. At most two targeted passes handle
 * newly exposed elements; the final bounded fallback escapes remaining HTML. */
const settle = (first: string): string => {
  let output = first;
  for (let pass = 0; pass < 2; pass++) {
    const result = neutralize(output, pass === 1);
    if (!result.active) return output;
    output = result.output;
  }
  return output;
};

/** Plain balanced runs add at most one separator on either side
 * of an edited raw-HTML run (blank outside lists, thematic inside), plus
 * whitespace padding on its own blank lines.
 * Container prefixes move to the separator; author/code bytes are retained. */
const boundedLiteralization = (model: ExportStructure, tokens: Token[], initial: Uint8Array, regions: ExportHtmlRun[]): string => {
  const source = model.source;
  const records = exportSourceLines(source);
  const lines = records.map((line) => line.text);
  const starts = records.map((line) => line.start);
  const flags = initial.slice();
  for (const run of regions)
    for (let index = run.first; index <= run.last; index++) {
      const row = (tokens[index]?.map?.[1] ?? 1) - 1;
      const line = lines[row] ?? '';
      for (let at = line.indexOf('</'); at >= 0; at = line.indexOf('</', at + 2)) {
        const close = line.slice(at, at + 11).toLowerCase();
        if (['</script>', '</style>', '</pre>', '</textarea>'].some((ending) => close.startsWith(ending))) flags[(starts[row] ?? 0) + at] = 0;
      }
    }
  const escapeLine = (line: string, row: number) => {
    const output: string[] = [];
    for (let at = 0; at < line.length; at++)
      output.push(flags[(starts[row] ?? 0) + at] ? (line[at] === '<' ? '&lt;' : `&#${line.charCodeAt(at)};`) : (line[at] ?? ''));
    return output.join('');
  };
  let output = settle(lines.map((line, row) => escapeLine(line, row) + (records[row]?.ending ?? '')).join(''));
  if (compareExportStructure(model, output, parseExportTokens(output)).equal) return output;
  const before = new Map(regions.map((run) => [run.start, run]));
  const after = new Map(regions.map((run) => [run.end, run]));
  const body: string[] = [];
  const origins: Array<number | null> = [];
  for (const [row, line] of lines.entries()) {
    const ending = after.get(row);
    if (ending) {
      body.push(ending.continuation + (ending.inList ? '***' : '') + (records[row - 1]?.ending || records[row]?.ending || '\n'));
      origins.push(null);
    }
    const opening = before.get(row);
    if (opening) {
      body.push(opening.prefix + (opening.inList ? '***' : '') + (records[row]?.ending || records[row - 1]?.ending || '\n'));
      origins.push(null);
      body.push(opening.continuation + escapeLine(line, row).slice(opening.prefix.length) + (records[row]?.ending ?? ''));
    } else body.push(escapeLine(line, row) + (records[row]?.ending ?? ''));
    origins.push(row);
  }
  output = settle(body.join(''));
  if (compareExportStructure(model, output, parseExportTokens(output)).equal) return output;
  const blanks = new Set(regions.flatMap((run) => run.blanks));
  for (let row = 0; row < body.length; row++) {
    const original = origins[row];
    if (original != null && blanks.has(original)) {
      const ending = records[original]?.ending ?? '';
      const line = body[row] ?? '';
      body[row] = `${ending ? line.slice(0, -ending.length) : line}&#32;${ending}`;
    }
  }
  const bounded = settle(body.join(''));
  return compareExportStructure(model, bounded, parseExportTokens(bounded)).equal ? bounded : literalExportText(model);
};

/** Risky runs become literal text before any structural repair is attempted. */
const literalizeRun = (source: string, state: NonNullable<ReturnType<typeof readExportHtml>>, model: ExportStructure): string => {
  const owned = new Uint8Array(source.length);
  for (const range of model.literal ?? []) owned.fill(1, range.from, range.to);
  const leaders = new Set(state.leaders);
  const pieces: string[] = [];
  for (let at = 0; at < source.length; at++) {
    const c = source[at] ?? '';
    if (!owned[at]) pieces.push(c);
    else if (c === '<') pieces.push('&lt;');
    else if (c === '&') pieces.push('&amp;');
    else if (state.editable[at] && ('[]`~\\*_{'.includes(c) || leaders.has(at))) pieces.push(`&#${source.charCodeAt(at)};`);
    else pieces.push(c);
  }
  const output = pieces.join('');
  if (!compareExportStructure(model, output, parseExportTokens(output)).equal) return literalExportText(model);
  const visible = renderedExportText(output);
  const records = exportSourceLines(source);
  let visibleAt = 0;
  for (const range of model.literal ?? []) {
    const run = model.runs[range.run];
    const expected =
      run && range.from === records[run.start]?.start && range.to === (records[run.end]?.start ?? source.length)
        ? state.tokens
            .slice(run.first, run.last + 1)
            .map((token) => token.content)
            .join('')
        : source.slice(range.from, range.to).replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\0', '\uFFFD');
    const end = exportTextEnd(authoredExportText(expected), visible, visibleAt);
    if (end < 0) return literalExportText(model);
    visibleAt = end;
  }
  return output;
};

export const escapeDisallowedExportHtml = (source: string): string => {
  const state = readExportHtml(source);
  if (!state) return source;
  const model = captureExportStructure(source, state.tokens, state);
  if (model.risky) return literalizeRun(source, state, model);
  const first = neutralize(source, false, state);
  if (!first.active || !first.tokens || !first.escaped) return literalExportText(model);
  const output = settle(first.output);
  const comparison = compareExportStructure(model, output, parseExportTokens(output));
  if (comparison.equal) return output;
  return boundedLiteralization(model, first.tokens, first.escaped, comparison.regions);
};
