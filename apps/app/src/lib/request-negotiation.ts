const HTML_MEDIA_TYPES = new Set(['text/html', 'application/xhtml+xml', 'text/*', 'application/*', '*/*']);

/** Whether an HTTP Accept header permits an HTML document response. */
export function acceptsHtml(accept: string | null): boolean {
  if (!accept?.trim()) {
    return true;
  }

  return accept.split(',').some((part) => {
    const [rawType, ...parameters] = part.split(';');
    const type = rawType?.trim().toLowerCase() ?? '';
    const quality = parameters.map((parameter) => parameter.trim().toLowerCase()).find((parameter) => parameter.startsWith('q='));
    const q = quality ? Number(quality.slice(2)) : 1;
    return Number.isFinite(q) && q > 0 && HTML_MEDIA_TYPES.has(type);
  });
}

/** Paths without a file extension are handled as browser documents. */
export function isDocumentPath(pathname: string): boolean {
  if (/^\/(?:api|assets|_)\b/.test(pathname)) {
    return false;
  }
  const lastSegment = pathname.split('/').pop() ?? '';
  return !/\.[a-z0-9]{1,12}$/i.test(lastSegment);
}

export function notAcceptableHtmlResponse(): Response {
  return new Response('This route is available as HTML. Request text/html or use llms.txt for Markdown content.\n', {
    status: 406,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}
