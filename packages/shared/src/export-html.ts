import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import { type DefaultTreeAdapterTypes, parseFragment } from 'parse5';
import { captureExportStructure, compareExportStructure, type ExportHtmlRun, type ExportStructure, exportSourceLines } from './export-structure';

const ACTIVE_TAGS = ['script', 'style', 'iframe', 'object', 'embed'];
/** HTML element names are contiguous after `<`. This is only a sound prefilter;
 * Markdown and parse5 decide whether a matching substring is a live element. */
export const mayHaveActiveExportHtml = (source: string): boolean => {
  const lower = source.toLowerCase();
  return ACTIVE_TAGS.some((tag) => lower.includes(`<${tag}`));
};
const markdown = new MarkdownIt({ html: true });
const inlineStarts = new WeakMap<Token, number>();
const inlineCode = new WeakMap<Token, string>();
const BaseInlineState = markdown.inline.State;
markdown.inline.State = class extends BaseInlineState {
  override push(type: string, tag: string, nesting: Token['nesting']): Token {
    const token = super.push(type, tag, nesting);
    if (type === 'html_inline' || type === 'code_inline' || type === 'image') inlineStarts.set(token, this.pos);
    if (type === 'code_inline') inlineCode.set(token, this.src);
    return token;
  }
};
interface HtmlSpan {
  token: Token;
  from: number;
  to: number;
  positions: number[];
}

/** One bounded neutralization pass. Source intervals come from live parse5
 * elements; Markdown container prefixes and actual code remain opaque. */
