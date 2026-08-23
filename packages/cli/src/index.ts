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
  validate: (response: Response, body: string) => boolean,
): Promise<EndpointCheck> => {
  try {
    const response = await fetchImpl(url, { ...init, redirect: 'follow', signal: AbortSignal.timeout(10_000) });
    const body = await response.text();
    return {
      name,
      url: url.toString(),
      status: response.status,
      contentType: response.headers.get('content-type'),
      vary: response.headers.get('vary'),
      ok: validate(response, body),
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
    notFound: new URL('__nibleaf_cli_path_that_does_not_exist__', base),
  };

  const checks = await Promise.all([
    checkResponse('home', targets.home, fetchImpl, {}, (response) => response.ok),
    checkResponse('llms', targets.llms, fetchImpl, {}, (response, body) => response.status === 200 && body.trim().length > 0),
    checkResponse(
      'sitemap',
      targets.sitemap,
      fetchImpl,
      {},
      (response, body) => response.status === 200 && response.headers.get('content-type')?.includes('xml') === true && body.includes('<urlset'),
    ),
    checkResponse('openapi', targets.openapi, fetchImpl, {}, (response, body) => {
      if (response.status !== 200 || !response.headers.get('content-type')?.includes('application/json')) return false;
      try {
        return typeof (JSON.parse(body) as { openapi?: unknown }).openapi === 'string';
      } catch {
        return false;
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
