import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { normalizePublicMarkdownContent, portablePublicMdxMarkdown } from './public-markdown-content';
import { readerSanitizedActiveHtml, renderedActiveHtml } from './testing/export-guard';
import { activeHtmlExportCases } from './testing/export-guard-cases';

it.each(activeHtmlExportCases())('exports no reader-rejected active HTML: $name', ({ name, sources }) => {
  const start = performance.now();
  const failures: unknown[] = [];
  for (const source of sources) {
    const readerActive = readerSanitizedActiveHtml(source);
    for (const project of [normalizePublicMarkdownContent, portablePublicMdxMarkdown]) {
      const output = project(source);
      if (renderedActiveHtml(output) > readerActive) failures.push({ source, output, target: project.name });
      if ((project === portablePublicMdxMarkdown || name !== 'top level') && !output.includes('SAFE')) {
        failures.push({ source, output, target: project.name, reason: 'lost author text' });
      }
    }
  }
  console.info(`Export safety: ${sources.length * 2} outputs in ${(performance.now() - start).toFixed(1)} ms`);
  expect(failures).toEqual([]);
});

it('escapes rejected markup without losing its text or changing allowed siblings and code', () => {
  const source = '> <div>\n> ~~~\n<div onclick="run()">AUTHOR <sup>2</sup></div>\n\n`<img onerror="run()">`';
  for (const project of [normalizePublicMarkdownContent, portablePublicMdxMarkdown]) {
    const output = project(source);
    expect(renderedActiveHtml(output)).toBe(0);
    expect(output).toContain('AUTHOR');
    expect(output).toContain('<sup>2</sup>');
    expect(output).toContain('`<img onerror="run()">`');
  }
  const allowed =
    '<video src="https://example.test/v.mp4" poster="/cover.png"><source src="/v.mp4" type="video/mp4"><track kind="captions" src="/v.vtt" srclang="en"></video>\n\n<sub>lo</sub><sup>hi</sup><u>under</u>';
  expect(portablePublicMdxMarkdown(allowed)).toBe(allowed);
  expect(portablePublicMdxMarkdown('<Unknown onclick="run()">AUTHOR</Unknown>')).toBe('&lt;Unknown onclick="run()">AUTHOR&lt;/Unknown>');
});
