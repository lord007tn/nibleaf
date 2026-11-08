import { describe, expect, it, vi } from 'vitest';
import { fetchMarkdown, inspectSite } from './index';

const responseFor = (url: string, accept: string | null) => {
  if (url.endsWith('nibleaf-cli-path-that-does-not-exist')) {
    return new Response('# 404\n\nSee llms.txt', { status: 404, headers: { 'content-type': 'text/markdown; charset=utf-8', vary: 'Accept' } });
  }
  if (url.endsWith('llms.txt')) return new Response('# Nibleaf', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  if (url.endsWith('sitemap.xml')) return new Response('<urlset></urlset>', { headers: { 'content-type': 'application/xml' } });
  if (url.endsWith('openapi.json')) return Response.json({ openapi: '3.1.0', info: { title: 'Nibleaf', version: '1' }, paths: {} });
  if (accept === 'text/markdown')
    return new Response('# Nibleaf', { headers: { 'content-type': 'text/markdown; charset=utf-8', vary: 'Accept-Encoding, Accept' } });
  return new Response('<h1>Nibleaf</h1>', { headers: { 'content-type': 'text/html' } });
};

describe('inspectSite', () => {
  const inspectEndpoint = async (endpoint: string, response: () => Response) => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = input.toString();
      return url.endsWith(endpoint) ? response() : responseFor(url, new Headers(init?.headers).get('accept'));
    });
    return inspectSite('https://nibleaf.com', { fetchImpl });
  };

  it.each([
    ['HTML content type', '<h1>Sign in</h1>', 'text/html'],
    ['mixed-case HTML content type', '<h1>Sign in</h1>', 'Text/HTML'],
    ['disguised HTML', '<!doctype html><html>Login</html>', 'text/plain'],
    ['comment-prefixed HTML', '<!-- gateway -->\n<!doctype html><html>Login</html>', 'text/plain'],
    ['login fragment', '<div><h1>Sign in</h1><input type="password"></div>', 'text/plain'],
    ['empty text', '  \n ', 'text/plain'],
  ])('rejects llms.txt with %s and explains the failure', async (_label, body, type) => {
    const result = await inspectEndpoint('llms.txt', () => new Response(body, { headers: { 'content-type': type } }));
    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.name === 'llms')).toMatchObject({ ok: false, error: expect.stringContaining('llms.txt') });
  });

  it.each(['# Nibleaf\n\nPublic documentation.', '# نيبليف\n\nوثائق عامة باللغة العربية.', '# HTML guide\n\nExample: `<form>`'])(
    'accepts UTF-8 llms text: %s',
    async (body) => {
      expect((await inspectEndpoint('llms.txt', () => new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } }))).ok).toBe(
        true,
      );
    },
  );

  it.each([
    { openapi: 'anything', info: { title: 'API', version: '1' }, paths: {} },
    { openapi: ['3.1.0'], info: { title: 'API', version: '1' }, paths: {} },
    { openapi: '2.0.0', info: { title: 'API', version: '1' }, paths: {} },
    { openapi: '3.1.0' },
    { openapi: '3.1.0', info: { title: '', version: '1' }, paths: {} },
    { openapi: '3.1.0', info: { title: 'API', version: '1' }, paths: [] },
    null,
  ])('rejects unusable OpenAPI document %j', async (document) => {
    const result = await inspectEndpoint('openapi.json', () => Response.json(document));
    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.name === 'openapi')?.error).toContain('openapi.json');
  });

  it('rejects malformed OpenAPI JSON with a useful diagnostic', async () => {
    const result = await inspectEndpoint('openapi.json', () => new Response('{', { headers: { 'content-type': 'application/json' } }));
    expect(result.checks.find((check) => check.name === 'openapi')).toMatchObject({ ok: false, error: expect.stringContaining('malformed JSON') });
  });

  it.each(['3.0.3', '3.1.0'])('supports OpenAPI %s', async (openapi) => {
    const result = await inspectEndpoint('openapi.json', () => Response.json({ openapi, info: { title: 'API', version: '1' }, paths: {} }));
    expect(result.ok).toBe(true);
  });

  it('checks every agent entry point and real Markdown 404 behavior', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      return responseFor(url, new Headers(init?.headers).get('accept'));
    });

    const result = await inspectSite('https://nibleaf.com', { fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.checks.map((check) => check.name)).toEqual(['home', 'llms', 'sitemap', 'openapi', 'markdown', 'notFound']);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it('fails when Markdown can be cache-confused', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      const response = responseFor(url, new Headers(init?.headers).get('accept'));
      if (new Headers(init?.headers).get('accept') === 'text/markdown' && !url.endsWith('nibleaf-cli-path-that-does-not-exist')) {
        response.headers.delete('vary');
      }
      return response;
    });

    const result = await inspectSite('https://nibleaf.com', { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.name === 'markdown')?.ok).toBe(false);
  });
});

it('fetches canonical pages as Markdown', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response('# Page', { headers: { 'content-type': 'text/markdown; charset=utf-8' } }));
  const response = await fetchMarkdown('https://nibleaf.com/developers', fetchImpl);
  expect(await response.text()).toBe('# Page');
  expect(fetchImpl).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ headers: { Accept: 'text/markdown' } }));
});
