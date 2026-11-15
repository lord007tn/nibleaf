import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { captureExportStructure, compareExportStructure } from './export-structure';
import { normalizePublicMarkdownContent, portablePublicMdxMarkdown } from './public-markdown-content';
import { inspectExport, newlyLiveFeatures, visibleExportText } from './testing/export-oracle';

const mode = vi.hoisted(() => ({ main: false }));
vi.mock('./export-html', async (original) => {
  const actual = await original<typeof import('./export-html')>();
  return { ...actual, escapeDisallowedExportHtml: (source: string) => (mode.main ? source : actual.escapeDisallowedExportHtml(source)) };
});
const samples = JSON.parse(readFileSync(new URL('./__fixtures__/markdown-export.throw-repros.json', import.meta.url), 'utf8')) as string[];
it.each([
  '<embed>\n> <!--\n> <img onerror="ATTACK()">',
  '> <script>\n</script>',
  '> <script>\n</script>\n',
  '<script>Arabic \u0639\u0631\u0628\u064a &amp; emoji \u{1fab4}\n\n    CODE</script>',
  '1. <style><style>BODY</style>\n   PROSE\n   \n   \t<object>CODE</object>\n2. NEXT',
  '12. <script>x</script>\n    FOLLOW\n    <!--\n<img onerror="ATTACK()">',
  '- ~~~\n<embed>\n  <pre>\n- \n<pre>',
  ...samples,
])('never throws or exposes inert HTML, and preserves visible fallback text: %s', (source) => {
  for (const project of [normalizePublicMarkdownContent, portablePublicMdxMarkdown]) {
    mode.main = true;
    const baseline = project(source);
    mode.main = false;
    const output = project(source);
    const before = inspectExport(baseline),
      after = inspectExport(output);
    expect(after.elements).toBe(0);
    expect(newlyLiveFeatures(before.features, after.features)).toBe(0);
    const model = captureExportStructure(baseline, before.tokens);
    const comparison = compareExportStructure(model, output, after.tokens);
    expect(comparison.preserved).toBe(true);
    expect(comparison.outsideCodeStable).toBe(true);
    if (comparison.unpreservable)
      for (const range of model.rescue ?? model.literal ?? []) expect(after.text).toContain(visibleExportText(baseline.slice(range.from, range.to)));
  }
});

it('keeps indentation visible in a literal multiline embed without a rescue', () => {
  const source = '<iframe\n  title="Text"\n></iframe>';
  mode.main = true;
  const baseline = portablePublicMdxMarkdown(source);
  mode.main = false;
  const output = portablePublicMdxMarkdown(source);
  const before = inspectExport(baseline),
    after = inspectExport(output);
  expect(after.elements).toBe(0);
  expect(after.text).toContain(`${source}\n`);
  const comparison = compareExportStructure(captureExportStructure(baseline, before.tokens), output, after.tokens);
  expect(comparison.equal).toBe(true);
  expect(comparison.unpreservable).toBe(false);
});
