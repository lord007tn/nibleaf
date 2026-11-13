import { closesMarkdownFence, type MarkdownFence, openingMarkdownFence, protectMarkdownCode } from '@nibleaf/shared/markdown-code';
import { randomUUID } from '@nibleaf/shared/uuid';
import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({ html: true });
const markdownWithoutHtml = new MarkdownIt({ html: false });
const CONTAINER_PREFIX = /^ {0,3}(?:> ?)*(?: {0,3}(?:[-*+]|\d{1,9}[.)]) {1,4})?/;

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
  let containerPrefix = '';
  let maxIndent = 3;
  const lines = sourceLines.map((line, index) => {
    // Keep importer-only component indentation and false-closer handling out
    // of the published reader. Markdown-it supplies ordinary container ends,
    // including optional quote spacing and tab-based list indentation.
    if (fence) {
      const content = containerPrefix.includes('>') ? line.trimStart() : line;
      if (
        index + 1 === fenceEnd ||
        (line.length - content.length <= maxIndent &&
          content.startsWith(containerPrefix) &&
          closesMarkdownFence(content.slice(containerPrefix.length), fence, maxIndent))
      )
        fence = undefined;
      return true;
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
    const prefix = CONTAINER_PREFIX.exec(line)?.[0] ?? '';
    const content = line.slice(prefix.length);
    fence = openingMarkdownFence(content, Number.POSITIVE_INFINITY);
    if (fence) {
      fenceEnd = ordinaryFenceEnds.get(index);
      const list = /(?:[-*+]|\d{1,9}[.)]) {1,4}$/.exec(prefix);
      containerPrefix = list ? prefix.slice(0, list.index) + ' '.repeat(list[0].length) : prefix.includes('>') ? prefix : '';
      if (containerPrefix.includes('>')) containerPrefix = containerPrefix.trimStart();
      const indent = content.length - content.trimStart().length + (containerPrefix ? 0 : prefix.length);
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
  const literals: string[] = [];
  const output: string[] = [];
  for (let line = 0; line < lines.length; line++) {
    if (!code[line]) {
      output.push(lines[line] ?? '');
      continue;
    }
    const start = line;
    while (code[line + 1]) line++;
    const literal = lines.slice(start, line + 1).join('');
    output.push(`${prefix}${literals.push(literal) - 1}\uE001`, /[\r\n]$/.test(literal) ? '\n' : '');
  }
  const inline = protectMarkdownCode(output.join(''), { fences: false });
  const placeholder = new RegExp(`${prefix}(\\d+)\uE001\\n?`, 'g');
  return {
    content: inline.content,
    restore: (value: string) => inline.restore(value).replace(placeholder, (match, index: string) => literals[Number(index)] ?? match),
  };
};
