import { describe, expect, it } from 'vitest';
import { agentFriendlyNotFoundMarkdown, marketingHtmlToMarkdown, marketingMarkdownResponse } from './marketing-markdown';

describe('marketingHtmlToMarkdown', () => {
  it('keeps main content, converts links, and removes page chrome and scripts', () => {
    const markdown = marketingHtmlToMarkdown(
      '<html><body><header>Navigation</header><main><h1>Nibleaf developers</h1><p>Use the <a href="/openapi.json">API schema</a>.</p><script>secret()</script></main><footer>Footer</footer></body></html>',
      'https://nibleaf.com/developers',
    );

    expect(markdown).toContain('# Nibleaf developers');
    expect(markdown).toContain('[API schema](https://nibleaf.com/openapi.json)');
    expect(markdown).not.toContain('Navigation');
    expect(markdown).not.toContain('secret');
    expect(markdown).not.toContain('Footer');
  });

  it('serializes server-rendered tables as GitHub-flavored Markdown', () => {
    const markdown = marketingHtmlToMarkdown(
      '<main><table><thead><tr><th>Capability</th><th>Status</th></tr></thead><tbody><tr><td>SDK \\ path | Arabic RTL</td><td>Supported</td></tr></tbody></table></main>',
      'https://nibleaf.com/compare',
    );
    expect(markdown).toContain('| Capability | Status |');
    expect(markdown).toContain('| --- | --- |');
    expect(markdown).toContain(String.raw`| SDK \\ path \| Arabic RTL | Supported |`);
  });
});

it('serves negotiated Markdown with cache-safe headers', async () => {
  const response = await marketingMarkdownResponse(
    new Response('<main><h1>Nibleaf</h1></main>', { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    'https://nibleaf.com/',
  );

  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
  expect(response.headers.get('vary')).toBe('Accept');
  expect(response.headers.get('cache-control')).toContain('s-maxage=300');
  expect(await response.text()).toBe('# Nibleaf\n');
});

it('returns a recoverable Markdown 404', async () => {
  const response = agentFriendlyNotFoundMarkdown('https://nibleaf.com');
  expect(response.status).toBe(404);
  expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
  expect(response.headers.get('vary')).toBe('Accept');
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  expect(await response.text()).toContain('https://nibleaf.com/llms.txt');
});
