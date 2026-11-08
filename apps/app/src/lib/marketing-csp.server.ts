import { createHash } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { contentSecurityPolicy } from './content-security-policy';
import { appendVary } from './request-negotiation';

/** Call only after the route-manifest rewrite, on completed anonymous marketing
 * HTML. Hash the actual script text parsed by the browser, including JSON-LD. */
export async function marketingHashResponse(response: Response): Promise<Response> {
  const html = await response.text();
  const { document } = parseHTML(html);
  if (document.querySelector('meta[property="csp-nonce"], script[nonce]')) {
    throw new Error('Marketing HTML unexpectedly contains a nonce; refusing shared caching.');
  }
  const hashes = [
    ...new Set(
      Array.from(
        document.querySelectorAll('script:not([src])'),
        (script) =>
          `'sha256-${createHash('sha256')
            .update(script.textContent ?? '', 'utf8')
            .digest('base64')}'`,
      ),
    ),
  ].sort();
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', contentSecurityPolicy(hashes));
  headers.set('cache-control', response.status === 200 && !headers.has('set-cookie') ? 'public, max-age=60, s-maxage=300' : 'private, no-store');
  appendVary(headers, 'Accept');
  headers.delete('content-length');
  headers.delete('etag');
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}
