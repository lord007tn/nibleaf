import { closesMarkdownFence, type MarkdownFence, openingMarkdownFence } from './markdown-code';

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

/** Blockquote markers and one list-item marker that may come before a fence. */
const CONTAINER_PREFIX = /^ {0,3}(?:> ?)*(?: {0,3}(?:[-*+]|\d{1,9}[.)]) {1,4})?/;

const ACTIVE_OPEN = /^<(script|style|iframe|object|embed)\b/i;
const ACTIVE_TAG = /<(\/?)(script|style|iframe|object|embed)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const ESM_LINE = /^\s*(?:import|export)(?:\s|\{|\*)/;

/** The fence a line opens, read after any blockquote or list prefix and at any indentation:
 *  authors indent code inside components. */
const fenceOpening = (line: string): MarkdownFence | undefined => openingMarkdownFence(line.replace(CONTAINER_PREFIX, ''), Number.POSITIVE_INFINITY);
const fenceCloses = (line: string, fence: MarkdownFence): boolean =>
  closesMarkdownFence(line.replace(CONTAINER_PREFIX, ''), fence, Number.POSITIVE_INFINITY);

/** Where a component tag starting at `start` ends (after its `>`), or -1. Quoted values may hold
 *  `>` and span lines; a quote opens a value only right after `=`, so `title=don't` stays text;
 *  `{…}` values are balanced. */
const tagEnd = (source: string, start: number): number => {
  let index = start;
  let braces = 0;
  while (index < source.length) {
    const character = source[index] as string;
    if (braces > 0) {
      if (character === '{') braces += 1;
      else if (character === '}') braces -= 1;
      index += 1;
      continue;
    }
    if (character === '>') return index + 1;
    if (character === '{') braces += 1;
    else if ((character === '"' || character === "'") && /[=]\s*$/.test(source.slice(Math.max(start, index - 8), index))) {
      const close = source.indexOf(character, index + 1);
      if (close < 0) return -1;
      index = close;
    }
    index += 1;
  }
  return -1;
};

/** The end of an active block opened at `start`: after the close tag that balances it, or at
 *  `limit` (the next fence), so an unclosed `<style>` hides at most its own stretch of prose. */
const activeEnd = (source: string, start: number, limit: number): number => {
  ACTIVE_TAG.lastIndex = start;
  let depth = 0;
  for (let match = ACTIVE_TAG.exec(source); match && match.index < limit; match = ACTIVE_TAG.exec(source)) {
    const end = match.index + match[0].length;
    if (match[1]) {
      depth -= 1;
      if (depth <= 0) return Math.min(end, limit);
    } else if (!match[0].endsWith('/>')) depth += 1;
    else if (depth === 0) return end;
  }
  return limit;
};

/** The end of a balanced `{…}` expression at `start`, or -1 (an unbalanced brace is text). */
const expressionEnd = (source: string, start: number, limit: number): number => {
  let depth = 0;
  let quote = '';
  for (let index = start; index < limit; index += 1) {
    const character = source[index] as string;
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'" || character === '`') quote = character;
    else if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) return index + 1;
  }
  return -1;
};

const escapedAt = (source: string, index: number): boolean => {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && source[i] === '\\'; i -= 1) backslashes += 1;
  return backslashes % 2 === 1;
};

/** Tokenize one stretch of prose that holds no fence. `components` holds the lowercase names read
 *  as components; like HTML, tag names match whatever their case. */
const tokenizeProse = (source: string, components: ReadonlySet<string>, tokens: MdxToken[]): void => {
  let text = '';
  const flush = () => {
    if (text) tokens.push({ kind: 'text', value: text });
    text = '';
  };
  let index = 0;
  let lineStart = true;
  while (index < source.length) {
    const character = source[index] as string;
    if (lineStart) {
      const lineEnd = source.indexOf('\n', index);
      const line = source.slice(index, lineEnd < 0 ? source.length : lineEnd);
      if (ESM_LINE.test(line)) {
        flush();
        tokens.push({ kind: 'esm', value: line });
        index += line.length;
        continue;
      }
    }
    lineStart = character === '\n';
    if (character === '`' && !escapedAt(source, index)) {
      let run = 1;
      while (source[index + run] === '`') run += 1;
      const fence = '`'.repeat(run);
      // An inline code span stays within its paragraph: it never crosses a blank line.
      const paragraphEnd = (() => {
        const blank = /\n[ \t]*\n/g;
        blank.lastIndex = index;
        return blank.exec(source)?.index ?? source.length;
      })();
      let close = source.indexOf(fence, index + run);
      while (close >= 0 && close < paragraphEnd && source[close + run] === '`') {
        let after = close;
        while (source[after] === '`') after += 1;
        close = source.indexOf(fence, after);
      }
      if (close >= 0 && close < paragraphEnd) {
        flush();
        tokens.push({ kind: 'code', value: source.slice(index, close + run), block: false });
        index = close + run;
        continue;
      }
      text += fence;
      index += run;
      continue;
    }
    if (character === '<' && !escapedAt(source, index)) {
      if (ACTIVE_OPEN.test(source.slice(index, index + 8))) {
        const end = activeEnd(source, index, source.length);
        flush();
        tokens.push({ kind: 'active', value: source.slice(index, end) });
        index = end;
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
          flush();
          if (tag[1]) tokens.push({ kind: 'close', name, raw });
          else {
            const selfClosing = /\/\s*>$/.test(raw);
            tokens.push({ kind: 'open', name, raw, selfClosing, attributes: raw.slice(tag[0].length, selfClosing ? raw.lastIndexOf('/') : -1) });
          }
          index = end;
          continue;
        }
      }
    }
    if (character === '{' && !escapedAt(source, index)) {
      const end = expressionEnd(source, index, source.length);
      if (end > 0) {
        flush();
        tokens.push({ kind: 'expression', value: source.slice(index, end) });
        index = end;
        continue;
      }
    }
    text += character;
    index += 1;
  }
  flush();
};

/** Read authored MDX into tokens. Fences (backtick or tilde, any length, inside containers too)
 *  are found first, line by line; an unclosed fence runs to the end, as in CommonMark. */
export const tokenizeMdx = (source: string, components: ReadonlySet<string>): MdxToken[] => {
  const tokens: MdxToken[] = [];
  const lines = source.split('\n');
  let prose: string[] = [];
  const flushProse = (beforeFence: boolean) => {
    if (prose.length > 0) tokenizeProse(`${prose.join('\n')}${beforeFence ? '\n' : ''}`, components, tokens);
    prose = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    const fence = fenceOpening(line);
    if (!fence) {
      prose.push(line);
      continue;
    }
    flushProse(true);
    let end = index + 1;
    while (end < lines.length && !fenceCloses(lines[end] as string, fence)) end += 1;
    const last = Math.min(end, lines.length - 1);
    tokens.push({ kind: 'code', value: lines.slice(index, last + 1).join('\n'), block: true });
    index = last;
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
