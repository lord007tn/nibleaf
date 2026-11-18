import { expect, it, vi } from 'vitest';
import { escapeDisallowedExportHtml } from './export-html';
import { normalizePublicMarkdownContent, portablePublicMdxMarkdown } from './public-markdown-content';

it.each([
  { source: '<script>PRIVATE_BODY</script>', output: '&lt;script>PRIVATE&#95;BODY&lt;/script>' },
  { source: '<script>PRIVATE_BODY', output: '&lt;script>PRIVATE&#95;BODY' },
  { source: '<script>ONE</script><iframe>TWO</iframe>', output: '&lt;script>ONE&lt;/script>&lt;iframe>TWO&lt;/iframe>' },
  { source: '> <script>\n</script>', output: '\n&#62;&#32;&#60;script&#62;&#10;&#60;&#47;script&#62;\n\n' },
  { source: '<img onerror="PRIVATE_BODY()">', output: '\n&#60;img&#32;onerror&#61;&#34;PRIVATE&#95;BODY&#40;&#41;&#34;&#62;\n\n' },
])('reports one selected fallback with page id only: $source', ({ source, output }) => {
  const onLiteralFallback = vi.fn();
  const context = { pageId: 'page_688', onLiteralFallback, source, title: 'PRIVATE_TITLE', url: 'https://private.invalid' };
  expect(escapeDisallowedExportHtml(source, context)).toBe(output);
  expect(escapeDisallowedExportHtml(source)).toBe(output);
  expect(onLiteralFallback.mock.calls).toEqual([[{ pageId: 'page_688' }]]);
});

it('reports each separate literal region, including on a later export of the same page', () => {
  const source = '<script>ONE</script>\n\nTEXT\n\n<iframe>TWO</iframe>';
  const onLiteralFallback = vi.fn();
  const context = { pageId: 'page_688', onLiteralFallback };
  const expected = '&lt;script>ONE&lt;/script>\n\nTEXT\n\n&lt;iframe>TWO&lt;/iframe>';
  expect(portablePublicMdxMarkdown(source, context)).toBe(expected);
  expect(onLiteralFallback.mock.calls).toEqual([[{ pageId: 'page_688' }], [{ pageId: 'page_688' }]]);
  portablePublicMdxMarkdown(source, context);
  expect(onLiteralFallback).toHaveBeenCalledTimes(4);
});

it.each([normalizePublicMarkdownContent, portablePublicMdxMarkdown])('threads context through %s without duplicate signals', (project) => {
  // An outdent exposes HTML from the projection's unclosed quoted code fence.
  const source = '> ~~~\n> PRIVATE_BODY\n  -->\n  > <SCRIPT>\n  > <script>\n</style>';
  const onLiteralFallback = vi.fn();
  const output = project(source, { pageId: 'page_688', onLiteralFallback });
  expect(output).toBe(project(source));
  expect(onLiteralFallback.mock.calls).toEqual([[{ pageId: 'page_688' }]]);
});

it.each([
  'Normal **prose** and `code`.',
  '<u>formatting</u>',
  '~~~html\n<script>PRIVATE_BODY</script>\n~~~',
  '<!-- <script>PRIVATE_BODY</script> -->',
  '<embed>',
])('emits nothing on the ordinary or structure-preserving path: %s', (source) => {
  const onLiteralFallback = vi.fn();
  for (const project of [escapeDisallowedExportHtml, normalizePublicMarkdownContent, portablePublicMdxMarkdown]) {
    expect(project(source, { pageId: 'page_688', onLiteralFallback })).toBe(project(source));
  }
  expect(onLiteralFallback).not.toHaveBeenCalled();
});
