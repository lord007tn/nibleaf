import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { tokenizeMdx } from './mdx-tokens';
import { normalizePublicMarkdownContent as md, portablePublicMdxMarkdown as portable } from './public-markdown-content';
import { HTML_EXPORT_COUNT, HTML_EXPORT_SEED, htmlExportCases } from './testing/html-export-cases';

it.each(['style', 'script'])('preserves the code and following prose after an unclosed %s, as main did', (tag) => {
  const source = `<${tag}>unclosed\n\n\`\`\`txt\nkept code\n\`\`\`\n\nKept prose.`;
  expect(md(source)).toBe('```txt\nkept code\n```\n\nKept prose.');
  expect(portable(source)).toBe(source);
  const tokens = tokenizeMdx(source, new Set(['note']));
  expect(tokens.some((token) => token.kind === 'active' && token.value.includes('unclosed'))).toBe(true);
  expect(md(`Before <${tag}>stolen\n<iframe>nested</iframe></${tag}> after.`)).toBe('Before  after.');
});

it.each([
  ['div', '<div>', '</div>'],
  ['span', '<span>', '</span>'],
  ['comment', '<!--', '-->'],
] as const)('keeps literal braces in a fenced example inside an HTML %s block', (_name, open, close) => {
  const source = `${open}\n~~~\n{VISIBLE}\n~~~\n${close}`;
  expect(md(source)).toBe(
    `${open.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}\n~~~\n{VISIBLE}\n~~~\n${close.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}`,
  );
  expect(portable(source)).toBe(source);
});

it.each(['<div>\n~~~\n<Note>Literal</Note>\n~~~\n</div>', '<div>\n<Note>Literal</Note>\n</div>'])(
  'keeps a Note inside HTML literal in both exports: %s',
  (source) => {
    expect(md(source)).toContain(source.includes('~~~') ? '~~~\n<Note>Literal</Note>\n~~~' : '&lt;Note&gt;Literal&lt;/Note&gt;');
    expect(portable(source)).toBe(source);
    expect(tokenizeMdx(source, new Set(['note'])).some((token) => token.kind === 'open' && token.name === 'note')).toBe(false);
  },
);

it('preserves every payload and following marker that exact main exported across seeded HTML blocks (types 1–7)', () => {
  const start = performance.now();
  const baseline = JSON.parse(readFileSync(new URL('./__fixtures__/html-export.main-19522197.json', import.meta.url), 'utf8')) as {
    revision: string;
    seed: number;
    sources: string;
    kept: [number, number][];
  };
  const cases = htmlExportCases();
  expect(cases).toHaveLength(HTML_EXPORT_COUNT);
  expect(baseline.revision).toBe('19522197f504ea71804fe65562fa77a234f500ce');
  expect(baseline.seed).toBe(HTML_EXPORT_SEED);
  expect(
    createHash('sha256')
      .update(cases.map(({ source }) => source).join('\0'))
      .digest('hex'),
  ).toBe(baseline.sources);
  expect(baseline.kept).toHaveLength(cases.length);
  const losses: Array<{ index: number; target: number; marker: string }> = [];
  const components = new Set(['note']);
  for (const { index, source, markers } of cases) {
    expect(
      tokenizeMdx(source, components)
        .map((token) => ('raw' in token ? token.raw : token.value))
        .join(''),
    ).toBe(source);
    for (const [target, output] of [md(source), portable(source)].entries()) {
      expect(baseline.kept[index]).toHaveLength(2);
      expect(baseline.kept[index]?.[target]).toBeTypeOf('number');
      for (const [bit, marker] of markers.entries())
        if (((baseline.kept[index]?.[target] ?? 0) & (1 << bit)) !== 0 && !output.includes(marker)) losses.push({ index, target, marker });
    }
  }
  console.info(
    `HTML export preservation: ${cases.length} cases, two targets, ${(performance.now() - start).toFixed(1)} ms; ${losses.length} lost markers`,
  );
  expect(losses.slice(0, 12), `${losses.length} lost markers`).toEqual([]);
});
