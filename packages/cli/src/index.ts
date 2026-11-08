export const CLI_VERSION = '0.1.0';

export interface EndpointCheck {
  name: 'home' | 'llms' | 'sitemap' | 'openapi' | 'markdown' | 'notFound';
  url: string;
  status: number | null;
  contentType: string | null;
  vary: string | null;
  ok: boolean;
  error?: string;
}

export interface SiteInspection {
  baseUrl: string;
  ok: boolean;
  checks: EndpointCheck[];
}

export interface InspectOptions {
  fetchImpl?: typeof fetch;
}

const normalizeBaseUrl = (input: string): URL => {
  const url = new URL(input);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('The site URL must use http or https.');
  url.hash = '';
  url.search = '';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url;
};

const hasVaryAccept = (value: string | null): boolean =>
  Boolean(
    value
      ?.split(',')
      .map((field) => field.trim().toLowerCase())
      .includes('accept'),
  );

const checkResponse = async (
  name: EndpointCheck['name'],
  url: URL,
  fetchImpl: typeof fetch,
  init: RequestInit,
  validate: (response: Response, body: string) => boolean | string,
): Promise<EndpointCheck> => {
  try {
    const response = await fetchImpl(url, { ...init, redirect: 'follow', signal: AbortSignal.timeout(10_000) });
    const body = await response.text();
    const result = validate(response, body);
    return {
      name,
      url: url.toString(),
      status: response.status,
      contentType: response.headers.get('content-type'),
      vary: response.headers.get('vary'),
      ok: result === true,
      ...(typeof result === 'string' ? { error: result } : {}),
    };
  } catch (error) {
    return {
      name,
      url: url.toString(),
      status: null,
      contentType: null,
      vary: null,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export async function inspectSite(input: string, options: InspectOptions = {}): Promise<SiteInspection> {
  const base = normalizeBaseUrl(input);
  const fetchImpl = options.fetchImpl ?? fetch;
  const targets = {
    home: new URL('.', base),
    llms: new URL('llms.txt', base),
    sitemap: new URL('sitemap.xml', base),
    openapi: new URL('openapi.json', base),
    notFound: new URL('nibleaf-cli-path-that-does-not-exist', base),
  };

  const checks = await Promise.all([
    checkResponse('home', targets.home, fetchImpl, {}, (response) => response.ok),
    checkResponse('llms', targets.llms, fetchImpl, {}, (response, body) => {
      if (response.status !== 200) return 'llms.txt must return HTTP 200.';
      if (!body.trim()) return 'llms.txt must contain nonempty UTF-8 text.';
      if (
        /(?:text\/html|application\/xhtml\+xml)/i.test(response.headers.get('content-type') ?? '') ||
        /^\s*<(?:!doctype\s+html|html|head|body|form)\b/i.test(body)
      ) {
        return 'llms.txt returned HTML, possibly a sign-in page; serve plain text or Markdown.';
      }
      return true;
    }),
    checkResponse(
      'sitemap',
      targets.sitemap,
      fetchImpl,
      {},
      (response, body) => response.status === 200 && response.headers.get('content-type')?.includes('xml') === true && body.includes('<urlset'),
    ),
    checkResponse('openapi', targets.openapi, fetchImpl, {}, (response, body) => {
      if (response.status !== 200 || !response.headers.get('content-type')?.includes('application/json')) {
        return 'openapi.json must return HTTP 200 with application/json.';
      }
      try {
        const document = JSON.parse(body) as Record<string, unknown> | null;
        if (!document || typeof document !== 'object' || typeof document.openapi !== 'string' || !/^3\.(?:0|1)\.\d+$/.test(document.openapi)) {
          return 'openapi.json must declare a supported OpenAPI 3.0.x or 3.1.x version.';
        }
        const info = document.info as Record<string, unknown> | null;
        if (
          !info ||
          typeof info.title !== 'string' ||
          !info.title.trim() ||
          typeof info.version !== 'string' ||
          !info.version.trim() ||
          !document.paths ||
          typeof document.paths !== 'object' ||
          Array.isArray(document.paths)
        ) {
          return 'openapi.json requires info.title, info.version and a paths object.';
        }
        return true;
      } catch {
        return 'openapi.json contains malformed JSON.';
      }
    }),
    checkResponse(
      'markdown',
      targets.home,
      fetchImpl,
      { headers: { Accept: 'text/markdown' } },
      (response) =>
        response.status === 200 &&
        response.headers.get('content-type')?.startsWith('text/markdown') === true &&
        hasVaryAccept(response.headers.get('vary')),
    ),
    checkResponse(
      'notFound',
      targets.notFound,
      fetchImpl,
      { headers: { Accept: 'text/markdown' } },
      (response, body) =>
        response.status === 404 && response.headers.get('content-type')?.startsWith('text/markdown') === true && body.includes('llms.txt'),
    ),
  ]);

  return { baseUrl: targets.home.toString(), ok: checks.every((check) => check.ok), checks };
}

export async function fetchMarkdown(input: string, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const url = new URL(input);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('The page URL must use http or https.');
  return fetchImpl(url, {
    headers: { Accept: 'text/markdown' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  });
}
