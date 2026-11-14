import { expect, it } from 'vitest';
import { escapeDisallowedExportHtml, mayHaveActiveExportHtml } from './export-html';
import { renderedActiveHtml } from './testing/export-guard';
import { htmlExportBoundaryCases, seededExportCases } from './testing/export-guard-cases';

it.each(['<div>text</div>', '<sup>2</sup><sub>x</sub><u>y</u>', '<img onerror="run()">', '[x](data:text/html,x)', '<a href="javascript:x">x</a>'])(
  'bypasses non-element hardening pending #664: %s',
  (source) => {
    expect(mayHaveActiveExportHtml(source)).toBe(false);
    expect(escapeDisallowedExportHtml(source)).toBe(source);
  },
);
it.each(['script', 'style', 'iframe', 'object', 'embed'])('finds every case-insensitive %s opener', (tag) => {
  expect(mayHaveActiveExportHtml(`<${tag.toUpperCase()}>`)).toBe(true);
  expect(mayHaveActiveExportHtml(`prefix<${tag}suffix>`)).toBe(true);
});
it.each([{ cases: htmlExportBoundaryCases() }, { cases: seededExportCases() }])('never skips a live element in a generated shape', ({ cases }) => {
  expect(cases.filter(({ source }) => !mayHaveActiveExportHtml(source) && renderedActiveHtml(source) > 0)).toEqual([]);
});

it.each(['> <div>\n> ~~~\n- > <a href="java\n  > script:alert(1)">click</a>', '`<i title="`\n\n<img onerror\f=alert(1)>'])(
  'keeps the deferred #664 repro outside this pass: %s',
  (source) => {
    expect(mayHaveActiveExportHtml(source)).toBe(false);
    expect(escapeDisallowedExportHtml(source)).toBe(source);
  },
);
