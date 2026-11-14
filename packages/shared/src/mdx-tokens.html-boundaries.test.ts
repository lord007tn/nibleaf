import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { normalizePublicMarkdownContent as md, portablePublicMdxMarkdown as portable } from './public-markdown-content';
import { activeExportHtml, htmlExportBoundaryCases } from './testing/html-export-boundary-cases';

it.each(['div', 'span', 'details', 'custom-tag'])('keeps a fence literal past a blank line ending an HTML %s block', (tag) => {
  const repro = `<${tag}>\n~~~\n\n{VISIBLE}\n~~~\n</${tag}>`;
  expect(md(repro)).toBe(`&lt;${tag}&gt;\n~~~\n\n{VISIBLE}\n~~~\n&lt;/${tag}&gt;`);
  expect(portable(repro)).toBe(repro);
  const source = `<${tag}>\n~~~\n\n{VISIBLE}\n<script>SAFE_LITERAL</script>\n~~~\n</${tag}>`;
  expect(md(source)).toBe(`&lt;${tag}&gt;\n~~~\n\n{VISIBLE}\n<script>SAFE_LITERAL</script>\n~~~\n&lt;/${tag}&gt;`);
  expect(portable(source)).toBe(source);
  expect(activeExportHtml(md(source))).toBe(0);
});

it('keeps a fence literal past the HTML comment terminator and a blank line', () => {
  const source = '<!--\n~~~\n-->\n\n{VISIBLE}\n<script>SAFE_LITERAL</script>\n~~~\nFollowing';
  expect(md(source)).toBe('&lt;!--\n~~~\n-->\n\n{VISIBLE}\n<script>SAFE_LITERAL</script>\n~~~\nFollowing');
  expect(portable(source)).toBe(source);
  expect(activeExportHtml(md(source))).toBe(0);
});

it.each(['quote', 'list'])('keeps the whole literal example across an HTML-ending blank in a %s', (container) => {
  const lines = ['<div>', '~~~', '', '{VISIBLE}', '<script>SAFE_LITERAL</script>', '~~~', '</div>'];
  const source = lines.map((line, at) => (container === 'quote' ? '> ' : at === 0 ? '- ' : '  ') + line).join('\n');
  expect(md(source)).toBe(source.replaceAll('<div>', '&lt;div&gt;').replaceAll('</div>', '&lt;/div&gt;'));
  expect(portable(source)).toBe(source);
  expect(activeExportHtml(md(source))).toBe(0);
});

it('preserves whole-page markers in the exact 2,640 review shapes, without newly active HTML', () => {
  const start = performance.now();
  const cases = htmlExportBoundaryCases();
  const baseline = JSON.parse(readFileSync(new URL('./__fixtures__/html-export-boundaries.main-19522197.json', import.meta.url), 'utf8')) as {
    revision: string;
    sources: string;
    kept: [number, number][];
    active: [number, number][];
  };
  expect(cases).toHaveLength(2640);
  expect(baseline.revision).toBe('19522197f504ea71804fe65562fa77a234f500ce');
  expect(
    createHash('sha256')
      .update(cases.map(({ source }) => source).join('\0'))
      .digest('hex'),
  ).toBe(baseline.sources);
  expect(baseline.kept).toHaveLength(cases.length);
  expect(baseline.active).toHaveLength(cases.length);
  // Problems are collected and asserted once: an expect() per marker made this
  // test take 16 s on a loaded CI runner (it takes under 1 s locally).
  const losses: Array<{ index: number; target: number; marker: string }> = [];
  const misplaced: Array<{ index: number; target: number; marker: string }> = [];
  const missingBaseline: number[] = [];
  const newlyActive: Array<{ index: number; target: number }> = [];
  for (const { index, source, markers } of cases) {
    for (const [target, output] of [md(source), portable(source)].entries()) {
      const expected = baseline.kept[index]?.[target];
      const active = baseline.active[index]?.[target];
      if (typeof expected !== 'number' || typeof active !== 'number') {
        missingBaseline.push(index);
        continue;
      }
      let previous = -1;
      for (const [bit, marker] of markers.entries()) {
        if ((expected & (1 << bit)) === 0) continue;
        const at = output.indexOf(marker);
        if (at === -1) losses.push({ index, target, marker });
        // Each kept marker appears once, in source order.
        else if (at <= previous || output.indexOf(marker, at + marker.length) !== -1) misplaced.push({ index, target, marker });
        else previous = at;
      }
      if (activeExportHtml(output) > active) newlyActive.push({ index, target });
    }
  }
  const shapes = new Set(losses.map(({ index }) => index)).size;
  console.info(
    `Whole-page HTML preservation: ${cases.length} cases, two targets, ${(performance.now() - start).toFixed(1)} ms; ${losses.length} lost markers in ${shapes} shapes; ${newlyActive.length} newly active`,
  );
  expect(missingBaseline).toEqual([]);
  expect(losses.slice(0, 12), `${losses.length} lost markers in ${shapes} shapes`).toEqual([]);
  expect(misplaced.slice(0, 12), `${misplaced.length} duplicated or reordered markers`).toEqual([]);
  expect(newlyActive).toEqual([]);
  // A loaded CI runner can be several times slower than a laptop; the cases themselves stay linear (growth tests cover that).
}, 60_000);
