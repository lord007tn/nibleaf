/** Responses the edge serves when the Nibleaf origin cannot answer (a deploy,
 *  an outage, or an incomplete Worker configuration). Readers get a calm,
 *  self-contained page instead of the reverse proxy's raw "no available server"
 *  text; API callers get JSON. Nothing here is cacheable or indexable. */

const RETRY_AFTER_SECONDS = 30;

type Copy = { lang: 'en' | 'ar'; dir: 'ltr' | 'rtl'; title: string; heading: string; body: string; retry: string; note: string };

const COPY: Record<'en' | 'ar', Copy> = {
  en: {
    lang: 'en',
    dir: 'ltr',
    title: 'Temporarily unavailable',
    heading: 'This documentation is temporarily unavailable',
    body: 'We’re updating things behind the scenes. This page will try again automatically in a few seconds.',
    retry: 'Try again',
    note: 'If this keeps happening, please check back in a few minutes.',
  },
  ar: {
    lang: 'ar',
    dir: 'rtl',
    title: 'غير متاح مؤقتًا',
    heading: 'هذا التوثيق غير متاح مؤقتًا',
    body: 'نُجري بعض التحديثات في الخلفية. ستُعاد محاولة تحميل هذه الصفحة تلقائيًا خلال ثوانٍ.',
    retry: 'إعادة المحاولة',
    note: 'إذا استمر ذلك، يُرجى العودة بعد بضع دقائق.',
  },
};

/** Arabic when the reader asked for it (the site's `?lang=ar`, else their
 *  browser's first language); English otherwise. */
export const maintenanceLanguage = (request: Request): 'en' | 'ar' => {
  const url = new URL(request.url);
  const param = url.searchParams.get('lang')?.trim().toLowerCase();
  if (param) return param === 'ar' || param.startsWith('ar-') ? 'ar' : 'en';
  const first = (request.headers.get('accept-language') ?? '').split(',')[0]?.trim().toLowerCase() ?? '';
  return first === 'ar' || first.startsWith('ar-') || first.startsWith('ar;') ? 'ar' : 'en';
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);

/** True for a top-level page load that should get the HTML page rather than JSON. */
export const wantsHtml = (request: Request): boolean => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const { pathname } = new URL(request.url);
  if (pathname === '/api' || pathname.startsWith('/api/')) return false;
  if (request.headers.get('sec-fetch-dest') === 'document') return true;
  return (request.headers.get('accept') ?? '').includes('text/html');
};

const baseHeaders = (request: Request, reason: string): Record<string, string> => ({
  'cache-control': 'no-store',
  // The body depends on these request headers (HTML vs JSON, EN vs AR).
  vary: 'Accept, Accept-Language, Sec-Fetch-Dest',
  // Same policy the app sends; only meaningful (and only sent) over HTTPS.
  ...(new URL(request.url).protocol === 'https:' ? { 'strict-transport-security': 'max-age=63072000; includeSubDomains' } : {}),
  'retry-after': String(RETRY_AFTER_SECONDS),
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff',
  'x-nibleaf-edge': `unavailable; reason=${reason}`,
});

const maintenancePage = (request: Request, reason: string): Response => {
  const copy = COPY[maintenanceLanguage(request)];
  const host = escapeHtml(new URL(request.url).hostname);
  const html = `<!doctype html>
<html lang="${copy.lang}" dir="${copy.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta http-equiv="refresh" content="${RETRY_AFTER_SECONDS}">
<title>${copy.title} · ${host}</title>
<style>
:root{--bg:#fafafa;--fg:#18181b;--muted:#52525b;--card:#ffffff;--border:#e4e4e7;--accent:#18181b;--accent-fg:#fafafa;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#09090b;--fg:#fafafa;--muted:#a1a1aa;--card:#18181b;--border:#27272a;--accent:#fafafa;--accent-fg:#18181b}}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{display:flex;align-items:center;justify-content:center;padding:24px 16px;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Arabic","Noto Sans",sans-serif}
main{width:100%;max-width:480px;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:32px 28px;text-align:start}
.host{margin:0 0 20px;font-size:13px;color:var(--muted);overflow-wrap:anywhere}
h1{margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:650}
p{margin:0 0 16px;color:var(--muted)}
a.retry{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 20px;border-radius:10px;background:var(--accent);color:var(--accent-fg);font-weight:600;text-decoration:none}
a.retry:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.note{margin:20px 0 0;font-size:13px}
</style>
</head>
<body>
<main>
<p class="host">${host}</p>
<h1>${copy.heading}</h1>
<p>${copy.body}</p>
<a class="retry" href="">${copy.retry}</a>
<p class="note">${copy.note}</p>
</main>
</body>
</html>
`;
  return new Response(request.method === 'HEAD' ? null : html, {
    status: 503,
    headers: {
      ...baseHeaders(request, reason),
      'content-type': 'text/html; charset=utf-8',
      'content-language': copy.lang,
      // Self-contained page: inline styles only, no scripts, no remote fetches.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer',
    },
  });
};

const unavailableJson = (request: Request, reason: string): Response =>
  new Response(
    request.method === 'HEAD'
      ? null
      : JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Temporarily unavailable. Please retry shortly.' } }),
    { status: 503, headers: { ...baseHeaders(request, reason), 'content-type': 'application/json; charset=utf-8' } },
  );

export const unavailableResponse = (request: Request, reason: string): Response =>
  wantsHtml(request) ? maintenancePage(request, reason) : unavailableJson(request, reason);
