import { closesMarkdownFence, type MarkdownFence, openingMarkdownFence, protectMarkdownCode } from '@nibleaf/shared/markdown-code';
import { randomUUID } from '@nibleaf/shared/uuid';
import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({ html: true });
const markdownWithoutHtml = new MarkdownIt({ html: false });
type ImportContainer = { kind: 'quote' | 'list'; indent: number };
const LIST_MARKER = /(?:[-*+]|\d{1,9}[.)])(?= )/y;

/** Expand tabs only for parsing. In particular, `>\t` consumes one column of
 * the tab as optional quote spacing; its remaining columns are indentation. */
const expandedColumns = (line: string): string => {
  let column = 0;
  let output = '';
  for (const char of line) {
    const width = char === '\t' ? 4 - (column % 4) : 1;
    output += char === '\t' ? ' '.repeat(width) : char;
    column += width;
  }
  return output;
};

const importFenceLine = (line: string): { content: string; containers: ImportContainer[] } => {
  const containers: ImportContainer[] = [];
  let cursor = 0;
  for (;;) {
    const start = cursor;
    while (line[cursor] === ' ') cursor++;
    if (line[cursor] === '>') {
      containers.push({ kind: 'quote', indent: cursor - start });
      cursor++;
      if (line[cursor] === ' ') cursor++;
      continue;
    }
    LIST_MARKER.lastIndex = cursor;
    const marker = LIST_MARKER.exec(line);
    if (!marker) return { content: line.slice(start), containers };
    cursor += marker[0].length;
    const spacing = cursor;
    while (line[cursor] === ' ') cursor++;
    // CommonMark: more than four columns after a list marker uses one as
    // padding, leaving the remainder as indentation in the item's content.
    if (cursor - spacing > 4) cursor = spacing + 1;
    containers.push({ kind: 'list', indent: cursor - start });
  }
};

const importFenceBody = (line: string, containers: readonly ImportContainer[]): string | undefined => {
  let cursor = 0;
  for (const container of containers) {
    const start = cursor;
    if (container.kind === 'list') {
      while (cursor - start < container.indent && line[cursor] === ' ') cursor++;
      // A blank after the matched quote markers continues a list fence even
      // when the line omits the list's indentation.
      if (cursor - start !== container.indent) return line.slice(cursor).trim() ? undefined : '';
    } else {
      while (line[cursor] === ' ') cursor++;
      if (cursor - start > container.indent + 3 || line[cursor] !== '>') return undefined;
      cursor++;
      if (line[cursor] === ' ') cursor++;
    }
  }
  return line.slice(cursor);
};

/** Read each component opener once, including multiline attributes. The cap
 * also bounds malformed quotes/braces; continuation lines are not rescanned. */
export const readImportComponentTag = (source: string, start: number): { end: number; complete: boolean; selfClosing: boolean } => {
  const limit = Math.min(source.length, start + 4096);
  let quote = '';
  let braces = 0;
  for (let index = start + 1; index < limit; index++) {
    const char = source[index];
    if (quote) {
      if (char === '\\') index++;
      else if (char === quote) quote = '';
    } else if (char === '"' || char === "'" || (char === '`' && braces > 0)) quote = char;
    else if (char === '{') braces++;
    else if (char === '}') braces = Math.max(0, braces - 1);
    else if (braces === 0 && char === '>') return { end: index + 1, complete: true, selfClosing: source[index - 1] === '/' };
    else if (braces === 0 && char === '<') return { end: index, complete: false, selfClosing: false };
  }
  return { end: limit, complete: false, selfClosing: false };
};

/** The same block maps markdown-it gives the editor, including nested containers.
 * Only block parsing is needed: do not parse every prose link just to find code. */
