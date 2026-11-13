import { markdownLineKinds } from './markdown-code';

/**
 * One tokenizer for authored MDX, shared by every public projection (#341).
 *
 * Source is read once into tokens: fenced code and inline code (opaque from
 * then on, with no placeholders to leak), component tags with quote-aware
 * attributes, the few inline formatting tags kept as markup, active HTML
 * blocks, MDX expressions and ESM lines, and plain text. A small stack then
 * matches component and formatting tags into a tree; anything unmatched
 * reads as the text it was written as.
 */

export type MdxToken =
  /** Fenced or inline code, kept byte for byte. */
  | { kind: 'code'; value: string; block: boolean }
  | { kind: 'text'; value: string }
  /** A formatting tag (`<sub>`, `</u>`) with no correctly nested partner: shown as text. */
  | { kind: 'stray'; value: string }
  /** `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>` with what they enclose. */
  | { kind: 'active'; value: string }
  /** A balanced `{…}` expression. */
  | { kind: 'expression'; value: string }
  /** A top-level `import`/`export` line. */
  | { kind: 'esm'; value: string }
  | { kind: 'open'; name: string; attributes: string; raw: string; selfClosing: boolean }
  | { kind: 'close'; name: string; raw: string };

export type MdxNode =
  | Exclude<MdxToken, { kind: 'open' } | { kind: 'close' }>
  | { kind: 'element'; name: string; attributes: string; raw: string; closeRaw: string; children: MdxNode[] };

/** Inline formatting the projections keep as markup when its pairs nest correctly. */
const FORMATTING_TAGS: ReadonlySet<string> = new Set(['sub', 'sup', 'u']);

const ACTIVE_OPEN = /^<(script|style|iframe|object|embed)\b/i;
/** Where an `ACTIVE_TAG` match (`/<(\/?)(script|style|iframe|object|embed)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi`)
 *  can start; `nextActiveTag` reads the rest. */
const ACTIVE_TAG_OPEN = /<(\/?)(script|style|iframe|object|embed)\b/gi;
const ESM_LINE = /^\s*(?:import|export)(?:\s|\{|\*)/;
/** A component tag or expression longer than this reads as text. */
const MAX_TAG_LENGTH = 8192;
const MAX_EXPRESSION_LENGTH = 16_384;
/** Tags nested deeper than this read as text, so rendering never runs out of stack. */
const MAX_DEPTH = 32;
/** Characters the tag and expression scans may read per document, in proportion to its length:
 *  text full of unclosed tags or braces stays linear, and once spent, what is left reads as text. */
let scanBudget = 0;
const scanLimit = (source: string, start: number, length: number): number => Math.min(source.length, start + length, start + Math.max(0, scanBudget));

/** Where a component tag starting at `start` ends (after its `>`), or -1. Quoted values may hold
 *  `>` and span lines; a quote opens a value only right after `=`, so `title=don't` stays text;
 *  `{…}` values are balanced. */
const tagEnd = (source: string, start: number): number => {
  let index = start;
  let braces = 0;
  // Scans are bounded, so authored text full of unclosed tags stays linear.
  const limit = scanLimit(source, start, MAX_TAG_LENGTH);
  const spend = (end: number) => {
    scanBudget -= end - start;
  };
  while (index < limit) {
    const character = source[index] as string;
    if (braces > 0) {
      if (character === '{') braces += 1;
      else if (character === '}') braces -= 1;
      index += 1;
      continue;
    }
    if (character === '>') {
      spend(index);
      return index + 1;
    }
    if (character === '{') braces += 1;
    else if ((character === '"' || character === "'") && /[=]\s*$/.test(source.slice(Math.max(start, index - 8), index))) {
      const close = source.indexOf(character, index + 1);
      if (close < 0 || close >= limit) {
        spend(limit);
        return -1;
      }
      index = close;
    }
    index += 1;
  }
  spend(limit);
  return -1;
};

/** The last `"` and `'` in the source being read, found once per document. */
/** The last `"` and `'` in the prose being scanned, found once per scan. Reset
 *  where a scan starts (`tokenizeProse`, `activeBlockEnd`) rather than keyed by
 *  the text: comparing two equal texts reads them whole, on every lookup. */
let quoteBounds: { double: number; single: number } | null = null;
const lastQuote = (source: string, quote: string): number => {
  quoteBounds ??= { double: source.lastIndexOf('"'), single: source.lastIndexOf("'") };
  return quote === '"' ? quoteBounds.double : quoteBounds.single;
};

/**
 * The next match of `ACTIVE_TAG` at or after `from`, as `ACTIVE_TAG.exec` would
 * find it, or null. Read by hand and charged to the scan budget, so the time
 * stays linear in the text's length. `'spent'` once the budget is used up.
 */
const nextActiveTag = (source: string, from: number): { index: number; end: number; closing: boolean } | null | 'spent' => {
  for (let at = from; ; ) {
    ACTIVE_TAG_OPEN.lastIndex = at;
    const open = ACTIVE_TAG_OPEN.exec(source);
    if (!open) return null;
    // `(?:[^>"']|"[^"]*"|'[^']*')*>`: a quote must close before the `>` counts.
    let index = open.index + open[0].length;
    let end = -1;
    while (index < source.length) {
      const character = source[index] as string;
      if (character === '>') {
        end = index + 1;
        break;
      }
      if (character === '"' || character === "'") {
        const close = lastQuote(source, character) > index ? source.indexOf(character, index + 1) : -1;
        if (close < 0) break;
        index = close;
      }
      index += 1;
    }
    scanBudget -= index - open.index;
    if (end >= 0) return { index: open.index, end, closing: open[1] === '/' };
    if (scanBudget < 0) return 'spent';
    at = open.index + 1;
  }
};

/** The end of an active block opened at `start`: after the close tag that balances it, or at
 *  `limit` (the next fence), so an unclosed `<style>` hides at most its own stretch of prose.
 *  Once the scan budget is spent, the block runs to `limit`: what can't be read stays hidden. */
const activeEnd = (source: string, start: number, limit: number): number => {
  let depth = 0;
  for (let from = start; ; ) {
    const match = nextActiveTag(source, from);
    if (match === 'spent' || !match || match.index >= limit) return limit;
    if (match.closing) {
      depth -= 1;
      if (depth <= 0) return Math.min(match.end, limit);
    } else if (source[match.end - 2] !== '/') depth += 1;
    else if (depth === 0) return match.end;
    from = match.end;
  }
};

/** `activeEnd` for a document read on its own (its own scan budget), to the end
 *  of the text: what the tokenizer finds for an active block opened at `start`. */
export const activeBlockEnd = (source: string, start: number): number => {
  scanBudget = 64 * source.length + 65_536;
  quoteBounds = null;
  return activeEnd(source, start, source.length);
};

/** The end of a balanced `{…}` expression at `start`, or -1: an unbalanced brace is text. */
const expressionEnd = (source: string, start: number): number => {
  let depth = 0;
  const limit = scanLimit(source, start, MAX_EXPRESSION_LENGTH);
  for (let index = start; index < limit; index += 1) {
    const character = source[index] as string;
    if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) {
      scanBudget -= index - start;
      return index + 1;
    }
  }
  scanBudget -= limit - start;
  return -1;
};

