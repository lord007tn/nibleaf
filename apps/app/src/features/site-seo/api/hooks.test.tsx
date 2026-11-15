// @vitest-environment jsdom
import { updateLanguageBody, updateProjectBody } from '@nibleaf/validators';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { languagesQueryOptions, projectQueryOptions } from '@/hooks/api/query-options';
import { seoValues } from '../model/seo';
import { useSaveSeo } from './hooks';

vi.mock('@/services/api-origin', () => ({ apiOrigin: () => 'http://dashboard.test' }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

/**
 * The API behind the real client. Each PATCH body is read off the wire and
 * checked by the route's own validator; what the server stores from it is the
 * server's business (`apps/server/src/actions/{projects,languages.writes}.test.ts`
 * run the real merges). Answers are fixed per test, and every call is logged.
 * `patched` answers the PATCH with a different entity than later reads (someone
 * else saved in between); `failReadsAfterPatch` makes the save's refetch fail.
 */
function fakeApi(answers: {
  project: unknown;
  language: unknown;
  patched?: { project?: unknown; language?: unknown };
  failReadsAfterPatch?: boolean;
}) {
  const log: string[] = [];
  const bodies: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      log.push(`${request.method} ${path}`);
      if (request.method === 'PATCH') {
        const body = await request.json();
        bodies.push(body);
        if (path.endsWith('/languages/ar')) {
          updateLanguageBody.parse(body);
          return Response.json({ data: answers.patched?.language ?? answers.language });
        }
        updateProjectBody.parse(body);
        return Response.json({ data: answers.patched?.project ?? answers.project });
      }
      if (answers.failReadsAfterPatch && bodies.length > 0) return Response.json({ error: { message: 'Unavailable' } }, { status: 503 });
      if (path === '/api/app/projects/site-1') return Response.json({ data: answers.project });
      if (path === '/api/app/projects/site-1/languages') return Response.json({ data: [answers.language] });
      if (path === '/api/app/projects/site-1/languages/ar') return Response.json({ data: answers.language });
      return Response.json({ error: { message: `Unexpected ${request.method} ${path}` } }, { status: 404 });
    }),
  );
  return { log, bodies };
}

let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

/** The SEO form's host: the project and language queries (which a save invalidates), and the save hook. */
async function mount() {
  const hook = {} as { save: ReturnType<typeof useSaveSeo>; loaded: () => boolean };
  function Probe() {
    hook.save = useSaveSeo('site-1');
    const project = useQuery(projectQueryOptions('site-1'));
    const languages = useQuery(languagesQueryOptions('site-1'));
    hook.loaded = () => Boolean(project.data && languages.data);
    return null;
  }
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root?.render(createElement(QueryClientProvider, { client }, createElement(Probe))));
  await act(() => vi.waitFor(() => expect(hook.loaded()).toBe(true)));
  return hook;
}

const BLANK = { metaTitle: '', metaDescription: '', socialImage: '', allowIndex: true };

