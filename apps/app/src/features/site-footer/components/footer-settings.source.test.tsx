// @vitest-environment jsdom
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@/hooks/api';
import { projectQueryOptions } from '@/hooks/api/query-options';
import type { FooterConfig } from '../model/footer';
import { FooterSettings } from './footer-settings';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, translateFn: (key: string) => key }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@tanstack/react-router', () => ({ useBlocker: () => undefined }));
vi.mock('@/services/api-origin', () => ({ apiOrigin: () => 'http://dashboard.test' }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

/**
 * Which footer texts the server stores comes from the project query alone,
 * through the real queries and mutations. Behind `fetch`, a stand-in API keeps
 * each site's footer; a PATCH merges `config.footer` key by key (the real
 * validator and merge are covered by apps/server/src/actions/projects.test.ts).
 * A test can fail a site's reads, hold a PATCH's answer after it is stored, or
 * change a footer behind the form's back.
 */
type Site = 'site-1' | 'site-2';
let server: {
  footer: Record<Site, FooterConfig>;
  failReads: Set<Site>;
  hold?: Promise<void>;
  patches: Array<{ site: Site; footer: FooterConfig }>;
};
const project = (site: Site) => ({
  id: site,
  name: 'Handbook',
  slug: site,
  config: { seo: { metaTitle: 'Docs' }, footer: { ...server.footer[site] } },
});
const LANGUAGES = [
  { id: 'en', code: 'en', label: 'English', direction: 'LTR', isDefault: true, enabled: true, position: 0, config: null },
  { id: 'fr', code: 'fr', label: 'Français', direction: 'LTR', isDefault: false, enabled: true, position: 1, config: null },
];

function stubApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const [, , , , site, rest] = new URL(request.url).pathname.split('/') as [string, string, string, string, Site, string?];
      if (rest === 'languages') return Response.json({ data: LANGUAGES });
      if (request.method === 'GET') {
        return server.failReads.has(site)
          ? Response.json({ error: { message: 'offline' } }, { status: 503 })
          : Response.json({ data: project(site) });
      }
      const { config } = (await request.json()) as { config: { footer: FooterConfig } };
      server.patches.push({ site, footer: config.footer });
      server.footer[site] = { ...server.footer[site], ...config.footer };
      const answer = project(site);
      await server.hold;
      return Response.json({ data: answer });
    }),
  );
}

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let queryClient: QueryClient;
let showSite: (site: Site) => void;

/** The editor's Configuration canvas: the site from the project query, then the section. */
function Canvas() {
  const [site, setSite] = useState<Site>('site-1');
  showSite = setSite;
  const { data } = useQuery(projectQueryOptions(site));
  return data ? <FooterSettings project={data as Project} /> : null;
}

