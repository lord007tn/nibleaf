import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { escapeDisallowedExportHtml } from './export-html';
import { normalizePublicMarkdownContent, portablePublicMdxMarkdown } from './public-markdown-content';
import { exportCodeSamples, readerSanitizedActiveHtml, renderedActiveHtml } from './testing/export-guard';
import { activeHtmlExportCases } from './testing/export-guard-cases';

it.each(activeHtmlExportCases())('exports no live script/style/iframe/object/embed: $name', ({ sources }) => {
  const start = performance.now();
  const failures: unknown[] = [];
  for (const source of sources) {
    const readerActive = readerSanitizedActiveHtml(source);
    for (const project of [normalizePublicMarkdownContent, portablePublicMdxMarkdown]) {
      const output = project(source);
      if (renderedActiveHtml(output) > readerActive) failures.push({ source, output, target: project.name });
      if (!output.includes('AUTHOR')) failures.push({ source, output, target: project.name, reason: 'lost author prose' });
      if (project === portablePublicMdxMarkdown && !output.includes('SAFE')) {
        failures.push({ source, output, target: project.name, reason: 'lost author text' });
      }
    }
  }
  console.info(`Export safety: ${sources.length * 2} outputs in ${(performance.now() - start).toFixed(1)} ms`);
  expect(failures).toEqual([]);
});

it.each(['quotes', 'lists', 'components'])('preserves deep %s with HTML without recursive parser failure', (kind) => {
  const payload = '<sup>SAFE</sup>';
  const source =
    kind === 'quotes'
      ? '> '.repeat(8000) + payload
      : kind === 'lists'
        ? '- '.repeat(8000) + payload
        : '<Note>'.repeat(8000) + payload + '</Note>'.repeat(8000);
  for (const project of [normalizePublicMarkdownContent, portablePublicMdxMarkdown]) {
    const output = project(source);
    expect(output).toContain('SAFE');
    expect(output.indexOf('SAFE')).toBe(output.lastIndexOf('SAFE'));
    expect(renderedActiveHtml(output)).toBe(0);
    if (kind !== 'components') expect(output).toBe(source);
  }
});

const codeBody = `${'>'.repeat(129)}<b>SAFE</b> [LABEL](url)`;
const fencedCode = `~~~html\n${codeBody}\n~~~`;
const deepBlock = `${'> '.repeat(129)}<sup>DEEP</sup>`;
const codeSpan = `\`${codeBody}\``;
it.each([
  { name: 'the lead repro', source: fencedCode, expected: fencedCode },
  { name: 'long fences', source: `~~~~~~~~~html\n${codeBody}\n~~~~~~~~~`, expected: `~~~~~~~~~html\n${codeBody}\n~~~~~~~~~` },
  { name: 'indented code', source: `    ${codeBody}`, expected: `    ${codeBody}` },
  { name: 'indented code in a quote', source: `>     ${codeBody}`, expected: `>     ${codeBody}` },
  { name: 'indented code in a list', source: `- item\n\n      ${codeBody}`, expected: `      ${codeBody}` },
  { name: 'indented code in a component', source: `<Note>\n\n    ${codeBody}\n\n</Note>`, expected: `    ${codeBody}` },
  { name: 'code span in a quote', source: `${deepBlock}\n\n> Use ${codeSpan}.`, expected: codeSpan },
  { name: 'code span in a list', source: `${deepBlock}\n\n- Use ${codeSpan}.`, expected: codeSpan },
  { name: 'code span in a component', source: `${deepBlock}\n\n<Note>\n\nUse ${codeSpan}.\n\n</Note>`, expected: codeSpan },
  {
    name: 'quoted code',
    source: fencedCode
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n'),
    expected: fencedCode
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n'),
  },
  { name: 'listed code', source: `- ~~~html\n  ${codeBody}\n  ~~~`, expected: `- ~~~html\n  ${codeBody}\n  ~~~` },
  {
    name: 'component code',
    source: `<Note>\n\n${fencedCode}\n\n</Note>`,
    expected: fencedCode
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n'),
  },
  {
    name: 'code spans beside a deep block',
    source: `> ${'> '.repeat(129)}<sup>DEEP</sup>\n\nUse \`<b>SAFE</b> [LABEL](url)\`.`,
    expected: '`<b>SAFE</b> [LABEL](url)`',
  },
])('final safety pass keeps code bytes: $name', ({ source, expected }) => {
  const output = escapeDisallowedExportHtml(source);
  const codeExpected = expected.includes('> ~~~html') && source.startsWith('<Note>') ? fencedCode : expected;
  expect(output).toContain(codeExpected);
  for (const sample of exportCodeSamples(source)) expect(exportCodeSamples(output)).toContainEqual(sample);
});

