import { fencedMarkdownLines, openingMarkdownFence, protectMarkdownCode } from '@nibleaf/shared/markdown-code';
import { randomUUID } from '@nibleaf/shared/uuid';
import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({ html: true });
const markdownWithoutHtml = new MarkdownIt({ html: false });

/** The same block maps markdown-it gives the editor, including nested containers.
 * Only block parsing is needed: do not parse every prose link just to find code. */
export const importCodeLines = (source: string): boolean[] => {
  const normalized = source.replace(/\r\n?/g, '\n').replaceAll('\u0000', '\uFFFD');
  const tokens: ReturnType<MarkdownIt['parse']> = [];
  markdown.block.parse(normalized, markdown, {}, tokens);
  const ordinary: ReturnType<MarkdownIt['parse']> = [];
  markdownWithoutHtml.block.parse(normalized, markdownWithoutHtml, {}, ordinary);
  const ordinaryFences = new Set<number>();
  const ordinaryFenceAtLine = new Map<number, number>();
  const indented: boolean[] = [];
  for (const token of ordinary) {
    if (token.type === 'fence' && token.map) {
      ordinaryFences.add(token.map[0]);
      for (let line = token.map[0]; line < token.map[1]; line++) ordinaryFenceAtLine.set(line, token.map[0]);
    }
    if (token.type === 'code_block' && token.map) {
      for (let line = token.map[0]; line < token.map[1]; line++) indented[line] = true;
    }
  }
  let componentDepth = 0;
  const eligibleOpeners = new Set<number>();
  const componentOpeners = new Set<number>();
  // The shared scanner skips this callback inside an open fence, so example
  // component tags cannot change the surrounding real component's depth.
  const lines = fencedMarkdownLines(normalized.split('\n'), (line, index) => {
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
    const tag = /^[\t >]*(?:[-*+] |\d{1,9}[.)] )?<(\/?)([A-Z][\w.]*)\b/.exec(line);
    if (tag?.[1]) componentDepth = Math.max(0, componentDepth - 1);
    else if (tag && !line.trimEnd().endsWith('/>') && !line.includes(`</${tag[2]}>`)) componentDepth++;
    if (componentDepth > 0) componentOpeners.add(index);
    const allowed = componentDepth > 0 || ordinaryFences.has(index) || Boolean(openingMarkdownFence(line, 3));
    if (allowed) eligibleOpeners.add(index);
    return allowed;
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