beforeEach(async () => {
  server = { footer: { 'site-1': {}, 'site-2': {} }, failReads: new Set(), patches: [] };
  stubApi();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <ConfirmProvider>
          <Canvas />
        </ConfirmProvider>
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => expect(container.querySelector('input')).not.toBeNull());
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

type Text = 'copyright' | 'github' | 'x' | 'linkedin';
const TEXT = { copyright: '© Handbook', github: 'https://github.com/handbook', x: 'https://x.com/handbook', linkedin: '/company/handbook' };
const input = (name: Text) => {
  const label = [...container.querySelectorAll('label')].find((el) => el.textContent === `settings.footer.${name}.label`);
  const control = label && document.getElementById(label.htmlFor);
  if (!(control instanceof HTMLInputElement)) throw new Error(`No control for ${name}`);
  return control;
};
const type = (name: Text, text: string) =>
  act(async () => {
    const el = input(name);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const buttonNamed = (name: string) => {
  const found = [...container.querySelectorAll('button')].find((button) => button.textContent?.trim().startsWith(name));
  if (!found) throw new Error(`No button named ${name}`);
  return found;
};
const region = () => container.querySelector('[data-slot="save-region"]');
/** Saves through the page's bar, and waits for the save (and its refetch) to settle. */
const save = async () => {
  const before = server.patches.length;
  await act(async () => buttonNamed('common.save').click());
  await vi.waitFor(() => expect(server.patches.length).toBe(before + 1));
  await vi.waitFor(() => expect(queryClient.isMutating()).toBe(0));
  await settle();
};
/** TanStack Query tells its observers on the next task: let that render. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const lastPatch = () => server.patches.at(-1);
const cachedFooter = (site: Site) => queryClient.getQueryData<Project>(projectQueryOptions(site).queryKey)?.config?.footer;
const chooseScope = (label: string) => act(async () => buttonNamed(label).click());
const read = async (site: Site = 'site-1') => {
  await act(() => queryClient.refetchQueries({ queryKey: projectQueryOptions(site).queryKey }));
  await settle();
};

describe('FooterSettings over the project query: which texts are stored', () => {
  it.each(['copyright', 'github', 'x', 'linkedin'] as const)(
    'a %s saved while the refetch fails is put in the cache, so clearing it next sends ""',
    async (key) => {
      server.failReads.add('site-1');
      await type(key, TEXT[key]);
      await save();
      expect(cachedFooter('site-1')?.[key]).toBe(TEXT[key]);
      expect(region()).toBeNull();

      await type(key, '');
      await save();
      expect(lastPatch()?.footer).toStrictEqual({ [key]: '', madeWithBadge: true });
      expect(server.footer['site-1'][key]).toBe('');
    },
  );

  it('P2a: a scope round trip after a failed refetch still clears what the save stored', async () => {
    server.failReads.add('site-1');
    await type('copyright', 'Stored');
    await save();
    await chooseScope('Français');
    await chooseScope('settings.chrome.scope.default');
    // The form starts again from the project query, which now holds what the save stored.
    expect.soft(input('copyright').value).toBe('Stored');
    await type('copyright', 'Typed');
    await type('copyright', '');
    await type('x', 'https://x.com/handbook');
    await save();
    expect(lastPatch()?.footer).toStrictEqual({ copyright: '', x: 'https://x.com/handbook', madeWithBadge: true });
    expect(server.footer['site-1'].copyright).toBe('');
  });

  it('P2b: a fresh read without a text the form saved before is authoritative: another field’s save leaves it out', async () => {
    await type('copyright', 'Stored');
    await save();
    // Someone else replaces the footer without a copyright, and a fresh read brings that.
    server.footer['site-1'] = {};
    await read();
    expect(input('copyright').value).toBe('');
    expect(region()).toBeNull();
    await type('x', 'https://x.com/handbook');
    await save();
    expect(lastPatch()?.footer).toStrictEqual({ x: 'https://x.com/handbook', madeWithBadge: true });
    expect('copyright' in (lastPatch()?.footer ?? {})).toBe(false);
  });

  it('a read that lands while the save runs, after its PATCH stored, stays the source over the save’s own answer', async () => {
    let release!: () => void;
    server.hold = new Promise((resolve) => {
      release = resolve;
    });
    await type('copyright', 'Mine');
    await act(async () => buttonNamed('common.save').click());
    await vi.waitFor(() => expect(server.patches).toHaveLength(1));
    // Stored by now; another writer adds a link, and a read brings both before the PATCH answers.
    server.footer['site-1'] = { ...server.footer['site-1'], x: 'https://x.com/theirs' };
    await read();
    server.failReads.add('site-1');
    await act(async () => release());
    await vi.waitFor(() => expect(queryClient.isMutating()).toBe(0));
    await settle();
    // The source keeps that read; the save's own answer (without the link) never replaces it.
    expect(cachedFooter('site-1')).toStrictEqual({ copyright: 'Mine', madeWithBadge: true, x: 'https://x.com/theirs' });
  });

  it('a read that landed before the save is older than it: a failed refetch leaves the save’s footer in the cache', async () => {
    server.footer['site-1'] = { github: TEXT.github };
    await read();
    server.failReads.add('site-1');
    await type('linkedin', TEXT.linkedin);
    await save();
    expect(cachedFooter('site-1')).toStrictEqual({ github: TEXT.github, linkedin: TEXT.linkedin, madeWithBadge: true });
  });

  it('a save that settles after a site switch writes only its own site; each site then saves from its own reads (A → B → A)', async () => {
    let release!: () => void;
    server.hold = new Promise((resolve) => {
      release = resolve;
    });
    server.failReads.add('site-1');
    await type('copyright', 'One');
    await act(async () => buttonNamed('common.save').click());
    await vi.waitFor(() => expect(server.patches).toHaveLength(1));
    await act(async () => showSite('site-2'));
    await vi.waitFor(() => expect(cachedFooter('site-2')).toStrictEqual({}));
    await settle();
    await act(async () => release());
    await vi.waitFor(() => expect(queryClient.isMutating()).toBe(0));
    expect(cachedFooter('site-2')).toStrictEqual({});
    await settle();
    expect(cachedFooter('site-1')).toStrictEqual({ copyright: 'One', madeWithBadge: true });

    // Site 2 never stored a copyright: its save leaves it out.
    expect(input('copyright').value).toBe('');
    await type('x', 'https://x.com/two');
    await save();
    expect(lastPatch()).toStrictEqual({ site: 'site-2', footer: { x: 'https://x.com/two', madeWithBadge: true } });

    // Back on site 1: the late save's footer is its source, so clearing the copyright sends "".
    await act(async () => showSite('site-1'));
    await vi.waitFor(() => expect(input('copyright').value).toBe('One'));
    await type('copyright', '');
    await save();
    expect(lastPatch()).toStrictEqual({ site: 'site-1', footer: { copyright: '', madeWithBadge: true } });
  });
});
