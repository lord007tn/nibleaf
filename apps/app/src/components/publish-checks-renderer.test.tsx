import { pageContentFacts } from '@nibleaf/shared/publish-checks';
import { parseHTML } from 'linkedom';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { collectPublishChecks, collectPublishIssues, page, snapshot } from '../../../worker/src/processors/publish-links.test-helpers';
import RichMarkdown from './markdown-rich';

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
  ['link in an MDX comment, which the reader shows', '{/* [a](/in-mdx-comment) */}', ['/in-mdx-comment']],
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
