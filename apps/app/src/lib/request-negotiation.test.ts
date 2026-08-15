import { describe, expect, it } from 'vitest';
import { acceptsHtml, isDocumentPath, notAcceptableHtmlResponse } from './request-negotiation';

describe('acceptsHtml', () => {
  it.each([
    null,
    '',
    '*/*',
    'text/html',
    'text/html; charset=utf-8',
    'application/xhtml+xml',
    'text/*',
    'application/json, text/html;q=0.8',
  ])('accepts %s', (value) => expect(acceptsHtml(value)).toBe(true));

  it.each(['text/markdown', 'text/plain', 'application/json', 'text/html;q=0', 'application/json, text/html;q=0'])('rejects %s', (value) =>
    expect(acceptsHtml(value)).toBe(false));
});

describe('isDocumentPath', () => {
  it.each(['/', '/pricing', '/blog/article', '/sites/project/page'])('identifies %s as a document route', (pathname) => {
    expect(isDocumentPath(pathname)).toBe(true);
  });

  it.each(['/api/public/sites/project', '/assets/app.js', '/brand/logo.svg', '/favicon.ico'])('excludes %s', (pathname) => {
    expect(isDocumentPath(pathname)).toBe(false);
  });
});

it('returns a crawler-safe 406 response', async () => {
  const response = notAcceptableHtmlResponse();
  expect(response.status).toBe(406);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  expect(await response.text()).toContain('llms.txt');
});
