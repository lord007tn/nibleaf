import { describe, expect, it } from 'vitest';
import {
  acceptsHtml,
  appendVary,
  asHtmlRenderRequest,
  isAppOwnedPath,
  isDocumentPath,
  notAcceptableHtmlResponse,
  preferredRepresentation,
} from './request-negotiation';

describe('acceptsHtml', () => {
  it.each([null, '', '*/*', 'text/html', 'text/html; charset=utf-8', 'application/xhtml+xml', 'text/*', 'application/json, text/html;q=0.8'])(
    'accepts %s',
    (value) => expect(acceptsHtml(value)).toBe(true),
  );

  it.each(['text/markdown', 'text/plain', 'application/json', 'text/html;q=0', 'application/json, text/html;q=0'])('rejects %s', (value) =>
    expect(acceptsHtml(value)).toBe(false),
  );
});

describe('preferredRepresentation', () => {
  it.each([
    [null, 'text/html'],
    ['', 'text/html'],
    ['*/*', 'text/html'],
    ['text/markdown', 'text/markdown'],
    ['text/markdown, text/html;q=0.8', 'text/markdown'],
    ['text/html, text/markdown;q=0.5', 'text/html'],
    ['text/markdown;q=0, */*;q=0.8', 'text/html'],
    ['text/markdown, text/html;q=0', 'text/markdown'],
    ['application/pdf', null],
  ])('selects %s as %s', (accept, expected) => {
    expect(preferredRepresentation(accept)).toBe(expected);
  });
});

it('merges Vary fields without duplicates', () => {
  const headers = new Headers({ Vary: 'Accept-Encoding' });
  appendVary(headers, 'Accept');
  appendVary(headers, 'accept');
  expect(headers.get('vary')).toBe('Accept-Encoding, Accept');
});

it.each(['GET', 'HEAD'])('creates an HTML renderer request from %s Markdown negotiation', (method) => {
  const request = new Request('https://nibleaf.com/developers', {
    method,
    headers: { Accept: 'text/markdown', 'X-Request-ID': 'agent-test' },
  });
  const rendered = asHtmlRenderRequest(request);
  expect(rendered.method).toBe('GET');
  expect(rendered.headers.get('accept')).toBe('text/html');
  expect(rendered.headers.get('x-request-id')).toBe('agent-test');
});

it('accepts a Fetch-compatible framework request without cloning private runtime state', () => {
  const frameworkRequest = {
    headers: new Headers({ Accept: 'text/markdown' }),
    method: 'GET',
    url: 'https://nibleaf.com/',
  } as Request;
  expect(asHtmlRenderRequest(frameworkRequest).headers.get('accept')).toBe('text/html');
});

describe('isDocumentPath', () => {
  it.each(['/', '/pricing', '/blog/article', '/sites/project/page'])('identifies %s as a document route', (pathname) => {
    expect(isDocumentPath(pathname)).toBe(true);
  });

  it.each(['/api/public/sites/project', '/assets/app.js', '/_serverFn/handler', '/brand/logo.svg', '/favicon.ico'])('excludes %s', (pathname) => {
    expect(isDocumentPath(pathname)).toBe(false);
  });
});

describe('isAppOwnedPath', () => {
  it.each(['/api/public/sites/project', '/assets/app.js', '/favicon.ico', '/sites/project', '/_serverFn/handler', '/_tanstack/start'])(
    'keeps %s on the application runtime',
    (pathname) => expect(isAppOwnedPath(pathname)).toBe(true),
  );

  it.each(['/', '/getting-started', '/ar/use-nibleaf/authoring'])('allows %s to resolve as published content', (pathname) =>
    expect(isAppOwnedPath(pathname)).toBe(false),
  );
});

it('returns a crawler-safe 406 response', async () => {
  const response = notAcceptableHtmlResponse();
  expect(response.status).toBe(406);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('vary')).toBe('Accept');
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  expect(await response.text()).toContain('text/markdown');
});