export const importCodeLines = (source: string): boolean[] => {
  const normalized = source.replace(/\r\n?/g, '\n').replaceAll('\u0000', '\uFFFD');
  const tokens: ReturnType<MarkdownIt['parse']> = [];
  markdown.block.parse(normalized, markdown, {}, tokens);
  const ordinary: ReturnType<MarkdownIt['parse']> = [];
  markdownWithoutHtml.block.parse(normalized, markdownWithoutHtml, {}, ordinary);
  const ordinaryFences = new Set<number>();
  const ordinaryFenceEnds = new Map<number, number>();
  const ordinaryFenceAtLine = new Map<number, number>();
  const indented: boolean[] = [];
  for (const token of ordinary) {
    if (token.type === 'fence' && token.map) {
      ordinaryFences.add(token.map[0]);
      ordinaryFenceEnds.set(token.map[0], token.map[1]);
      for (let line = token.map[0]; line < token.map[1]; line++) ordinaryFenceAtLine.set(line, token.map[0]);
    }
    if (token.type === 'code_block' && token.map) {
      for (let line = token.map[0]; line < token.map[1]; line++) indented[line] = true;
    }
  }
  let componentDepth = 0;
  let componentTagEnd = 0;
  let offset = 0;
  const sourceLines = normalized.split('\n');
  const lineOffsets = sourceLines.map((line) => {
    const start = offset;
    offset += line.length + 1;
    return start;
  });
  const eligibleOpeners = new Set<number>();
  const componentOpeners = new Set<number>();
  let fence: MarkdownFence | undefined;
  let fenceEnd: number | undefined;
  let containers: ImportContainer[] = [];
  let maxIndent = 3;
  const lines = sourceLines.map((line, index) => {
    // Keep importer-only component indentation and false-closer handling out
    // of the published reader. Markdown-it supplies ordinary container ends,
    // including optional quote spacing and tab-based list indentation.
    if (fenceEnd !== undefined && index >= fenceEnd) fence = undefined;
    if (fence) {
      const content = importFenceBody(expandedColumns(line), containers);
      if (fenceEnd === undefined && content === undefined && line.trim()) fence = undefined;
      else {
        if (index + 1 === fenceEnd || (content !== undefined && closesMarkdownFence(content, fence, maxIndent))) fence = undefined;
        return true;
      }
    }
    // Example tags inside code must never change the real component's depth.
    const ordinaryStart = ordinaryFenceAtLine.get(index);
    if (
      !componentDepth &&
      ordinaryStart !== undefined &&
      index !== ordinaryStart &&
      eligibleOpeners.has(ordinaryStart) &&
      !componentOpeners.has(ordinaryStart)
    )
      return false;
    if (!componentDepth && indented[index]) return false;
    const lineOffset = lineOffsets[index] ?? 0;
    if (lineOffset < componentTagEnd) return false;
    const tag = /^[\t >]*(?:[-*+] |\d{1,9}[.)] )?<(\/?)([A-Z][\w.]*)\b/.exec(line);
    if (tag) {
      const opener = readImportComponentTag(normalized, lineOffset + line.indexOf('<'));
      componentTagEnd = opener.end;
      if (opener.complete) {
        if (tag[1]) componentDepth = Math.max(0, componentDepth - 1);
        else if (!opener.selfClosing && !line.includes(`</${tag[2]}>`)) componentDepth++;
      }
    }
    if (componentDepth > 0) componentOpeners.add(index);
    const allowed = componentDepth > 0 || ordinaryFences.has(index) || Boolean(openingMarkdownFence(line, 3));
    if (allowed) eligibleOpeners.add(index);
    if (!allowed) return false;
    const parsed = importFenceLine(expandedColumns(line));
    const content = parsed.content;
    fence = openingMarkdownFence(content, Number.POSITIVE_INFINITY);
    if (fence) {
      fenceEnd = ordinaryFenceEnds.get(index);
      containers = parsed.containers;
      const indent = content.length - content.trimStart().length;
      maxIndent = indent + 3;
    }
    return Boolean(fence);
  });
  for (const token of tokens) {
    if ((token.type === 'fence' || token.type === 'code_block') && token.map) {
      // A closing MDX fence can look like a new, unclosed Markdown fence after
      // an HTML block swallowed its opener. Do not extend that false range.
      if (lines[token.map[0]] && (!eligibleOpeners.has(token.map[0]) || componentOpeners.has(token.map[0]))) continue;
      for (let line = token.map[0]; line < token.map[1]; line++) lines[line] = true;
    }
  }
  return lines;
};

/** Hide whole code blocks before importer passes; restore their exact source bytes. */
export const protectImportCode = (source: string) => {
  const code = importCodeLines(source);
  const lines = source.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];
  let prefix = `\uE000${randomUUID()}:`;
  while (source.includes(prefix)) prefix = `\uE000${randomUUID()}:`;
  const blocks = new Map<string, string>();
  const output: string[] = [];
  for (let line = 0; line < lines.length; line++) {
    if (!code[line]) {
      output.push(lines[line] ?? '');
      continue;
    }
    const start = line;
    while (code[line + 1]) line++;
    const literal = lines.slice(start, line + 1).join('');
    const key = `${prefix}${blocks.size}\uE001`;
    blocks.set(key, literal);
    output.push(key, /[\r\n]$/.test(literal) ? '\n' : '');
  }
  const inline = protectMarkdownCode(output.join(''), { fences: false });
  const placeholder = new RegExp(`${prefix}(\\d+)\uE001\\n?`, 'g');
  return {
    content: inline.content,
    // Normalization may remove a component's structural indentation from a
    // hidden block. Inline-code parsing must never see its fence markers.
    blocks,
    restore: (value: string) => inline.restore(value).replace(placeholder, (match, index: string) => blocks.get(`${prefix}${index}\uE001`) ?? match),
  };
};