const neutralize = (source: string, remaining = false): { output: string; active: number; escaped?: Uint8Array; tokens?: Token[] } => {
  if (!mayHaveActiveExportHtml(source)) return { output: source, active: 0 };
  const input = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\0', '\uFFFD');
  const env = {};
  const tokens = markdown.parse(input, env);
  const inspect = [...tokens];
  let candidate = false;
  while (inspect.length) {
    const token = inspect.pop();
    if (!token) continue;
    if ((token.type === 'html_block' || token.type === 'html_inline') && mayHaveActiveExportHtml(token.content)) {
      candidate = true;
      break;
    }
    if (token.children) for (const child of token.children) inspect.push(child);
  }
  if (!candidate) return { output: source, active: 0 };
  const offsets: number[] = [];
  if (input !== source) {
    for (let at = 0; at < source.length; at++) {
      offsets.push(at);
      if (source[at] === '\r' && source[at + 1] === '\n') at++;
    }
    offsets.push(source.length);
  }
  const originalOffset = (at: number) => (input === source ? Math.min(at, source.length) : (offsets[at] ?? source.length));
  const lines = input.split('\n');
  const lineStarts = [0];
  for (const line of lines) lineStarts.push((lineStarts.at(-1) ?? 0) + line.length + 1);
  const lineCursors = new Uint32Array(lines.length);
  let tableDepth = 0;
  const tableLines = new Map<number, { text: string; positions: number[] }>();
  const positionsFor = (content: string, map: [number, number]): number[] => {
    const positions: number[] = [];
    let lineAt = map[0];
    for (const line of content.split('\n')) {
      const raw = lines[lineAt] ?? '';
      let row = tableLines.get(lineAt);
      if (tableDepth && !row && raw.includes('\\|')) {
        const text: string[] = [];
        const positions: number[] = [];
        for (let at = 0; at < raw.length; at++) {
          if (raw[at] === '\\' && raw[at + 1] === '|') continue;
          text.push(raw[at] ?? '');
          positions.push((lineStarts[lineAt] ?? 0) + at);
        }
        positions.push((lineStarts[lineAt] ?? 0) + raw.length);
        row = { text: text.join(''), positions };
        tableLines.set(lineAt, row);
      }
      const original = tableDepth && row ? row.text : raw;
      const sourceAt = (at: number) => originalOffset(tableDepth && row ? (row.positions[at] ?? input.length) : (lineStarts[lineAt] ?? 0) + at);
      let leading = 0;
      while (line[leading] === ' ' || line[leading] === '\t') leading++;
      let cursor = original.indexOf(line, lineCursors[lineAt] ?? 0);
      if (cursor >= 0) {
        for (let at = 0; at < line.length; at++) positions.push(sourceAt(cursor + at));
        cursor += line.length;
      } else {
        cursor = lineCursors[lineAt] ?? 0;
        const tail = original.indexOf(line.slice(leading), cursor);
        let leadingAt = tail >= 0 ? tail : cursor;
        let columns = leading;
        while (leadingAt > cursor && columns > 0 && [' ', '\t'].includes(original[leadingAt - 1] ?? '')) {
          columns -= original[leadingAt - 1] === '\t' ? 4 : 1;
          leadingAt--;
        }
        if (tail >= 0) cursor = tail;
        for (let at = 0; at < line.length; at++) {
          if (at < leading) {
            positions.push(sourceAt(leadingAt));
            continue;
          }
          const found = original.indexOf(line[at] ?? '', cursor);
          if (found >= 0) cursor = found;
          positions.push(sourceAt(cursor));
          if (found >= 0) cursor++;
        }
      }
      lineCursors[lineAt] = cursor;
      positions.push(sourceAt(original.length));
      lineAt++;
    }
    positions.length = content.length;
    return positions;
  };

  const editable = new Uint8Array(source.length);
  const code = new Uint8Array(source.length);
  const leaders: number[] = [];
  const allow = (content: string, positions: number[]) => {
    for (const at of positions) editable[at] = 1;
    let line = 0;
    while (line < content.length) {
      let first = line;
      let indent = 0;
      while (content[first] === ' ' || content[first] === '\t') {
        indent += content[first] === '\t' ? 4 : 1;
        first++;
      }
      if (indent >= 4 && positions[line] !== undefined) leaders.push(positions[line] as number);
      if ('>+-#='.includes(content[first] ?? '') && content[first] && positions[first] !== undefined) leaders.push(positions[first] as number);
      let end = first;
      while (end < first + 9 && (content[end] ?? '') >= '0' && (content[end] ?? '') <= '9') end++;
      if (
        end > first &&
        (content[end] === '.' || content[end] === ')') &&
        [' ', '\t', '\n', ''].includes(content[end + 1] ?? '') &&
        positions[end] !== undefined
      )
        leaders.push(positions[end] as number);
      const newline = content.indexOf('\n', line);
      if (newline < 0) break;
      line = newline + 1;
    }
  };
  const chunks: string[] = [];
  const spans: HtmlSpan[] = [];
  const renderedBounds: Array<{ from: number; to: number; end: number }> = [];
  let length = 0;
  let map: [number, number] = [0, lines.length];
  const protectInlineCode = (token: Token, positions: number[]) => {
    const start = inlineStarts.get(token) ?? 0;
    let end = start + token.markup.length;
    // Original characters corresponding to code are found from the inline
    // source captured by the parser, rather than normalized token.content.
    const location = inlineCode.get(token);
    if (location) {
      let at = start + token.markup.length;
      for (;;) {
        const next = location.indexOf('`', at);
        if (next < 0) throw new Error('Missing parsed code delimiter');
        at = next;
        while (location[at] === '`') at++;
        if (at - next === token.markup.length) {
          end = at;
          break;
        }
      }
    }
    for (let at = start; at < end; at++) {
      const original = positions[at];
      if (original !== undefined) code[original] = 1;
    }
  };
  const frames = [{ tokens, at: 0, positions: [] as number[] }];
  while (frames.length) {
    const frame = frames.at(-1);
    if (!frame) break;
    const token = frame.tokens[frame.at++];
    if (!token) {
      frames.pop();
      continue;
    }
    if (token.type === 'table_open') tableDepth++;
    if (token.type === 'table_close') tableDepth--;
    if (token.map) map = token.map;
    if (token.type === 'inline') {
      const positions = positionsFor(token.content, token.map ?? map);
      allow(token.content, positions);
      frames.push({ tokens: token.children ?? [], at: 0, positions });
      continue;
    }
    if ((token.type === 'fence' || token.type === 'code_block') && token.map)
      code.fill(1, originalOffset(lineStarts[token.map[0]] ?? input.length), originalOffset(lineStarts[token.map[1]] ?? input.length));
    if (token.type === 'code_inline') protectInlineCode(token, frame.positions);
    if (token.type === 'image' && token.children) {
      // Alt text has its own inline parser state, but its code spans still
      // carry author bytes. Walk those child states without rendering twice.
      const start = (inlineStarts.get(token) ?? 0) + 2;
      const pending = [{ tokens: token.children, positions: frame.positions.slice(start, start + token.content.length) }];
      while (pending.length) {
        const current = pending.pop();
        if (!current) continue;
        for (const child of current.tokens) {
          if (child.type === 'code_inline') protectInlineCode(child, current.positions);
          if (child.type === 'image' && child.children) {
            const start = (inlineStarts.get(child) ?? 0) + 2;
            pending.push({ tokens: child.children, positions: current.positions.slice(start, start + child.content.length) });
          }
        }
      }
    }
    const rule = markdown.renderer.rules[token.type];
    const attributes = token.attrs;
    // Abbreviate only the throwaway render's generated URLs/titles to bound
    // reference fanout. Authored destinations are never edited (#664).
    if (token.type === 'link_open' || token.type === 'image')
      token.attrs = attributes?.map(([name, value]) => [name, name === 'href' || name === 'src' ? '#' : name === 'title' ? '' : value]) ?? null;
    const value = rule
      ? rule(frame.tokens, frame.at - 1, markdown.options, env, markdown.renderer)
      : markdown.renderer.renderToken(frame.tokens, frame.at - 1, markdown.options);
    token.attrs = attributes;
    renderedBounds.push({ from: length, to: length + value.length, end: originalOffset(lineStarts[map[1]] ?? input.length) });
    if (token.type === 'html_block' || token.type === 'html_inline') {
      const positions =
        token.type === 'html_block'
          ? positionsFor(token.content, token.map ?? map)
          : frame.positions.slice(inlineStarts.get(token) ?? 0, (inlineStarts.get(token) ?? 0) + token.content.length);
      allow(token.content, positions);
      const span = { token, from: length, to: length + value.length, positions };
      spans.push(span);
    }
    chunks.push(value);
    length += value.length;
  }
  const html = chunks.join('');
  const originalAt = new Int32Array(html.length).fill(-1);
  const endAt = new Int32Array(html.length);
  for (const bound of renderedBounds) endAt.fill(bound.end, bound.from, bound.to);
  for (const span of spans) for (let at = span.from; at < span.to; at++) originalAt[at] = span.positions[at - span.from] ?? -1;
  const ranges = new Int32Array(source.length + 1);
  const mark = (from: number, to: number) => {
    ranges[from] = (ranges[from] ?? 0) + 1;
    ranges[to] = (ranges[to] ?? 0) - 1;
  };
  let active = 0;
  const pending: DefaultTreeAdapterTypes.Node[] = [parseFragment(html, { sourceCodeLocationInfo: true })];
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    if ('tagName' in node && ACTIVE_TAGS.includes(node.tagName) && node.sourceCodeLocation) {
      active++;
      const loc = node.sourceCodeLocation;
      const from = originalAt[loc.startOffset] ?? -1;
      const end = loc.endTag?.endOffset ?? (node.tagName === 'embed' ? loc.startTag?.endOffset : loc.endOffset);
      let to = source.length;
      if (end && end < html.length && (originalAt[end] ?? -1) >= 0) to = originalAt[end] ?? source.length;
      else if (end && (originalAt[end - 1] ?? -1) >= 0) to = (originalAt[end - 1] ?? source.length) + 1;
      else if (end && end < html.length) to = endAt[end - 1] ?? source.length;
      if (from < 0) throw new Error('Missing active export element source');
      if (!loc.endTag && ['script', 'style', 'iframe'].includes(node.tagName)) to = source.length;
      mark(from, Math.max(from + 1, to));
    }
    if ('childNodes' in node) for (const child of node.childNodes) pending.push(child);
  }
  if (!active) return { output: source, active: 0 };
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
  const literal = inRange.slice();
  // An edited HTML block was literal Markdown in its entirety. Preserve that
  // interpretation after escaping an element, including text after its closer.
  // Allowed HTML stays raw; only Markdown delimiters/leaders gain escapes.
  for (const span of spans)
    if (span.token.type === 'html_block' && span.positions.some((at) => inRange[at])) for (const at of span.positions) if (!code[at]) literal[at] = 1;
  for (let at = 0; at < source.length; at++)
    if ((source[at] === '<' ? inRange[at] : literal[at]) && '<[]`~\\*_{'.includes(source[at] ?? '')) escaped[at] = 1;
  for (const at of leaders) if (literal[at]) escaped[at] = 1;
  const output: string[] = [];
  let cursor = 0;
  for (let at = 0; at < source.length; at++)
    if (escaped[at]) {
      output.push(source.slice(cursor, at), source[at] === '<' ? '&lt;' : `&#${source.charCodeAt(at)};`);
      cursor = at + 1;
    }
  output.push(source.slice(cursor));
  return { output: output.join(''), active, escaped, tokens };
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

/** B's only added formatting is at most one separator on either side
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
  if (compareExportStructure(model, output, markdown.parse(output, {})).equal) return output;
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
  if (compareExportStructure(model, output, markdown.parse(output, {})).equal) return output;
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
  if (!compareExportStructure(model, bounded, markdown.parse(bounded, {})).equal)
    throw new Error('Cannot preserve Markdown structure within the bounded HTML fallback');
  return bounded;
};

export const escapeDisallowedExportHtml = (source: string): string => {
  if (!mayHaveActiveExportHtml(source)) return source;
  const first = neutralize(source);
  if (!first.active || !first.tokens || !first.escaped) return source;
  const model = captureExportStructure(source, first.tokens);
  const output = settle(first.output);
  const comparison = compareExportStructure(model, output, markdown.parse(output, {}));
  if (comparison.equal) return output;
  return boundedLiteralization(model, first.tokens, first.escaped, comparison.regions);
};
