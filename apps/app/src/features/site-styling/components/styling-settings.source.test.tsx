// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@/hooks/api';
import { projectQueryOptions } from '@/hooks/api/query-options';
import type { StylingConfig } from '../model/styling';
import { StylingSettings } from './styling-settings';

const mocks = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, translateFn: (key: string) => key }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: vi.fn() } }));
vi.mock('@tanstack/react-router', () => ({ useBlocker: () => undefined }));
vi.mock('@/services/api-origin', () => ({ apiOrigin: () => 'http://dashboard.test' }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

/**
 * Through the real project query and mutation. Behind `fetch`, a stand-in API
 * keeps each site's config; a PATCH merges `config.styling` key by key and
 * keeps every other section, as the real merge does
 * (apps/server/src/actions/projects.test.ts runs that one, with the real
 * validator). A test can hold or fail a PATCH, or have another writer change
 * a site's config.
 */
type Site = 'site-1' | 'site-2';
type Config = { styling?: StylingConfig; theme?: Record<string, unknown>; seo?: Record<string, unknown> };
let server: {
  config: Record<Site, Config>;
  holdPatch?: Promise<void>;
  failPatch: boolean;
  patches: Array<{ site: Site; config: Config }>;
};
/** A modern theme the legacy styling sits beside: its own light accent and layout radius. */
const THEME = { preset: 'harbor', colors: { light: { accent: '#0f766e' } }, layout: { radius: 'sharp' } };

function stubApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const site = new URL(request.url).pathname.split('/')[4] as Site;
      const answer = () => ({ data: { id: site, name: 'Handbook', slug: site, config: structuredClone(server.config[site]) } });
      if (request.method === 'GET') return Response.json(answer());
      const { config } = (await request.json()) as { config: Config };
      server.patches.push({ site, config });
      await server.holdPatch;
      if (server.failPatch) return Response.json({ error: { message: 'offline' } }, { status: 503 });
      const stored = server.config[site];
      server.config[site] = { ...stored, styling: { ...stored.styling, ...config.styling } };
      return Response.json(answer());
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

/** The editor's Configuration canvas: the site from the project query, then the section, not remounted on a site switch. */
function Canvas() {
  const [site, setSite] = useState<Site>('site-1');
  showSite = setSite;
  const { data } = useQuery(projectQueryOptions(site));
  return data ? <StylingSettings project={data as Project} /> : null;
}

async function open(config: Config) {
  server.config['site-1'] = config;
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <Canvas />
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => expect(container.querySelector('input')).not.toBeNull());
  await settle();
}

beforeEach(() => {
  server = { config: { 'site-1': {}, 'site-2': {} }, failPatch: false, patches: [] };
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
  vi.clearAllMocks();
});

const hex = () => container.querySelector<HTMLInputElement>('input[aria-label="settings.styling.primaryColor.label"]') as HTMLInputElement;
const slider = (name: 'hue' | 'saturation' | 'lightness') =>
  container.querySelector<HTMLInputElement>(`input[aria-label="settings.styling.${name}"]`) as HTMLInputElement;
const setValue = (el: HTMLInputElement, text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const buttonNamed = (name: string) => {
  const found = [...container.querySelectorAll('button')].find(
    (button) => button.getAttribute('aria-label') === name || button.textContent?.trim().startsWith(name),
  );
  if (!found) throw new Error(`No button named ${name}`);
  return found;
};
const click = (name: string) => act(async () => buttonNamed(name).click());
const radius = () =>
  [...container.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent).find((x) => x?.startsWith('settings.styling.radius'));
const region = () => container.querySelector('[data-slot="save-region"]');
const conflict = () => container.textContent?.includes('forms.changedElsewhere');
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
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
/** Another writer changes the stored styling (or another section). */
const elsewhere = (site: Site, change: (config: Config) => Config) => {
  server.config[site] = change(structuredClone(server.config[site]));
};

describe('StylingSettings over the project query: a save sends only what changed', () => {
  it('a color-only save sends the color alone: the unset radius and appearance stay unset, the theme stays as stored', async () => {
    await open({ theme: THEME, seo: { metaTitle: 'Docs' }, styling: { primaryColor: '#5546e8' } });
    await click('#0ea5e9');
    await save();
    expect(lastPatch()?.config).toStrictEqual({ styling: { primaryColor: '#0ea5e9' } });
    expect(server.config['site-1']).toStrictEqual({ theme: THEME, seo: { metaTitle: 'Docs' }, styling: { primaryColor: '#0ea5e9' } });
    expect(region()).toBeNull();
  });

  it('a radius-only save sends the radius alone and keeps the stored appearance and color', async () => {
    await open({ theme: THEME, styling: { primaryColor: '#16a34a', theme: 'dark' } });
    await click('settings.styling.radius.pill');
    await save();
    expect(lastPatch()?.config).toStrictEqual({ styling: { radius: 'pill' } });
    expect(server.config['site-1'].styling).toStrictEqual({ primaryColor: '#16a34a', theme: 'dark', radius: 'pill' });
    expect(server.config['site-1'].theme).toStrictEqual(THEME);
  });

  it('a short color is stored in its long lowercase form; the field keeps "#0EA" while typing and reads "#00EEAA" once left', async () => {
    await open({});
    await setValue(hex(), '0ea');
    expect(hex().value).toBe('#0EA');
    await act(async () => hex().dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(hex().value).toBe('#00EEAA');
    await save();
    expect(lastPatch()?.config).toStrictEqual({ styling: { primaryColor: '#00eeaa' } });
  });

  it('the same color by case, # or short form is not an edit: nothing to save', async () => {
    await open({ styling: { primaryColor: '#aabbcc' } });
    for (const typed of ['ABC', '#abc', 'AABBCC', '#AaBbCc']) {
      await setValue(hex(), typed);
      expect(region()).toBeNull();
    }
  });

  it('an unset radius shows Rounded and stays unset: Sharp then Rounded again leaves nothing to save', async () => {
    await open({ styling: { primaryColor: '#16a34a' } });
    expect(radius()).toBe('settings.styling.radius.rounded');
    await click('settings.styling.radius.sharp');
    expect(region()).not.toBeNull();
    await click('settings.styling.radius.rounded');
    expect(region()).toBeNull();
  });

  it('a stored Sharp set back to Rounded sends rounded', async () => {
    await open({ styling: { radius: 'sharp' } });
    await click('settings.styling.radius.rounded');
    await save();
    expect(lastPatch()?.config).toStrictEqual({ styling: { radius: 'rounded' } });
  });
});

describe('StylingSettings follows the server', () => {
  it('main regression: a clean refetch shows the other writer’s color and radius (main kept the mount-time controls)', async () => {
    await open({ styling: { primaryColor: '#5546e8' } });
    elsewhere('site-1', (config) => ({ ...config, styling: { primaryColor: '#ef4444', radius: 'pill' } }));
    await read();
    expect(hex().value).toBe('#EF4444');
    expect(slider('hue').value).toBe('0');
    expect(radius()).toBe('settings.styling.radius.pill');
    expect(region()).toBeNull();
  });

  it('pending edits survive a refetch; another writer’s untouched radius and appearance survive the later color save', async () => {
    await open({ styling: { primaryColor: '#5546e8' } });
    await click('#db2777');
    elsewhere('site-1', (config) => ({ ...config, styling: { ...config.styling, radius: 'pill', theme: 'dark' } }));
    await read();
    expect(hex().value).toBe('#DB2777');
    expect(radius()).toBe('settings.styling.radius.pill');
    expect(conflict()).toBe(false);
    await save();
    expect(lastPatch()?.config).toStrictEqual({ styling: { primaryColor: '#db2777' } });
    expect(server.config['site-1'].styling).toStrictEqual({ primaryColor: '#db2777', radius: 'pill', theme: 'dark' });
  });

  it('a same-site change landing during a save: the save keeps it, and confirms its own color', async () => {
    await open({ styling: { primaryColor: '#5546e8' } });
    const patch = gate();
    server.holdPatch = patch.promise;
    await click('#16a34a');
    await startSave();
    elsewhere('site-1', (config) => ({ ...config, styling: { ...config.styling, radius: 'sharp' } }));
    await read();
    await patch.open();
    await finished();
    expect(hex().value).toBe('#16A34A');
    expect(radius()).toBe('settings.styling.radius.sharp');
    expect(region()).toBeNull();
    expect(server.config['site-1'].styling).toStrictEqual({ primaryColor: '#16a34a', radius: 'sharp' });
  });

  it('a failed save keeps the edits, says so once, and the retry sends the same change', async () => {
    await open({ styling: { primaryColor: '#5546e8', radius: 'pill' } });
    server.failPatch = true;
    await click('#ea580c');
    await save();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(hex().value).toBe('#EA580C');
    expect(region()).not.toBeNull();
    server.failPatch = false;
    await save();
    expect(lastPatch()?.config).toStrictEqual({ styling: { primaryColor: '#ea580c' } });
    expect(server.config['site-1'].styling).toStrictEqual({ primaryColor: '#ea580c', radius: 'pill' });
  });

  it('a conflict: "Keep mine" sends mine against theirs; "Use theirs" takes theirs and leaves nothing to save', async () => {
    await open({ styling: { primaryColor: '#5546e8' } });
    await click('#a855f7');
    elsewhere('site-1', (config) => ({ ...config, styling: { ...config.styling, primaryColor: '#0f172a' } }));
    await read();
    expect(conflict()).toBe(true);
    await click('forms.keepMine');
    expect(conflict()).toBe(false);
    await save();
    expect(lastPatch()?.config).toStrictEqual({ styling: { primaryColor: '#a855f7' } });

    await click('settings.styling.radius.pill');
    elsewhere('site-1', (config) => ({ ...config, styling: { ...config.styling, radius: 'sharp' } }));
    await read();
    expect(conflict()).toBe(true);
    await click('forms.useTheirs');
    expect(radius()).toBe('settings.styling.radius.sharp');
    expect(region()).toBeNull();
  });

  it('Discard returns the controls, sliders included, to the stored color', async () => {
    await open({ styling: { primaryColor: '#ef4444' } });
    await setValue(slider('hue'), '120');
    expect(hex().value).toBe('#43EF43');
    await click('forms.discard');
    expect(hex().value).toBe('#EF4444');
    expect(slider('hue').value).toBe('0');
    expect(region()).toBeNull();
  });

  it('A → B → A: a save that completes after the switch shows nowhere else, and each site sends only its own change', async () => {
    await open({ styling: { primaryColor: '#5546e8' } });
    server.config['site-2'] = { styling: { primaryColor: '#0ea5e9', radius: 'sharp' } };
    const patch = gate();
    server.holdPatch = patch.promise;
    await click('#ef4444');
    await startSave();
    await act(async () => showSite('site-2'));
    await vi.waitFor(() => expect(hex().value).toBe('#0EA5E9'));
    await act(async () => showSite('site-1'));
    await settle();
    await patch.open();
    await finished();
    // Site 1 shows what its server holds; the late answer neither errors nor leaves a draft.
    await read();
    expect(hex().value).toBe('#EF4444');
    expect(region()).toBeNull();
    expect(mocks.toastError).not.toHaveBeenCalled();
    server.holdPatch = undefined;

    await act(async () => showSite('site-2'));
    await vi.waitFor(() => expect(hex().value).toBe('#0EA5E9'));
    expect(radius()).toBe('settings.styling.radius.sharp');
    await click('settings.styling.radius.pill');
    await save();
    expect(lastPatch()).toStrictEqual({ site: 'site-2', config: { styling: { radius: 'pill' } } });
    expect(server.config['site-2'].styling).toStrictEqual({ primaryColor: '#0ea5e9', radius: 'pill' });
  });
});
