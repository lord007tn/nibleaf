import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { captureExportStructure, compareExportStructure, literalExportText } from './export-structure';
import { normalizePublicMarkdownContent, portablePublicMdxMarkdown } from './public-markdown-content';
import { authoredVisibleText, inspectExport, newlyLiveFeatures } from './testing/export-oracle';

const mode = vi.hoisted(() => ({ main: false }));
vi.mock('./export-html', async (original) => {
  const actual = await original<typeof import('./export-html')>();
  return { ...actual, escapeDisallowedExportHtml: (source: string) => (mode.main ? source : actual.escapeDisallowedExportHtml(source)) };
});
const reviewCases = JSON.parse(readFileSync(new URL('./__fixtures__/markdown-export.visible-repros.json', import.meta.url), 'utf8')) as string[];
const minimal = '> <div title="\n2. <script>BODY</script>\n   FOLLOW';
const inOrder = (expected: string, actual: string) => {
  let cursor = 0;
  for (const c of expected) {
    const at = actual.indexOf(c, cursor);
    if (at < 0) return false;
    cursor = at + c.length;
  }
  return true;
};
const check = (sources: string[]) => {
  const failures: unknown[] = [];
  for (const source of sources)
    for (const project of [normalizePublicMarkdownContent, portablePublicMdxMarkdown]) {
      mode.main = true;
      let baseline: string;
      try {
        baseline = project(source);
      } finally {
        mode.main = false;
      }
      const output = project(source);
      const before = inspectExport(baseline),
        after = inspectExport(output);
      const model = captureExportStructure(baseline, before.tokens);
      const comparison = compareExportStructure(model, output, after.tokens);
      const expected = (model.rescue ?? []).map((range) => authoredVisibleText(baseline.slice(range.from, range.to))).join('');
      const visible = !comparison.unpreservable || inOrder(expected, after.text);
      const labels = ['BODY', 'FOLLOW', 'KEPT', 'CODE', 'LINK'].every((label) => !before.text.includes(label) || after.text.includes(label));
      if (
        after.elements ||
        newlyLiveFeatures(before.features, after.features) ||
        !visible ||
        !labels ||
        !comparison.preserved ||
        (!before.elements && output !== baseline)
      )
        failures.push({ source, expected, before: before.text, after: after.text, visible, labels, preserved: comparison.preserved });
    }
  expect(failures).toEqual([]);
};

it('keeps main-visible BODY and FOLLOW after an earlier unterminated attribute', () => check([minimal]));
it('keeps visible text in all 28 independently reported failures', () => {
  expect(reviewCases).toHaveLength(28);
  check(reviewCases);
});
it('covers both attribute quotes, enclosing containers, HTML, lists and comments', () => {
  const sources: string[] = [];
  for (const tag of ['div', 'p', 'span', 'a'])
    for (const quote of ['"', "'"])
      for (const prefix of ['> ', '> > ', '- > ', '> - ', '- ', '12. '])
        for (const middle of [
          '2. <script>BODY</script>\n   FOLLOW',
          '<script>BODY</script>\n\nFOLLOW',
          '<!-- context -->\n2. <style>BODY</style>\n   FOLLOW',
        ])
          sources.push(`${prefix}<${tag} title=${quote}\n${quote === "'" ? '<span title="\'">CLOSE</span>\n' : ''}${middle}`);
  expect(sources).toHaveLength(144);
  check(sources);
});
it('rejects canonical fallback bytes that remain hidden in an earlier attribute', () => {
  const before = inspectExport(minimal);
  const model = captureExportStructure(minimal, before.tokens);
  const range = { from: minimal.indexOf('2.'), to: minimal.length, run: 1 };
  const broken = { ...model, literal: [range], rescue: [range] };
  const output = literalExportText(broken);
  const after = inspectExport(output);
  expect(before.text).toContain('FOLLOW');
  expect(after.text).not.toContain('FOLLOW');
  expect(compareExportStructure(broken, output, after.tokens).preserved).toBe(false);
});

it('requires authored characters, excluding renderer-generated escape spellings', () => {
  const source = reviewCases[18] ?? '';
  mode.main = true;
  const baseline = portablePublicMdxMarkdown(source);
  mode.main = false;
  expect(inspectExport(baseline).text).toContain('--&gt;');
  const output = portablePublicMdxMarkdown(source);
  expect(inspectExport(output).text).toContain('-->');
  const entitySource = minimal.replaceAll('BODY', '&lt;AUTHOR&gt; &amp; &#62; &quot;');
  const entityOutput = portablePublicMdxMarkdown(entitySource);
  expect(inspectExport(entityOutput).text).toContain('<AUTHOR> & > "');
  expect(inspectExport(entityOutput).elements).toBe(0);
  check([source]);
});
