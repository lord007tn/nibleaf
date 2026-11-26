import { markdownParseBudget } from '@nibleaf/shared/page-limits';
import { pageContentFacts } from '@nibleaf/shared/publish-checks';
import { ORDINARY_PAGES } from '@nibleaf/shared/testing/markdown-parse-budget-cases';
import { parseHTML } from 'linkedom';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { collectPublishChecks, collectPublishIssues, page, snapshot } from '../../../worker/src/processors/publish-links.test-helpers';
import { Markdown, rendererModulesFor } from './markdown';
import RichMarkdown from './markdown-rich';

it('renders a page over the size cap as its plain source, without selecting Markdown feature modules', () => {
  const content = ['<em>Literal markup</em>', 'Ordinary text. '.repeat(36_000), '```rust\nfn main() {}\n```'].join('\n\n');
  expect(rendererModulesFor(content)).toEqual([]);
  const { document } = parseHTML(renderToStaticMarkup(<Markdown content={content} />));
  expect(document.querySelector('pre')?.textContent).toBe(content);
  expect(document.querySelector('em')).toBeNull();
  expect(document.querySelector('[data-hydration-module]')).toBeNull();
});

it('shows only the block over budget as plain text, renders the rest, and warns about that line', () => {
  const block = `<em>Inside</em> [Hidden](/hidden)\n${'*a* '.repeat(600)}`;
  const content = `[Guide](/missing)\n\n<em>Rendered</em>\n\n${block}\n\n## After\n\n[After](/after)`;
  const { document } = parseHTML(renderToStaticMarkup(<RichMarkdown content={content} />));
  const plain = document.querySelectorAll('[data-markdown-plain]');
  expect(plain).toHaveLength(1);
  expect(plain[0]?.textContent).toBe(block);
  expect(plain[0]?.getAttribute('dir')).toBe('auto');
  expect([...document.querySelectorAll('a[href]:not(.heading-anchor)')].map((link) => link.getAttribute('href'))).toEqual(['/missing', '/after']);
  expect([...document.querySelectorAll('em')].map((element) => element.textContent)).toEqual(['Rendered']);
  expect(document.querySelector('h2')?.textContent).toBe('After');
  // Never drawn as code: no code panel, copy button or language badge.
  expect(document.querySelector('[data-theme-component="code"]')).toBeNull();

  const site = snapshot([page({ path: 'start', content })]);
  expect(pageContentFacts(content).links).toEqual(['/missing', '/after']);
  expect(collectPublishChecks(site)).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: 'markdown-parse-limit', severity: 'warning', detail: 'syntaxMarkers:5:1202' })]),
  );
  expect(
    collectPublishIssues(site)
      .filter((issue) => issue.type === 'broken-link')
      .map((issue) => issue.detail),
  ).toEqual([
    // The link inside the plain block (/hidden) doesn't render, so it isn't checked.
    'Link to "/missing" does not match any page.',
    'Link to "/after" does not match any page.',
  ]);
});

it('draws an authored `nibleaf-plain` fence as code, beside a region over budget', () => {
  const over = '*a* '.repeat(600);
  const content = `\`\`\`nibleaf-plain\nconst authored = true;\n\`\`\`\n\n${over}`;
  for (const Renderer of [Markdown, RichMarkdown]) {
    const { document } = parseHTML(renderToStaticMarkup(<Renderer content={content} />));
    expect(document.querySelectorAll('[data-markdown-plain]')).toHaveLength(1);
    expect(document.querySelector('[data-markdown-plain]')?.textContent).toBe(over);
    expect(document.querySelector('pre code')?.textContent).toContain('const authored = true;');
  }
});

it.each(ORDINARY_PAGES)('renders %s richly, from the same source main renders', (_name, content) => {
  expect(markdownParseBudget(content).content).toBe(content);
  const { document } = parseHTML(renderToStaticMarkup(<RichMarkdown content={content} />));
  expect(document.querySelector('[data-markdown-plain]')).toBeNull();
  expect(document.querySelector('.typeset > pre:only-child')).toBeNull();
});

it.each([
  ['JSX Card', '<Card href="/card">Next</Card>\n\n[Markdown](/markdown)', ['/card', '/markdown']],
  ['anchor after a comment', '<!-- c -->\n\n<a href=/anchor>Next</a>\n\n<Card href="/card">Card</Card>', ['/anchor', '/card']],
  [
    'script/template subtrees',
    '<script><a href="/script">Hidden</a></script>\n\n<template><a href="/template">Hidden</a></template>\n\n<a href="/visible">Visible</a>',
    ['/visible'],
  ],
  // Escaped Markdown is text: `\<script>` opens no context, so the link renders.
  [
    'escaped tags in invalid MDX',
    '<!-- c -->\n\n\\<script>\n\n[Visible](/escaped)\n\n\\</script>\n\n\\<title>\n\n[Also](/escaped-title)\n\n\\</title>',
    ['/escaped', '/escaped-title'],
  ],
  // Inside a raw HTML block the reader parses the Card and drops the spread.
  [
    'spread Cards inside raw HTML, both attribute orders',
    '<div><Card href="/div-spread" {...props}>Next</Card></div>\n\n<div><Card {...props} href="/div-spread-first">Next</Card></div>',
    ['/div-spread', '/div-spread-first'],
  ],
  // On its own line a spread is not valid HTML to CommonMark, so it renders as text.
  [
    'standalone spread Cards, both attribute orders',
    '<Card href="/text-spread" {...props}>Next</Card>\n\n<Card {...props} href="/text-spread-first">Next</Card>\n\n[Visible](/visible)',
    ['/visible'],
  ],
  // The reader un-indents component lines; an indented Markdown line stays code.
  ['indented Card line', 'Intro\n\n    <Card href="/indented">Next</Card>\n\nMore\n\n    [code](/indented-code)', ['/indented']],
  ['Markdown link between blank lines in raw HTML', '<div>\n\n[x](/in-div)\n\n</div>\n\n<div>\n[y](/raw-text)\n</div>', ['/in-div']],
  ['link in an MDX comment, which the reader drops', '{/* [a](/in-mdx-comment) */}', []],
] as const)('matches actual reader links for %s through both publish adapters', (_name, content, expected) => {
  const html = renderToStaticMarkup(<RichMarkdown content={content} />);
  const { document } = parseHTML(html);
  const rendered = [...document.querySelectorAll('a[href]')].map((anchor) => anchor.getAttribute('href')).filter((href) => href?.startsWith('/'));
  expect(new Set(rendered)).toEqual(new Set(expected));
  expect(new Set(pageContentFacts(content).links)).toEqual(new Set(rendered));
  const site = snapshot([page({ path: 'start', content })]);
  expect(
    collectPublishChecks(site)
      .filter((check) => check.code === 'broken-internal-link')
      .map((check) => check.detail),
  ).toEqual([...expected]);
  expect(
    collectPublishIssues(site)
      .filter((issue) => issue.type === 'broken-link')
      .map((issue) => issue.detail),
  ).toEqual(expected.map((href) => `Link to "${href}" does not match any page.`));
});