/** For each backtick run, the index of the next run of the same length (or -1), found in one
 *  backward pass so a page of unmatched backticks stays linear. */
const backtickRuns = (source: string): Map<number, { length: number; next: number }> => {
  const runs: { index: number; length: number }[] = [];
  for (const match of source.matchAll(/`+/g)) runs.push({ index: match.index, length: match[0].length });
  const nextByLength = new Map<number, number>();
  const result = new Map<number, { length: number; next: number }>();
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const run = runs[i] as { index: number; length: number };
    result.set(run.index, { length: run.length, next: nextByLength.get(run.length) ?? -1 });
    nextByLength.set(run.length, run.index);
  }
  return result;
};

/** Where the paragraph holding `index` ends: the start of the next blank line, or the end. */
const paragraphEnds = (source: string): number[] => [...source.matchAll(/\n[ \t]*(?=\n)/g)].map((match) => match.index);
const firstAfter = (sorted: readonly number[], index: number, fallback: number): number => {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((sorted[middle] as number) < index) low = middle + 1;
    else high = middle;
  }
  return sorted[low] ?? fallback;
};

const escapedAt = (source: string, index: number): boolean => {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && source[i] === '\\'; i -= 1) backslashes += 1;
  return backslashes % 2 === 1;
};

/** Tokenize one stretch of prose that holds no fence. `components` holds the lowercase names read
 *  as components; like HTML, tag names match whatever their case. */
const tokenizeProse = (source: string, components: ReadonlySet<string>, tokens: MdxToken[]): void => {
  quoteBounds = null;
  // Text between tokens is always one contiguous stretch of the source, so it is
  // taken as a single slice when a token (or the end) closes it. Building it one
  // character at a time is quadratic in V8 on long prose (hundreds of KB).
  let textStart = 0;
  const flush = (end: number) => {
    if (end > textStart) tokens.push({ kind: 'text', value: source.slice(textStart, end) });
  };
  const runs = backtickRuns(source);
  const blankLines = paragraphEnds(source);
  let index = 0;
  let lineStart = true;
  while (index < source.length) {
    const character = source[index] as string;
    if (lineStart) {
      const lineEnd = source.indexOf('\n', index);
      const line = source.slice(index, lineEnd < 0 ? source.length : lineEnd);
      if (ESM_LINE.test(line)) {
        flush(index);
        tokens.push({ kind: 'esm', value: line });
        index += line.length;
        textStart = index;
        continue;
      }
    }
    lineStart = character === '\n';
    if (character === '`' && !escapedAt(source, index)) {
      const { length: run, next: close } = runs.get(index) ?? { length: 1, next: -1 };
      // An inline code span stays within its paragraph: it never crosses a blank line.
      if (close >= 0 && close < firstAfter(blankLines, index, source.length)) {
        flush(index);
        tokens.push({ kind: 'code', value: source.slice(index, close + run), block: false });
        index = close + run;
        textStart = index;
        continue;
      }
      // An unmatched run stays text.
      index += run;
      continue;
    }
    if (character === '<' && !escapedAt(source, index)) {
      if (ACTIVE_OPEN.test(source.slice(index, index + 8))) {
        const end = activeEnd(source, index, source.length);
        flush(index);
        tokens.push({ kind: 'active', value: source.slice(index, end) });
        index = end;
        textStart = index;
        continue;
      }
      const tag = /^<(\/?)([A-Za-z][\w.-]*)/.exec(source.slice(index, index + 64));
      const name = (tag?.[2] ?? '').toLowerCase();
      const opening = tag?.[0] ?? '';
      const isFormatting = FORMATTING_TAGS.has(name) && source.slice(index, index + opening.length + 1) === `${opening}>`;
      if (tag && (components.has(name) || isFormatting)) {
        const end = isFormatting ? index + tag[0].length + 1 : tagEnd(source, index + tag[0].length);
        if (end > 0) {
          const raw = source.slice(index, end);
          flush(index);
          if (tag[1]) tokens.push({ kind: 'close', name, raw });
          else {
            const selfClosing = /\/\s*>$/.test(raw);
            tokens.push({ kind: 'open', name, raw, selfClosing, attributes: raw.slice(tag[0].length, selfClosing ? raw.lastIndexOf('/') : -1) });
          }
          index = end;
          textStart = index;
          continue;
        }
      }
    }
    if (character === '{' && !escapedAt(source, index)) {
      const end = expressionEnd(source, index);
      if (end > 0) {
        flush(index);
        tokens.push({ kind: 'expression', value: source.slice(index, end) });
        index = end;
        textStart = index;
        continue;
      }
    }
    index += 1;
  }
  flush(source.length);
};

