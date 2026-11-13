import { protectMarkdownCode } from '@nibleaf/shared/markdown-code';
import { randomUUID } from '@nibleaf/shared/uuid';
import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({ html: true });

/** The same block maps markdown-it gives the editor, including nested containers.
 * Only block parsing is needed: do not parse every prose link just to find code. */
export const importCodeLines = (source: string): boolean[] => {
  const tokens: ReturnType<MarkdownIt['parse']> = [];
  markdown.block.parse(source.replace(/\r\n?/g, '\n').replaceAll('\u0000', '\uFFFD'), markdown, {}, tokens);
  const lines: boolean[] = [];
  for (const token of tokens) {
    if ((token.type === 'fence' || token.type === 'code_block') && token.map) {
      for (let line = token.map[0]; line < token.map[1]; line++) lines[line] = true;
    }
  }
  return lines;
};

/** Hide whole code blocks before importer passes; restore their exact source bytes. */
export const protectImportCode = (source: string) => {
  const code = importCodeLines(source);
  const lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
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
    output.push(`${prefix}${literals.push(literal) - 1}\uE001`, literal.endsWith('\n') ? '\n' : '');
  }
  const inline = protectMarkdownCode(output.join(''), { fences: false });
  const placeholder = new RegExp(`${prefix}(\\d+)\uE001\\n?`, 'g');
  return {
    content: inline.content,
    restore: (value: string) => inline.restore(value).replace(placeholder, (match, index: string) => literals[Number(index)] ?? match),
  };
};
