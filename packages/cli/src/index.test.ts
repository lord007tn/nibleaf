import { describe, expect, it, vi } from 'vitest';
import { fetchMarkdown, inspectSite } from './index';

const responseFor = (url: string, accept: string | null): Response => {
  if (url.endsWith('__nibleaf_cli_path_that_does_not_exist__')) {
    return new Response('# 404\n\nSee llms.txt', { status: 404, headers: { 'content-type': 'text/markdown; charset=utf-8', vary: 'Accept' } });
  }
  if (url.endsWith('llms.txt')) return new Response('# Nibleaf', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  if (url.endsWith('sitemap.xml')) return new Response('<urlset></urlset>', { headers: { 'content-type': 'application/xml' } });
  if (url.endsWith('openapi.json')) return Response.json({ openapi: '3.1.0' });
  if (accept === 'text/markdown')
    return new Response('# Nibleaf', { headers: { 'content-type': 'text/markdown; charset=utf-8', vary: 'Accept-Encoding, Accept' } });
  return new Response('<h1>Nibleaf</h1>', { headers: { 'content-type': 'text/html' } });
};

describe('inspectSite', () => {
  it('checks every agent entry point and real Markdown 404 behavior', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      return responseFor(url, new Headers(init?.headers).get('accept'));
    }) as unknown as typeof fetch;

    const result = await inspectSite('https://nibleaf.com', { fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.checks.map((check) => check.name)).toEqual(['home', 'llms', 'sitemap', 'openapi', 'markdown', 'notFound']);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it('fails when Markdown can be cache-confused', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      const response = responseFor(url, new Headers(init?.headers).get('accept'));
      if (new Headers(init?.headers).get('accept') === 'text/markdown' && !url.endsWith('__nibleaf_cli_path_that_does_not_exist__')) {
        response.headers.delete('vary');
      }
      return response;
    }) as unknown as typeof fetch;

    const result = await inspectSite('https://nibleaf.com', { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.name === 'markdown')?.ok).toBe(false);
  });
});

it('fetches canonical pages as Markdown', async () => {
  const fetchImpl = vi.fn(
    async () => new Response('# Page', { headers: { 'content-type': 'text/markdown; charset=utf-8' } }),
  ) as unknown as typeof fetch;
  const response = await fetchMarkdown('https://nibleaf.com/developers', fetchImpl);
  expect(await response.text()).toBe('# Page');
  expect(fetchImpl).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ headers: { Accept: 'text/markdown' } }));
});