it('keeps code and allowed markup in a long document', () => {
  const source = `${'AUTHOR '.repeat(40_000)}<sup>LIMIT</sup>\n\n${fencedCode}\n\n    <i>INDENT</i> [LABEL](url)\n\nUse \`<u>SPAN</u> [LABEL](url)\`.\n\n<sub>NORMAL</sub>`;
  const output = escapeDisallowedExportHtml(source);
  expect(output).toContain(fencedCode);
  expect(output).toContain('    <i>INDENT</i> [LABEL](url)');
  expect(output).toContain('`<u>SPAN</u> [LABEL](url)`');
  expect(output).toContain('<sub>NORMAL</sub>');
  for (const sample of exportCodeSamples(source)) expect(exportCodeSamples(output)).toContainEqual(sample);
});

it('keeps a large code block unchanged', () => {
  const source = `~~~html\n${'<b>SAFE</b> [LABEL](url)\n'.repeat(12_000)}~~~`;
  for (const project of [normalizePublicMarkdownContent, portablePublicMdxMarkdown]) expect(project(source)).toBe(source);
});

it('keeps allowed siblings and code while escaping only active elements', () => {
  const source = '> <div>\n> ~~~\n<script>AUTHOR <sup>2</sup></script>\n\n`<iframe>CODE</iframe>`';
  for (const project of [normalizePublicMarkdownContent, portablePublicMdxMarkdown]) {
    const output = project(source);
    expect(renderedActiveHtml(output)).toBe(0);
    expect(output).toContain('AUTHOR');
    expect(output).toContain('`<iframe>CODE</iframe>`');
  }
  const allowed = '<video src="https://example.test/v.mp4"></video>\n\n<sub>lo</sub><sup>hi</sup><u>under</u>';
  expect(portablePublicMdxMarkdown(allowed)).toBe(allowed);
});

// Round 4: main's output is authoritative, including its MDX filtering policy.
it.each(['script', 'style', 'iframe', 'object', 'embed'])('keeps main filtering and code with %s after indentation', (tag) => {
  const source = `    x\n\nBefore <${tag}>SECRET</${tag}> after.`;
  expect(normalizePublicMarkdownContent(source)).toBe('x\n\nBefore  after.');
  expect(portablePublicMdxMarkdown(source)).toBe(`    x\n\nBefore &lt;${tag}>SECRET${tag === 'embed' ? '</embed>' : `&lt;/${tag}>`} after.`);
});
it('keeps the main expression policy in each export', () => {
  const source = '    x\n\nBefore {secret} after.';
  expect(normalizePublicMarkdownContent(source)).toBe('x\n\nBefore  after.');
  expect(portablePublicMdxMarkdown(source)).toBe(source);
});
it('keeps real fence delimiters at quote depth 65', () => {
  const source = ['<x>', '', '~~~', 'X', '~~~'].map((line) => '> '.repeat(65) + line).join('\n');
  expect(portablePublicMdxMarkdown(source)).toBe(source);
  expect(normalizePublicMarkdownContent(source)).toBe(source.replaceAll('<x>', '&lt;x&gt;'));
});
