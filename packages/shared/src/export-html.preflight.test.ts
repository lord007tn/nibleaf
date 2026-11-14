import { expect, it } from 'vitest';
import { escapeDisallowedExportHtml, mayHaveActiveExportHtml } from './export-html';
import { renderedActiveHtml } from './testing/export-guard';
import { htmlExportBoundaryCases, seededExportCases } from './testing/export-guard-cases';

it.each([
  '<div>ordinary text</div>',
  '<div class="sr-only" title="only words">ordinary</div>',
  'load1 < 6; free on the host. navigator.onLine=false; options=default',
  '[support](mailto:me@example.test)',
  '[nested [label]](mailto:me@example.test)',
  '<sup>2</sup><sub>lo</sub><u>under</u>',
  '[link](https://example.test/a) ![image](http://example.test/i.png)',
  '[link](/guide) [relative](guide/setup) [anchor](#start)',
  '[link][ref]\n\n[ref]: https://example.test',
  '<video src="https://example.test/v.mp4"></video><mdxembed provider="youtube"></mdxembed>',
])('bypasses parsing for ordinary output: %s', (source) => {
  expect(mayHaveActiveExportHtml(source)).toBe(false);
  expect(escapeDisallowedExportHtml(source)).toBe(source);
  expect(renderedActiveHtml(source)).toBe(0);
});

it.each([
  ...['script', 'style', 'iframe', 'object', 'embed'].flatMap((tag) => [`<${tag}>`, `</${tag.toUpperCase()}>`, `< / ${tag} >`]),
  '<div onclick="run()">',
  '<img onerror>',
  '<img title="a>b" onerror>',
  'onerror = run()',
  '[x](javascript:run())',
  '[x](vbscript:run())',
  '[x](data:image/png;base64,AAAA)',
  '[x](tel:+123)',
  '![x](mailto:me@example.test)',
  '[x][ref]\n\n[ref]: d&#97;ta:image/png;base64,AAAA',
  '<img src="java&Tab;script&colon;run()">',
  '<img src="java\tscript:run()">',
  '<img src="&#x64;ata:image/png;base64,AAAA">',
  '<img src="java\u007fscript:run()">',
  '![nested [label]](mailto:me@example.test)',
  '![escaped \\[label](mailto:me@example.test)',
  '[x][ref]\n\n[ref]: mailto:me@example.test',
])('conservatively parses potentially active output: %s', (source) => {
  expect(mayHaveActiveExportHtml(source)).toBe(true);
  expect(renderedActiveHtml(escapeDisallowedExportHtml(source))).toBe(0);
});

it.each([{ cases: htmlExportBoundaryCases() }, { cases: seededExportCases() }])('never skips an active generated shape', ({ cases }) => {
  const missed = cases.filter(({ source }) => !mayHaveActiveExportHtml(source) && renderedActiveHtml(source) > 0);
  expect(missed).toEqual([]);
});

it('keeps reference destinations isolated between parser calls', () => {
  expect(escapeDisallowedExportHtml('[first][ref]\n\n[ref]: data:image/png;base64,AAAA')).toBe('[first][ref]\n\n[ref]: #');
  expect(escapeDisallowedExportHtml('<img onerror="run()">\n\n[second][ref]')).toBe('&lt;img onerror="run()">\n\n[second][ref]');
  expect(escapeDisallowedExportHtml('<img onerror="run()">\n\n[third][ref]\n\n[ref]: https://example.test')).toBe(
    '&lt;img onerror="run()">\n\n[third][ref]\n\n[ref]: https://example.test',
  );
});