/** Read authored MDX into tokens using the reader's fence boundaries. An unclosed
 * fence runs to the end unless its container ends. HTML lines follow the existing
 * prose tokenizer: their inline code, components and active HTML keep their rules. */
export const tokenizeMdx = (source: string, components: ReadonlySet<string>): MdxToken[] => {
  scanBudget = 64 * source.length + 65_536;
  const tokens: MdxToken[] = [];
  const lines = source.split('\n');
  const kinds = markdownLineKinds(lines);
  let prose: string[] = [];
  const flushProse = (beforeFence: boolean) => {
    if (prose.length > 0) tokenizeProse(`${prose.join('\n')}${beforeFence ? '\n' : ''}`, components, tokens);
    prose = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (kinds[index] !== 'code') {
      prose.push(line);
      continue;
    }
    flushProse(true);
    let end = index + 1;
    while (end < lines.length && kinds[end] === 'code') end += 1;
    tokens.push({ kind: 'code', value: lines.slice(index, end).join('\n'), block: true });
    index = end - 1;
    // The line break after the fence belongs to the prose that follows.
    if (index < lines.length - 1) prose.push('');
  }
  if (prose.length > 0) tokenizeProse(prose.join('\n'), components, tokens);
  return tokens;
};

/** Match tags into a tree with one stack. A close tag closes the nearest open tag of its name;
 *  formatting tags only close the innermost open formatting tag, so crossed pairs stay text.
 *  Unmatched closers and unclosed openers fall back to their raw text. */
export const buildMdxTree = (tokens: readonly MdxToken[]): MdxNode[] => {
  type Frame = { open: Extract<MdxToken, { kind: 'open' }>; children: MdxNode[] };
  const root: MdxNode[] = [];
  const stack: Frame[] = [];
  const target = () => stack.at(-1)?.children ?? root;
  const asText = (name: string, raw: string): MdxNode => ({ kind: FORMATTING_TAGS.has(name) ? 'stray' : 'text', value: raw });
  const unwind = (frame: Frame) => {
    target().push(asText(frame.open.name, frame.open.raw), ...frame.children);
  };
  for (const token of tokens) {
    if (token.kind === 'open') {
      if (token.selfClosing)
        target().push({ kind: 'element', name: token.name, attributes: token.attributes, raw: token.raw, closeRaw: '', children: [] });
      else if (stack.length >= MAX_DEPTH) target().push(asText(token.name, token.raw));
      else stack.push({ open: token, children: [] });
      continue;
    }
    if (token.kind !== 'close') {
      target().push(token);
      continue;
    }
    let depth = -1;
    if (FORMATTING_TAGS.has(token.name)) {
      // Formatting only closes the innermost open tag: crossed pairs stay text.
      if (stack.at(-1)?.open.name === token.name) depth = stack.length - 1;
    } else {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i]?.open.name === token.name) {
          depth = i;
          break;
        }
      }
    }
    if (depth < 0) {
      target().push(asText(token.name, token.raw));
      continue;
    }
    while (stack.length - 1 > depth) unwind(stack.pop() as Frame);
    const frame = stack.pop() as Frame;
    target().push({
      kind: 'element',
      name: frame.open.name,
      attributes: frame.open.attributes,
      raw: frame.open.raw,
      closeRaw: token.raw,
      children: frame.children,
    });
  }
  while (stack.length > 0) unwind(stack.pop() as Frame);
  return root;
};