describe('useSaveSeo over the real client', () => {
  it('confirms with the save’s own refetch when it is newer than the PATCH response (someone else saved in between)', async () => {
    const sent = { metaTitle: 'Sent', metaDescription: '', socialImage: '', allowIndex: true };
    const theirs = { ...sent, metaTitle: 'Theirs' };
    fakeApi({
      project: { id: 'site-1', config: { seo: theirs } },
      language: { id: 'ar', config: null },
      patched: { project: { id: 'site-1', config: { seo: sent } } },
    });
    const hook = await mount();
    let confirmed: unknown;
    await act(async () => {
      confirmed = await hook.save.saveProject({ ...sent, metaTitle: '  Sent  ' });
    });
    expect(confirmed).toStrictEqual(theirs);
  });

  it('does the same for a language: its refetched row, not the PATCH response', async () => {
    const sent = { metaTitle: 'توثيق', metaDescription: '', socialImage: '', allowIndex: true };
    const theirs = { ...sent, metaTitle: 'عنوانهم' };
    fakeApi({
      project: { id: 'site-1', config: {} },
      language: { id: 'ar', config: { seo: theirs } },
      patched: { language: { id: 'ar', config: { seo: sent } } },
    });
    const hook = await mount();
    let confirmed: unknown;
    await act(async () => {
      confirmed = await hook.save.saveLanguage('ar', sent);
    });
    expect(confirmed).toStrictEqual(theirs);
  });

  it.each(['project', 'language'] as const)(
    'falls back to the %s PATCH response when the refetch fails, never to the data from before the save',
    async (scope) => {
      const before = { metaTitle: 'Before', metaDescription: '', socialImage: '', allowIndex: true };
      const sent = { ...before, metaTitle: 'Sent' };
      fakeApi({
        project: { id: 'site-1', config: { seo: before } },
        language: { id: 'ar', config: { seo: before } },
        patched: { project: { id: 'site-1', config: { seo: sent } }, language: { id: 'ar', config: { seo: sent } } },
        failReadsAfterPatch: true,
      });
      const hook = await mount();
      let confirmed: unknown;
      await act(async () => {
        confirmed = scope === 'project' ? await hook.save.saveProject(sent) : await hook.save.saveLanguage('ar', sent);
      });
      expect(confirmed).toStrictEqual(sent);
    },
  );

  it('sends the project SEO with cleared text as "" and resolves the stored SEO after the refetch', async () => {
    const stored = { metaTitle: 'Docs', metaDescription: '', socialImage: '/og/cover.png', allowIndex: false };
    const api = fakeApi({ project: { id: 'site-1', config: { navbar: { ctaLabel: 'Start' }, seo: stored } }, language: { id: 'ar', config: null } });
    const hook = await mount();
    let confirmed: unknown;
    await act(async () => {
      confirmed = await hook.save.saveProject({ metaTitle: ' Docs ', metaDescription: '  ', socialImage: '/og/cover.png', allowIndex: false });
    });
    expect(api.bodies).toStrictEqual([{ config: { seo: stored } }]);
    expect(confirmed).toStrictEqual(seoValues(stored));
    // The mutation resolved only after its own refetch of the project.
    const patch = api.log.indexOf('PATCH /api/app/projects/site-1');
    expect(api.log.slice(patch + 1)).toContain('GET /api/app/projects/site-1');
  });

  it('sends a language with nothing to override as config: null, and reads the cleared SEO from the answer', async () => {
    // What the server answers after `config: null` on a language with a banner: SEO gone, the banner kept.
    const language = { id: 'ar', config: { banner: { message: 'إعلان' } } };
    const api = fakeApi({ project: { id: 'site-1', config: {} }, language });
    const hook = await mount();
    let confirmed: unknown;
    await act(async () => {
      confirmed = await hook.save.saveLanguage('ar', { ...BLANK, metaTitle: '   ' });
    });
    expect(api.bodies).toStrictEqual([{ config: null }]);
    expect(confirmed).toStrictEqual(BLANK);
    const patch = api.log.indexOf('PATCH /api/app/projects/site-1/languages/ar');
    expect(api.log.slice(patch + 1)).toContain('GET /api/app/projects/site-1/languages');
  });

  it('sends a language override as all four values and resolves what the server stored', async () => {
    const seo = { metaTitle: 'توثيق', metaDescription: '', socialImage: '', allowIndex: false };
    const api = fakeApi({ project: { id: 'site-1', config: {} }, language: { id: 'ar', config: { seo } } });
    const hook = await mount();
    let confirmed: unknown;
    await act(async () => {
      confirmed = await hook.save.saveLanguage('ar', { ...BLANK, metaTitle: 'توثيق ', allowIndex: false });
    });
    expect(api.bodies).toStrictEqual([{ config: { seo } }]);
    expect(confirmed).toStrictEqual(seo);
  });
});
