import { describe, expect, it } from 'vitest';
import { encodePublicRouteManifestResponse, encodePublicRouteManifestTemplates } from './public-route-manifest';

const PLACEHOLDER = '/sites/$projectId';
const ENCODED = '/sites/\\u0024projectId';

describe('public route manifest encoding', () => {
  it('hides the route template from crawlers without changing its JavaScript value', () => {
    const authored = `<code>${PLACEHOLDER}</code>`;
    const encoded = encodePublicRouteManifestTemplates(
      `${authored}<script class="$tsr" id="$tsr-stream-barrier">window.routes = { "${PLACEHOLDER}": {}, "${PLACEHOLDER}/": {} };</script>`,
    );

    expect(encoded).toContain(authored);
    expect(encoded.match(/\\u0024projectId/g)).toHaveLength(2);
    expect(Function(`return "${ENCODED}"`)()).toBe(PLACEHOLDER);
  });

  it('encodes placeholders split across streamed SSR chunks and preserves response metadata', async () => {
    const chunks = [
      `<!doctype html><code>${PLACEHOLDER}</code><scr`,
      'ipt nonce="proof" class="$tsr" id="$tsr-stream-',
      'barrier">window.routes={"/sites/',
      '$pro',
      'jectId":{}}</scr',
      'ipt><footer>safe</footer>',
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const response = encodePublicRouteManifestResponse(
      new Response(body, {
        status: 203,
        statusText: 'Non-Authoritative Information',
        headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': '80', etag: 'stale', 'x-proof': 'kept' },
      }),
    );

    const html = await response.text();
    expect(html).toContain(`<code>${PLACEHOLDER}</code>`);
    expect(html.split(PLACEHOLDER)).toHaveLength(2);
    expect(html).toContain(ENCODED);
    expect(response.status).toBe(203);
    expect(response.statusText).toBe('Non-Authoritative Information');
    expect(response.headers.get('x-proof')).toBe('kept');
    expect(response.headers.has('content-length')).toBe(false);
    expect(response.headers.has('etag')).toBe(false);
  });

  it('leaves non-HTML responses untouched', () => {
    const response = new Response(PLACEHOLDER, { headers: { 'content-type': 'application/xml' } });
    expect(encodePublicRouteManifestResponse(response)).toBe(response);
  });
});
