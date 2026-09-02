export type DocumentRepresentation = 'text/html' | 'application/xhtml+xml' | 'text/markdown';

interface AcceptEntry {
  type: string;
  subtype: string;
  q: number;
  specificity: number;
  order: number;
}

const parseAccept = (accept: string): AcceptEntry[] =>
  accept
    .split(',')
    .map((raw, order) => {
      const [rawMediaType, ...parameters] = raw.split(';');
      const [type = '', subtype = ''] = rawMediaType?.trim().toLowerCase().split('/') ?? [];
      if (!(type && subtype) || (type === '*' && subtype !== '*')) return null;

      const quality = parameters.map((parameter) => parameter.trim().toLowerCase()).find((parameter) => parameter.startsWith('q='));
      const q = quality ? Number(quality.slice(2)) : 1;
      if (!Number.isFinite(q) || q < 0 || q > 1) return null;

      return {
        type,
        subtype,
        q,
        specificity: type === '*' ? 0 : subtype === '*' ? 1 : 2,
        order,
      } satisfies AcceptEntry;
    })
    .filter((entry): entry is AcceptEntry => entry !== null);

const matchFor = (entries: AcceptEntry[], representation: DocumentRepresentation) => {
  const [type, subtype] = representation.split('/');
  return entries
    .filter((entry) => (entry.type === '*' || entry.type === type) && (entry.subtype === '*' || entry.subtype === subtype))
    .sort((left, right) => right.specificity - left.specificity || right.q - left.q || left.order - right.order)[0];
};

/** RFC 9110-style proactive negotiation for the two document representations
 * Nibleaf can produce. A specific q=0 rejection wins over a permissive wildcard;
 * candidate ties follow client order, then the server's offered order. */
export function preferredRepresentation(
  accept: string | null,
  offered: readonly DocumentRepresentation[] = ['text/html', 'text/markdown'],
): DocumentRepresentation | null {
  if (!accept?.trim()) return offered[0] ?? null;
  const entries = parseAccept(accept);
  const candidates = offered
    .map((representation, serverOrder) => ({ representation, serverOrder, match: matchFor(entries, representation) }))
    .filter((candidate): candidate is typeof candidate & { match: AcceptEntry } => Boolean(candidate.match) && (candidate.match?.q ?? 0) > 0)
    .sort(
      (left, right) =>
        right.match.q - left.match.q ||
        right.match.specificity - left.match.specificity ||
        left.match.order - right.match.order ||
        left.serverOrder - right.serverOrder,
    );
  return candidates[0]?.representation ?? null;
}

/** Whether an HTTP Accept header permits an HTML document response. */
export function acceptsHtml(accept: string | null): boolean {
  return preferredRepresentation(accept, ['text/html', 'application/xhtml+xml']) !== null;
}

/** Append a field name to Vary without dropping values set by the framework. */
export function appendVary(headers: Headers, field: string): void {
  const values = (headers.get('vary') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values.some((value) => value.toLowerCase() === field.toLowerCase())) values.push(field);
  headers.set('vary', values.join(', '));
}

/** Ask the application renderer for its native HTML representation before
 * converting that representation to Markdown. HEAD must render as GET so the
 * converter can calculate the same response headers without returning a body. */
export function asHtmlRenderRequest(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.set('Accept', 'text/html');
  // Nitro's request implementation is Fetch-compatible but is not always an
  // Undici Request instance, so clone from the URL and explicit fields.
  return new Request(request.url, {
    headers,
    method: request.method === 'HEAD' ? 'GET' : request.method,
  });
}

/** Paths without a file extension are handled as browser documents. */
export function isDocumentPath(pathname: string): boolean {
  if (/^\/(?:api|assets)(?:\/|$)/.test(pathname) || pathname.startsWith('/_')) {
    return false;
  }
  const lastSegment = pathname.split('/').pop() ?? '';
  return !/\.[a-z0-9]{1,12}$/i.test(lastSegment);
}

/** Paths owned by the application runtime must never be rewritten beneath a
 * published site's custom-domain route. In particular, TanStack server
 * functions use `/_serverFn/*`; `_` and the following letter are both regex
 * word characters, so a shared trailing `\b` does not match that prefix. */
export function isAppOwnedPath(pathname: string): boolean {
  return /^\/(?:(?:api|assets|favicon|sites)\b|_)/.test(pathname);
}

export function notAcceptableHtmlResponse(): Response {
  const response = new Response('Not Acceptable\n\nAvailable representations: text/html, text/markdown.\n', {
    status: 406,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
  appendVary(response.headers, 'Accept');
  return response;
}
