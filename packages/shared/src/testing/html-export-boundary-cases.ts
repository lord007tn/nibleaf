import MarkdownIt from 'markdown-it';
import { type DefaultTreeAdapterTypes, parseFragment } from 'parse5';

/** Exact 2,640-shape matrix from the independent 6d919df8 review. */
export const htmlExportBoundaryCases = () => {
  const wrappers = [
    ['style', '<style>', '</style>'],
    ['script', '<script>', '</script>'],
    ['pre', '<pre>', '</pre>'],
    ['textarea', '<textarea>', '</textarea>'],
    ['comment', '<!--', '-->'],
    ['pi', '<?review', '?>'],
    ['decl', '<!DOCTYPE', '>'],
    ['cdata', '<![CDATA[', ']]>'],
    ['div', '<div>', '</div>'],
    ['span', '<span>', '</span>'],
    ['custom', '<custom-tag>', '</custom-tag>'],
  ] as const;
  const containers: ReadonlyArray<(lines: string[]) => string[]> = [
    (lines) => lines,
    (lines) => lines.map((line) => `> ${line}`),
    (lines) => lines.map((line, at) => `${at ? '  ' : '- '}${line}`),
    (lines) => lines.map((line, at) => `${at ? '  > ' : '- > '}${line}`),
    (lines) => ['<CodeGroup>', ...lines.map((line) => `    ${line}`), '</CodeGroup>'],
    (lines) => ['<Note>', ...lines, '</Note>'],
  ];
  const cases: Array<{ index: number; source: string; markers: string[] }> = [];
  for (const [, open, close] of wrappers)
    for (const closed of [false, true])
      for (const wrap of containers)
        for (const fence of ['~~~', '```md'])
          for (const fenceClosed of [false, true])
            for (let gap = 0; gap < 5; gap++) {
              const index = cases.length;
              const markers = ['EXPR', 'NOTE', 'TEXT', 'INLINE', 'IMPORT', 'EXPORT', 'MEDIA', 'FOLLOW'].map((name) => `R${index}_${name}_Z`);
              const body = [
                `{${markers[0]}}`,
                `<Note>${markers[1]}</Note>`,
                markers[2] as string,
                `\`{${markers[3]}}\``,
                `import ${markers[4]} from "pkg"`,
                `export const ${markers[5]} = 1;`,
                `![${markers[6]}](/image.png)`,
              ];
              if (gap === 1) body.splice(1, 0, '');
              if (gap === 2) body.splice(3, 0, '');
              if (gap === 3) body.unshift('');
              if (gap === 4) body.push(close, '');
              const source = [
                ...wrap([open, fence, ...body, ...(fenceClosed ? [(fence[0] as string).repeat(3)] : []), ...(closed ? [close] : [])]),
                '',
                markers[7],
              ].join('\n');
              cases.push({ index, source, markers });
            }
  return cases;
};

const markdown = new MarkdownIt({ html: true });
const activeTags = new Set(['script', 'style', 'iframe', 'object', 'embed']);

/** Count active elements only in Markdown HTML tokens, never inside code or
 * escaped text. parse5 reads tags; there is no regex HTML filter. Portable
 * Markdown is also escaped by the worker renderer, checked separately. */
export const activeExportHtml = (source: string): number => {
  const elements = (node: DefaultTreeAdapterTypes.Node): number =>
    ('tagName' in node && activeTags.has(node.tagName) ? 1 : 0) +
    ('childNodes' in node ? node.childNodes.reduce((sum, child) => sum + elements(child), 0) : 0);
  const visit = (tokens: ReturnType<typeof markdown.parse>): number =>
    tokens.reduce(
      (sum, token) =>
        sum +
        (token.type === 'html_block' || token.type === 'html_inline' ? elements(parseFragment(token.content)) : 0) +
        (token.children ? visit(token.children) : 0),
      0,
    );
  return visit(markdown.parse(source, {}));
};
