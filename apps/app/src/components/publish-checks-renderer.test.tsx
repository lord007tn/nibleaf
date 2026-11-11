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
