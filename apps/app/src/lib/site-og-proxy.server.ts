import got from 'got';

/** Binary proxy: preserve the public-only API policy and never cache an error. */
export const proxySiteOg = async (
  apiBase: string,
  projectId: string,
  suffix: string,
  request: Request,
  headers: Record<string, string>,
): Promise<Response> => {
  try {
    const query = new URLSearchParams();
    const language = new URL(request.url).searchParams.get('lang');
    if (language) query.set('lang', language);
    const conditional = request.headers.get('if-none-match');
    const upstream = await got(`${apiBase}/api/public/sites/${encodeURIComponent(projectId)}/og/${suffix}?${query}`, {
      headers: { ...headers, ...(conditional ? { 'if-none-match': conditional } : {}) },
      responseType: 'buffer',
      retry: { limit: 0 },
      timeout: { request: 10_000 },
      throwHttpErrors: false,
    });
    const publicImage = upstream.statusCode === 200 || upstream.statusCode === 304;
    const result = new Headers({
      'content-type': 'image/png',
      'cache-control': // Revalidate every use (see apps/server/src/modules/public/sites/og.ts).
      publicImage ? 'public, no-cache, must-revalidate' : 'private, no-store',
      'x-content-type-options': 'nosniff',
    });
    for (const name of ['etag', 'retry-after']) {
      const value = upstream.headers[name];
      if (typeof value === 'string') result.set(name, value);
    }
    return new Response(request.method === 'HEAD' || upstream.statusCode !== 200 ? null : new Uint8Array(upstream.body), {
      status: upstream.statusCode,
      headers: result,
    });
  } catch {
    return new Response(null, { status: 503, headers: { 'cache-control': 'private, no-store' } });
  }
};
