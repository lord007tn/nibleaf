import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { marketingHashResponse } from './marketing-csp.server';
import { encodePublicRouteManifestResponse } from './public-route-manifest';

describe('marketing hash CSP', () => {
  const source =
    '<!doctype html><html><head><script type="application/ld+json">{"name":"وثائق"}</script></head><body><script id="$tsr-stream-barrier">const route="/sites/$projectId";</script><script src="/app.js"></script></body></html>';
  const response = () => new Response(source, { headers: { 'content-type': 'text/html', vary: 'Accept-Encoding' } });

  it('hashes every actual inline script after manifest rewriting, without nonces', async () => {
    const result = await marketingHashResponse(encodePublicRouteManifestResponse(response()));
    const html = await result.text();
    const csp = result.headers.get('content-security-policy');
    expect(result.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=300');
    expect(result.headers.get('vary')).toBe('Accept-Encoding, Accept');
    expect(html).toContain('/sites/\\u0024projectId');
    for (const match of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      expect(csp).toContain(
        `'sha256-${createHash('sha256')
          .update(match[1] ?? '')
          .digest('base64')}'`,
      );
    }
    expect(csp).not.toContain('nonce-');
    expect(csp?.split(';').find((directive) => directive.trim().startsWith('script-src '))).not.toContain('unsafe-inline');
    expect(await (await marketingHashResponse(encodePublicRouteManifestResponse(response()))).text()).toBe(html);
  });

  it.each(['<meta property="csp-nonce" content="secret">', '<script nonce="secret">alert(1)</script>'])(
    'fails closed if a framework upgrade introduces nonce HTML: %s',
    async (html) => {
      await expect(marketingHashResponse(new Response(html))).rejects.toThrow('unexpectedly contains a nonce');
    },
  );

  it('does not share an error response or a response that sets cookies', async () => {
    for (const init of [{ status: 404 }, { headers: { 'set-cookie': 'session=fixture' } }]) {
      expect((await marketingHashResponse(new Response(source, init))).headers.get('cache-control')).toBe('private, no-store');
    }
  });
});
