/**
 * The dashboard reaches the API through a server-side proxy built on Node's
 * fetch, which stamps every forwarded request with `Sec-Fetch-Mode: cors`.
 * Better Auth uses that header to tell a browser `fetch()` (answer with JSON)
 * from a top-level navigation (answer with a redirect), so a person opening an
 * OAuth authorize link from an MCP client would see a JSON body instead of the
 * sign-in page.
 *
 * `Sec-Fetch-Dest` survives the proxy and is `document` (or `iframe`) only for
 * navigations; a browser `fetch()` sends `empty`, and page scripts cannot set
 * `Sec-*` headers. For those GET requests, restore `Sec-Fetch-Mode: navigate`.
 */
export const restoreNavigationFetchMetadata = (request: Request): Request => {
  if (request.method !== 'GET') return request;
  const dest = request.headers.get('sec-fetch-dest');
  if (dest !== 'document' && dest !== 'iframe') return request;
  if (request.headers.get('sec-fetch-mode') === 'navigate') return request;
  const headers = new Headers(request.headers);
  headers.set('sec-fetch-mode', 'navigate');
  return new Request(request, { headers });
};
