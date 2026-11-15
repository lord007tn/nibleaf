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
 * The project save sends only the footer keys the person changed, through the
 * real queries and mutations. Behind `fetch`, a stand-in API keeps each site's
 * footer; a PATCH merges `config.footer` key by key, as the real merge does
 * (apps/server/src/actions/projects.test.ts runs that one). A test can fail a
 * site's reads, hold a read's or a PATCH's answer after it is taken, or have
 * another writer change a footer.
 */
type Site = 'site-1' | 'site-2';
let server: {
  footer: Record<Site, FooterConfig>;
  failReads: Set<Site>;
  holdPatch?: Promise<void>;
  holdRead?: Promise<void>;
  reads: number;
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
        server.reads += 1;
        if (server.failReads.has(site)) return Response.json({ error: { message: 'offline' } }, { status: 503 });
        const answer = project(site);
        await server.holdRead;
        return Response.json({ data: answer });
      }
      const { config } = (await request.json()) as { config: { footer: FooterConfig } };
      server.patches.push({ site, footer: config.footer });
      server.footer[site] = { ...server.footer[site], ...config.footer };
      const answer = project(site);
      await server.holdPatch;
      return Response.json({ data: answer });
    }),
  );
}

const gate = () => {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open: () => act(async () => open()) };
};

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let queryClient: QueryClient;
let showSite: (site: Site) => void;
let mounted: (on: boolean) => void;

/** The editor's Configuration canvas: the site from the project query, then the section (which can be closed and reopened). */
function Canvas() {
  const [site, setSite] = useState<Site>('site-1');
  const [open, setOpen] = useState(true);
  showSite = setSite;
  mounted = setOpen;
  return open ? <Section site={site} /> : null;
}
function Section({ site }: { site: Site }) {
  const { data } = useQuery(projectQueryOptions(site));
  return data ? <FooterSettings project={data as Project} /> : null;
}

const STORED = { copyright: '© Handbook', github: 'https://github.com/handbook', x: 'https://x.com/handbook', linkedin: '/company/handbook' };

async function open(footer: FooterConfig = {}) {
  server.footer['site-1'] = footer;
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
  await settle();
}

beforeEach(() => {
  server = { footer: { 'site-1': {}, 'site-2': {} }, failReads: new Set(), reads: 0, patches: [] };
  stubApi();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 }, mutations: { retry: false } } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

type Text = 'copyright' | 'github' | 'x' | 'linkedin';
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
const click = (name: string) => act(async () => buttonNamed(name).click());
const region = () => container.querySelector('[data-slot="save-region"]');
const conflict = () => container.textContent?.includes('forms.changedElsewhere');
/** TanStack Query tells its observers on the next task: let that render. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
/** Starts a save through the page's bar and waits until its PATCH reached the server. */
const startSave = async () => {
  const before = server.patches.length;
  await click('common.save');
  await vi.waitFor(() => expect(server.patches.length).toBe(before + 1));
};
const finished = async () => {
  await vi.waitFor(() => expect(queryClient.isMutating()).toBe(0));
  await settle();
};
const save = async () => {
  await startSave();
  await finished();
};
const lastPatch = () => server.patches.at(-1);
const read = async (site: Site = 'site-1') => {
  await act(() => queryClient.refetchQueries({ queryKey: projectQueryOptions(site).queryKey }));
  await settle();
};

