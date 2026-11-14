import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { normalizePublicMarkdownContent, portablePublicMdxMarkdown } from './public-markdown-content';
import { exportCodeSamples, readerSanitizedActiveHtml, renderedActiveHtml } from './testing/export-guard';
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

it.each([
  '<a href="data:text/html,AUTHOR">AUTHOR</a>',
  '<a xlink:href="data:text/html,AUTHOR">AUTHOR</a>',
  '<video src="data:text/html,AUTHOR"></video>',
  '<img src="data:image/svg+xml,AUTHOR" alt="AUTHOR">',
  '<a href=" \tDaTa:text/html,AUTHOR">AUTHOR</a>',
  '<img src="&#100;ata&#58;image/png;base64,AUTHOR" alt="AUTHOR">',
  ...['png', 'jpeg', 'gif', 'webp'].map((type) => `<img src="data:image/${type};base64,AUTHOR" alt="AUTHOR">`),
])('matches the reader data-URL policy for %s', (source) => {
  // The actual reader schema permits no data: scheme, even PNG/JPEG/GIF/WebP.
  expect(renderedActiveHtml(source)).toBe(1);
  expect(readerSanitizedActiveHtml(source)).toBe(0);
  for (const project of [normalizePublicMarkdownContent, portablePublicMdxMarkdown]) {
    const output = project(source);
    expect(renderedActiveHtml(output)).toBe(0);
    expect(output).toContain('AUTHOR');
  }
});

it('also rejects Markdown data PNGs and links exposed by projected containers', () => {
  for (const payload of [
    '![AUTHOR](data:image/png;base64,AAAA)',
    '![AUTHOR](data:image/svg+xml,AAAA)',
    '[AUTHOR](data:image/png;base64,AAAA)',
    '[AUTHOR](d&#97;ta:image/png;base64,AAAA)',
    '[AUTHOR][ref]\n\n[ref]: data:image/png;base64,AAAA',
    '![AUTHOR][ref]\n\n[ref]: data:image/png;base64,AAAA',
  ]) {
    for (const wrap of [
      (body: string) => body,
      (body: string) => `> <div>\n> ~~~\n${body}`,
      (body: string) => `> > <div>\n> > ~~~\n${body}`,
      (body: string) => `- > <div>\n  > ~~~\n${body}`,
      (body: string) => `> - <div>\n>   ~~~\n${body}`,
      (body: string) => `<Note>\n> <div>\n> ~~~\n${body}\n</Note>`,
      (body: string) => `<div onclick="run()">\n${body}\n</div>`,
      (body: string) => `<!--\n${body}\n-->`,
      (body: string) => `<textarea>\n${body}\n</textarea>`,
    ]) {
      const source = wrap(payload);
      expect(readerSanitizedActiveHtml(source)).toBe(0);
      for (const project of [normalizePublicMarkdownContent, portablePublicMdxMarkdown]) {
        const output = project(source);
        expect(renderedActiveHtml(output), output).toBe(0);
        expect(output).toContain('AUTHOR');
      }
    }
  }
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
    expect(output).not.toContain('<');
    if (kind !== 'components') expect(output).toBe(source.replaceAll('<', '&lt;'));
  }
});

it('preserves all content as inert source when the parser work budget is exceeded', () => {
  const source = `${'AUTHOR '.repeat(40_000)}<sup>SAFE</sup> ![image](data:image/png;base64,AAAA)`;
  const output = portablePublicMdxMarkdown(source);
  expect(output).toBe(source.replaceAll('<', '&lt;').replaceAll('[', '&#91;'));
  expect(renderedActiveHtml(output)).toBe(0);
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
])('keeps code bytes through the parser budget: $name', ({ source, expected }) => {
  for (const project of [normalizePublicMarkdownContent, portablePublicMdxMarkdown]) {
    const output = project(source);
    expect(output).toContain(expected);
    for (const sample of exportCodeSamples(source)) expect(exportCodeSamples(output)).toContainEqual(sample);
  }
});

it('limits a long block without changing code or allowed markup elsewhere', () => {
  const source = `${'AUTHOR '.repeat(40_000)}<sup>LIMIT</sup>\n\n${fencedCode}\n\n    <i>INDENT</i> [LABEL](url)\n\nUse \`<u>SPAN</u> [LABEL](url)\`.\n\n<sub>NORMAL</sub>`;
  for (const project of [normalizePublicMarkdownContent, portablePublicMdxMarkdown]) {
    const output = project(source);
    expect(output).toContain(fencedCode);
    expect(output).toContain('    <i>INDENT</i> [LABEL](url)');
    expect(output).toContain('`<u>SPAN</u> [LABEL](url)`');
    expect(output).toContain('<sub>NORMAL</sub>');
    for (const sample of exportCodeSamples(source)) expect(exportCodeSamples(output)).toContainEqual(sample);
  }
});

it('does not charge a long code block to the prose work budget', () => {
  const source = `~~~html\n${'<b>SAFE</b> [LABEL](url)\n'.repeat(12_000)}~~~`;
  for (const project of [normalizePublicMarkdownContent, portablePublicMdxMarkdown]) expect(project(source)).toBe(source);
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
