// @vitest-environment jsdom
import { updateLanguageBody, updateProjectBody } from '@nibleaf/validators';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectQueryOptions } from '@/hooks/api/query-options';
import { type BannerConfig, type BannerValues, projectBannerValues } from '../model/banner';
import { useSaveBanner } from './hooks';

vi.mock('@/services/api-origin', () => ({ apiOrigin: () => 'http://dashboard.test' }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const BANNER = { enabled: true, dismissible: false, message: 'Spring sale', linkLabel: 'See plans', linkUrl: 'https://example.com/pricing' };
const SIBLINGS = { navbar: { ctaLabel: 'Start' }, seo: { metaTitle: 'Docs' }, redirects: [{ from: '/old', to: '/new' }] };
const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The API behind the real client: each request body is read off the wire and
 * checked by the route's own validator. A project PATCH merges into the stored
 * config like the server's `mergeConfig` (an object section one level deep,
 * keeping any key the patch leaves out; `apps/server/src/actions/projects.test.ts`
 * runs the real one). Every request and answer is recorded.
 */
function fakeApi() {
  const server = {
    config: structuredClone({ ...SIBLINGS, banner: BANNER }) as Record<string, unknown>,
    language: { id: 'fr', code: 'fr', config: null as unknown },
    log: [] as { method: string; path: string; body?: unknown; answer: unknown }[],
  };
  const project = () => ({ id: 'site-1', config: structuredClone(server.config) });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      const body = request.method === 'PATCH' ? await request.json() : undefined;
      let answer: unknown;
      if (path === '/api/app/projects/site-1' && request.method === 'PATCH') {
        for (const [key, value] of Object.entries(updateProjectBody.parse(body).config ?? {})) {
          const stored = server.config[key];
          server.config[key] = isPlainObject(value) ? { ...(isPlainObject(stored) ? stored : {}), ...value } : value;
        }
        answer = project();
      } else if (path === '/api/app/projects/site-1') {
        answer = project();
      } else if (path === '/api/app/projects/site-1/languages/fr' && request.method === 'PATCH') {
        server.language = { ...server.language, config: updateLanguageBody.parse(body).config ?? null };
        answer = structuredClone(server.language);
      } else {
        return Response.json({ error: { message: `Unexpected ${request.method} ${path}` } }, { status: 404 });
      }
      server.log.push({ method: request.method, path, body, answer });
      return Response.json({ data: answer });
    }),
  );
  return server;
}

let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

/** The banner's host: the project from its query (which a save invalidates), and the save hook. */
async function mount(client: QueryClient) {
  const hook = {} as { save: ReturnType<typeof useSaveBanner>; banner: () => BannerConfig | undefined };
  function Probe() {
    hook.save = useSaveBanner('site-1');
    const { data } = useQuery(projectQueryOptions('site-1'));
    hook.banner = () => data?.config?.banner;
    return null;
  }
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(createElement(QueryClientProvider, { client }, createElement(Probe))));
  // The project's first load.
  await act(() => vi.waitFor(() => expect(hook.banner()).toBeDefined()));
  return hook;
}
const queryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('useSaveBanner over the real client', () => {
  let server: ReturnType<typeof fakeApi>;
  beforeEach(() => {
    server = fakeApi();
  });

  it.each(['message', 'linkLabel', 'linkUrl'] as const)(
    'a cleared %s reaches the server as "" and is gone after the refetch and a fresh load',
    async (key) => {
      const hook = await mount(queryClient());
      expect(hook.banner()).toEqual(BANNER);

      const draft: BannerValues = { ...projectBannerValues(BANNER), [key]: '  ' };
      let confirmed: BannerValues | undefined;
      await act(async () => {
        confirmed = await hook.save.saveProject(draft);
      });

      const cleared = { ...BANNER, [key]: '' };
      const patch = server.log.find((entry) => entry.method === 'PATCH');
      expect(patch?.body).toStrictEqual({ config: { banner: cleared } });
      expect(confirmed).toStrictEqual(cleared);
      expect(server.config).toStrictEqual({ ...SIBLINGS, banner: cleared });
      // The save's invalidation refetched the project, and that refetch has the cleared text.
      const calls = server.log.map((entry) => `${entry.method} ${entry.path}`);
      expect(calls.slice(0, 2)).toEqual(['GET /api/app/projects/site-1', 'PATCH /api/app/projects/site-1']);
      expect(calls.slice(2)).toContain('GET /api/app/projects/site-1');
      expect(server.log.at(-1)?.answer).toMatchObject({ config: { banner: cleared } });
      expect(hook.banner()).toStrictEqual(cleared);

      await act(async () => root?.unmount());
      const reopened = await mount(queryClient());
      expect(reopened.banner()).toStrictEqual(cleared);
    },
  );

  it('keeps a language override free of blank text, and clears it to null to inherit the project', async () => {
    const hook = await mount(queryClient());
    const french = { enabled: true, dismissible: false, message: 'Soldes', linkLabel: '   ', linkUrl: '' };
    await act(async () => {
      await hook.save.saveLanguage('fr', french, BANNER);
    });
    expect(server.log.at(-1)?.body).toStrictEqual({ config: { banner: { message: 'Soldes' } } });

    await act(async () => {
      await hook.save.saveLanguage('fr', { ...french, message: ' ' }, BANNER);
    });
    expect(server.log.at(-1)?.body).toStrictEqual({ config: { banner: null } });
    expect(server.config.banner).toStrictEqual(BANNER);
  });
});