describe('FooterSettings over the project query: a save sends only what changed', () => {
  it.each(['copyright', 'github', 'x', 'linkedin'] as const)('clearing a stored %s sends "" for it alone; the server keeps the rest', async (key) => {
    await open({ ...STORED });
    await type(key, '');
    await save();
    expect(lastPatch()?.footer).toStrictEqual({ [key]: '' });
    expect(server.footer['site-1']).toStrictEqual({ ...STORED, [key]: '' });
    expect(region()).toBeNull();
  });

  it("finding 1: another writer's link that a read brings during the save survives a LinkedIn-only save after the refetch failed", async () => {
    await open({ copyright: '© Old' });
    const patch = gate();
    server.holdPatch = patch.promise;
    await type('copyright', '© New');
    await startSave();
    // Another writer adds X; a read brings it while the PATCH's answer is still on its way.
    server.footer['site-1'] = { ...server.footer['site-1'], x: 'https://x.com/theirs' };
    await read();
    server.failReads.add('site-1');
    await patch.open();
    await finished();
    await type('linkedin', '/company/handbook');
    await save();
    expect(lastPatch()?.footer).toStrictEqual({ linkedin: '/company/handbook' });
    expect(server.footer['site-1']).toStrictEqual({ copyright: '© New', x: 'https://x.com/theirs', linkedin: '/company/handbook' });
  });

  it('a text saved while the refetch fails shows as saved, and clearing it next sends ""', async () => {
    await open();
    server.failReads.add('site-1');
    await type('copyright', 'Stored');
    await save();
    expect(input('copyright').value).toBe('Stored');
    expect(queryClient.getQueryState(projectQueryOptions('site-1').queryKey)?.isInvalidated).toBe(true);
    await type('copyright', '');
    await save();
    expect(lastPatch()?.footer).toStrictEqual({ copyright: '' });
    expect(server.footer['site-1'].copyright).toBe('');
  });

  it('a read that started before the PATCH and lands after it stored, then a failed refetch: the clear still sends ""', async () => {
    await open();
    const oldRead = gate();
    server.holdRead = oldRead.promise;
    const reading = act(() => queryClient.refetchQueries({ queryKey: projectQueryOptions('site-1').queryKey }));
    await vi.waitFor(() => expect(server.reads).toBe(2));
    server.holdRead = undefined;
    const patch = gate();
    server.holdPatch = patch.promise;
    await type('copyright', 'Stored');
    await startSave();
    await oldRead.open();
    await reading;
    server.failReads.add('site-1');
    await patch.open();
    await finished();
    expect(input('copyright').value).toBe('Stored');
    await type('copyright', '');
    await save();
    expect(lastPatch()?.footer).toStrictEqual({ copyright: '' });
  });

  it("the project's cached read is never written by a save: a new read's empty footer stays, whatever the save answered", async () => {
    await open();
    const patch = gate();
    server.holdPatch = patch.promise;
    await type('copyright', 'Stored');
    await startSave();
    // The footer is emptied elsewhere, and the query is dropped and read again (a new cache entry).
    server.footer['site-1'] = {};
    await act(async () => queryClient.removeQueries({ queryKey: projectQueryOptions('site-1').queryKey }));
    await act(() => queryClient.fetchQuery(projectQueryOptions('site-1')));
    server.failReads.add('site-1');
    await patch.open();
    await finished();
    expect(queryClient.getQueryData<Project>(projectQueryOptions('site-1').queryKey)?.config?.footer).toStrictEqual({});
  });

  it('P2a: a scope round trip after a failed refetch reads the project again, so the stored text shows and clearing it sends ""', async () => {
    await open();
    server.failReads.add('site-1');
    await type('copyright', 'Stored');
    await save();
    server.failReads.delete('site-1');
    await click('Français');
    await click('settings.chrome.scope.default');
    await vi.waitFor(() => expect(input('copyright').value).toBe('Stored'));
    await type('copyright', 'Typed');
    await type('copyright', '');
    await type('x', 'https://x.com/handbook');
    await save();
    expect(lastPatch()?.footer).toStrictEqual({ copyright: '', x: 'https://x.com/handbook' });
  });

  it('… and while reads keep failing, the round trip shows the last read: a save of another field leaves the copyright alone (as on main)', async () => {
    await open();
    server.failReads.add('site-1');
    await type('copyright', 'Stored');
    await save();
    await click('Français');
    await click('settings.chrome.scope.default');
    await settle();
    expect(input('copyright').value).toBe('');
    await type('x', 'https://x.com/handbook');
    await save();
    expect(lastPatch()?.footer).toStrictEqual({ x: 'https://x.com/handbook' });
    expect(server.footer['site-1'].copyright).toBe('Stored');
  });

  it('a section reopened after a failed refetch reads the project again', async () => {
    await open();
    server.failReads.add('site-1');
    await type('copyright', 'Stored');
    await save();
    server.failReads.delete('site-1');
    const reads = server.reads;
    await act(async () => mounted(false));
    await act(async () => mounted(true));
    await vi.waitFor(() => expect(server.reads).toBe(reads + 1));
    await vi.waitFor(() => expect(input('copyright').value).toBe('Stored'));
  });

  it('P2b: a fresh read without a text the form saved before is the truth: another field’s save leaves the key out', async () => {
    await open();
    await type('copyright', 'Stored');
    await save();
    server.footer['site-1'] = {};
    await read();
    expect(input('copyright').value).toBe('');
    await type('x', 'https://x.com/handbook');
    await save();
    expect(lastPatch()?.footer).toStrictEqual({ x: 'https://x.com/handbook' });
  });

  it('an edit made during the save stays, dirty, and the next save sends only it', async () => {
    await open({ ...STORED });
    const patch = gate();
    server.holdPatch = patch.promise;
    await type('github', 'https://github.com/handbook-docs');
    await startSave();
    await type('x', 'https://x.com/handbook-docs');
    await patch.open();
    await finished();
    expect(input('x').value).toBe('https://x.com/handbook-docs');
    expect(region()).not.toBeNull();
    server.holdPatch = undefined;
    await save();
    expect(lastPatch()?.footer).toStrictEqual({ x: 'https://x.com/handbook-docs' });
  });

  it('a conflict: "Keep mine" saves mine; "Use theirs" leaves theirs and sends nothing for it', async () => {
    await open({ ...STORED });
    await type('github', 'https://github.com/mine');
    server.footer['site-1'] = { ...server.footer['site-1'], github: 'https://github.com/theirs' };
    await read();
    expect(conflict()).toBe(true);
    await click('forms.keepMine');
    await save();
    expect(lastPatch()?.footer).toStrictEqual({ github: 'https://github.com/mine' });

    await type('x', 'https://x.com/mine');
    server.footer['site-1'] = { ...server.footer['site-1'], x: 'https://x.com/theirs' };
    await read();
    await click('forms.useTheirs');
    expect(input('x').value).toBe('https://x.com/theirs');
    expect(region()).toBeNull();
  });

  it('A → B → A: a save that settles after a site switch changes neither the other site nor what each site sends next', async () => {
    await open();
    server.footer['site-2'] = { x: 'https://x.com/two' };
    const patch = gate();
    server.holdPatch = patch.promise;
    await type('copyright', 'One');
    await startSave();
    await act(async () => showSite('site-2'));
    await vi.waitFor(() => expect(input('x').value).toBe('https://x.com/two'));
    await patch.open();
    await finished();
    expect(input('copyright').value).toBe('');
    expect(region()).toBeNull();

    await type('linkedin', '/company/two');
    await save();
    expect(lastPatch()).toStrictEqual({ site: 'site-2', footer: { linkedin: '/company/two' } });

    await act(async () => showSite('site-1'));
    await vi.waitFor(() => expect(input('copyright').value).toBe('One'));
    await type('copyright', '');
    await save();
    expect(lastPatch()).toStrictEqual({ site: 'site-1', footer: { copyright: '' } });
  });
});
