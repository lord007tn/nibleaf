// @vitest-environment jsdom
import { resolveTheme, type ThemeOwnedProjectConfig } from '@nibleaf/shared/themes';
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
/** Where the shown radius comes from, as its group describes it to assistive tech. */
const radiusSource = () => {
  const group = container.querySelector('fieldset[aria-describedby]');
  const label = document.getElementById(group?.getAttribute('aria-labelledby') ?? '')?.textContent;
  const source = document.getElementById(group?.getAttribute('aria-describedby') ?? '')?.textContent;
  return { label, source: source?.replace('settings.styling.radius.', '') };
};
const INHERITED = { label: 'settings.styling.radius.label', source: 'inherited' };
const OVERRIDE = { label: 'settings.styling.radius.label', source: 'override' };
const region = () => container.querySelector('[data-slot="save-region"]');
const status = () => container.querySelector('[role="status"][aria-live="polite"]')?.textContent?.trim() ?? '';
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

  it('a stored Sharp set back to Rounded sends rounded', async () => {
    await open({ styling: { radius: 'sharp' } });
    await click('settings.styling.radius.rounded');
    await save();
    expect(lastPatch()?.config).toStrictEqual({ styling: { radius: 'rounded' } });
  });
});

describe('StylingSettings: an unset radius shows the theme’s, and a choice sets the site’s own', () => {
  const SIGNAL = { preset: 'signal' };
  /** What the reader draws from what the stand-in API now stores. */
  const readerRadius = (site: Site = 'site-1') => resolveTheme(server.config[site] as ThemeOwnedProjectConfig).layout.radius;
  const methods = () => vi.mocked(fetch).mock.calls.map(([input, init]) => new Request(input, init).method);

  it.each([
    ['Harbor', { preset: 'harbor' }, 'rounded'],
    ['Signal', SIGNAL, 'sharp'],
    ['Manuscript', { preset: 'manuscript' }, 'rounded'],
    ['Harbor with its own layout radius', THEME, 'sharp'],
    ['Signal with its own layout radius', { preset: 'signal', layout: { radius: 'pill' } }, 'pill'],
  ])('%s: shows the radius the reader draws, as inherited, with nothing to save and no write', async (_name, theme, shown) => {
    await open({ theme, styling: { primaryColor: '#5546e8' } });
    expect(radius()).toBe(`settings.styling.radius.${shown}`);
    expect(readerRadius()).toBe(shown);
    expect(radiusSource()).toStrictEqual(INHERITED);
    expect(region()).toBeNull();
    await read();
    expect(region()).toBeNull();
    expect(server.patches).toStrictEqual([]);
    expect(methods().every((method) => method === 'GET')).toBe(true);
  });

  it('main regression: Signal, unset; one click on Rounded saves {radius: rounded} in one request, and the reader then draws Rounded', async () => {
    await open({ theme: SIGNAL, styling: { primaryColor: '#5546e8', theme: 'dark' } });
    // Main showed Rounded here, and a click on it changed nothing.
    expect(radius()).toBe('settings.styling.radius.sharp');
    await click('settings.styling.radius.rounded');
    expect(radius()).toBe('settings.styling.radius.rounded');
    expect(radiusSource()).toStrictEqual(OVERRIDE);
    expect(region()).not.toBeNull();
    await save();
    expect(server.patches).toStrictEqual([{ site: 'site-1', config: { styling: { radius: 'rounded' } } }]);
    expect(server.config['site-1']).toStrictEqual({ theme: SIGNAL, styling: { primaryColor: '#5546e8', theme: 'dark', radius: 'rounded' } });
    expect(readerRadius()).toBe('rounded');
    await read();
    expect(radius()).toBe('settings.styling.radius.rounded');
    expect(radiusSource()).toStrictEqual(OVERRIDE);
    expect(region()).toBeNull();
    expect(status()).toBe('common.saved');
  });

  it('a click on the inherited radius itself sets it; later theme changes no longer move it', async () => {
    await open({ theme: SIGNAL, styling: {} });
    const sharp = buttonNamed('settings.styling.radius.sharp');
    expect(sharp.getAttribute('aria-pressed')).toBe('true');
    expect(sharp.disabled).toBe(false);
    await click('settings.styling.radius.sharp');
    expect(radiusSource()).toStrictEqual(OVERRIDE);
    expect(region()).not.toBeNull();
    await save();
    expect(lastPatch()?.config).toStrictEqual({ styling: { radius: 'sharp' } });
    elsewhere('site-1', (config) => ({ ...config, theme: { preset: 'harbor', layout: { radius: 'pill' } } }));
    await read();
    expect(radius()).toBe('settings.styling.radius.sharp');
    expect(radiusSource()).toStrictEqual(OVERRIDE);
    expect(readerRadius()).toBe('sharp');
    expect(region()).toBeNull();
  });

  it('a color-only save and theme refetches never set it: the shown radius follows the theme, still inherited', async () => {
    await open({ theme: SIGNAL, styling: { primaryColor: '#5546e8' } });
    await click('#0ea5e9');
    await save();
    expect(lastPatch()?.config).toStrictEqual({ styling: { primaryColor: '#0ea5e9' } });
    expect(server.config['site-1'].styling).toStrictEqual({ primaryColor: '#0ea5e9' });
    expect(radius()).toBe('settings.styling.radius.sharp');
    elsewhere('site-1', (config) => ({ ...config, theme: { preset: 'manuscript' } }));
    await read();
    expect(radius()).toBe('settings.styling.radius.rounded');
    expect(radiusSource()).toStrictEqual(INHERITED);
    expect(region()).toBeNull();
    // A theme change while a color edit is pending: the shown radius follows, the color edit stays, nothing else is sent.
    await click('#16a34a');
    elsewhere('site-1', (config) => ({ ...config, theme: SIGNAL }));
    await read();
    expect(radius()).toBe('settings.styling.radius.sharp');
    expect(radiusSource()).toStrictEqual(INHERITED);
    await save();
    expect(lastPatch()?.config).toStrictEqual({ styling: { primaryColor: '#16a34a' } });
    expect(server.config['site-1'].styling).toStrictEqual({ primaryColor: '#16a34a' });
  });

  it('a chosen radius survives a theme refetch; Discard returns to the inherited one', async () => {
    await open({ theme: SIGNAL, styling: {} });
    await click('settings.styling.radius.pill');
    elsewhere('site-1', (config) => ({ ...config, theme: { preset: 'manuscript' } }));
    await read();
    expect(radius()).toBe('settings.styling.radius.pill');
    expect(conflict()).toBe(false);
    await click('forms.discard');
    expect(radius()).toBe('settings.styling.radius.rounded');
    expect(radiusSource()).toStrictEqual(INHERITED);
    expect(region()).toBeNull();
    expect(server.patches).toStrictEqual([]);
  });

  it('a failed save keeps the chosen radius; the retry sends it', async () => {
    await open({ theme: SIGNAL, styling: {} });
    server.failPatch = true;
    await click('settings.styling.radius.rounded');
    await save();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(radius()).toBe('settings.styling.radius.rounded');
    expect(radiusSource()).toStrictEqual(OVERRIDE);
    expect(region()).not.toBeNull();
    server.failPatch = false;
    await save();
    expect(server.patches.map((patch) => patch.config)).toStrictEqual([{ styling: { radius: 'rounded' } }, { styling: { radius: 'rounded' } }]);
    expect(readerRadius()).toBe('rounded');
    expect(region()).toBeNull();
  });

  it('another writer’s radius: "Keep mine" sends mine against theirs; "Use theirs" takes theirs as the site’s own', async () => {
    await open({ theme: SIGNAL, styling: {} });
    await click('settings.styling.radius.rounded');
    elsewhere('site-1', (config) => ({ ...config, styling: { radius: 'pill' } }));
    await read();
    expect(conflict()).toBe(true);
    await click('forms.keepMine');
    await save();
    expect(lastPatch()?.config).toStrictEqual({ styling: { radius: 'rounded' } });
    expect(readerRadius()).toBe('rounded');

    await click('settings.styling.radius.sharp');
    elsewhere('site-1', (config) => ({ ...config, styling: { radius: 'pill' } }));
    await read();
    expect(conflict()).toBe(true);
    await click('forms.useTheirs');
    expect(radius()).toBe('settings.styling.radius.pill');
    expect(radiusSource()).toStrictEqual(OVERRIDE);
    expect(region()).toBeNull();
  });

  it('a newer choice during the save stays to save, never "Saved"; the next save sends it alone', async () => {
    await open({ theme: SIGNAL, styling: {} });
    const patch = gate();
    server.holdPatch = patch.promise;
    await click('settings.styling.radius.rounded');
    await startSave();
    await click('settings.styling.radius.pill');
    await read();
    await patch.open();
    await finished();
    server.holdPatch = undefined;
    expect(radius()).toBe('settings.styling.radius.pill');
    expect(region()).not.toBeNull();
    expect(status()).not.toBe('common.saved');
    await save();
    expect(lastPatch()?.config).toStrictEqual({ styling: { radius: 'pill' } });
    expect(region()).toBeNull();
    expect(status()).toBe('common.saved');
  });

  it('A → B → A with a late completion: the choice shows on no other site, and each site shows what its server holds', async () => {
    await open({ theme: SIGNAL, styling: {} });
    server.config['site-2'] = { theme: { preset: 'harbor' }, styling: {} };
    const patch = gate();
    server.holdPatch = patch.promise;
    await click('settings.styling.radius.pill');
    await startSave();
    await act(async () => showSite('site-2'));
    await vi.waitFor(() => expect(radius()).toBe('settings.styling.radius.rounded'));
    expect(radiusSource()).toStrictEqual(INHERITED);
    expect(region()).toBeNull();
    await act(async () => showSite('site-1'));
    await settle();
    // Back on site 1 before its save answered: a fresh form on what the cache holds, nothing carried over.
    expect(radius()).toBe('settings.styling.radius.sharp');
    expect(radiusSource()).toStrictEqual(INHERITED);
    expect(region()).toBeNull();
    await patch.open();
    await finished();
    server.holdPatch = undefined;
    expect(region()).toBeNull();
    expect(mocks.toastError).not.toHaveBeenCalled();
    await read();
    expect(radius()).toBe('settings.styling.radius.pill');
    expect(radiusSource()).toStrictEqual(OVERRIDE);
    await act(async () => showSite('site-2'));
    await read('site-2');
    expect(radius()).toBe('settings.styling.radius.rounded');
    expect(radiusSource()).toStrictEqual(INHERITED);
    expect(server.patches).toStrictEqual([{ site: 'site-1', config: { styling: { radius: 'pill' } } }]);
  });

  /**
   * #767: site 2 is not cached, so the section really unmounts while it loads
   * and a new one mounts on the way back. The held Pill save belongs to the
   * section that unmounted: however it ends, the new section's choice stays,
   * with nothing said about the old save and focus left where it is.
   */
  describe.each([
    ['fails', true],
    ['succeeds', false],
  ])('a held Pill save that %s after A → uncached B → A', (_name, fails) => {
    it('neither toasts, says "Saved", resets the new Rounded choice nor moves focus', async () => {
      await open({ theme: SIGNAL, styling: {} });
      server.config['site-2'] = { theme: { preset: 'harbor' }, styling: {} };
      const patch = gate();
      server.holdPatch = patch.promise;
      server.failPatch = fails;
      await click('settings.styling.radius.pill');
      await startSave();
      const before = hex();
      await act(async () => showSite('site-2'));
      await vi.waitFor(() => expect(radius()).toBe('settings.styling.radius.rounded'));
      await act(async () => showSite('site-1'));
      await settle();
      // Site 2 was not cached, so the section unmounted while it loaded: a new form, not the same one.
      expect(hex()).not.toBe(before);
      expect(radius()).toBe('settings.styling.radius.sharp');
      await click('settings.styling.radius.rounded');
      await act(async () => hex().focus());
      await patch.open();
      await finished();
      server.holdPatch = undefined;
      server.failPatch = false;
      expect(mocks.toastError).not.toHaveBeenCalled();
      expect(radius()).toBe('settings.styling.radius.rounded');
      expect(radiusSource()).toStrictEqual(OVERRIDE);
      expect(region()).not.toBeNull();
      expect(status()).not.toBe('common.saved');
      expect(document.activeElement).toBe(hex());
      // The new choice saves on its own: one request, its own change.
      await save();
      expect(lastPatch()).toStrictEqual({ site: 'site-1', config: { styling: { radius: 'rounded' } } });
      expect(mocks.toastError).not.toHaveBeenCalled();
    });
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

  it('the sliders keep their exact position through their own save, and follow the source once it moves: black → green → black, then lightness alone', async () => {
    await open({ styling: { primaryColor: '#ef4444' } });
    const hsl = () => [slider('hue').value, slider('saturation').value, slider('lightness').value];
    await setValue(slider('hue'), '200');
    await setValue(slider('saturation'), '80');
    await setValue(slider('lightness'), '0');
    expect(hex().value).toBe('#000000');
    await save();
    expect(lastPatch()?.config).toStrictEqual({ styling: { primaryColor: '#000000' } });
    // Its own echo leaves the sliders where the person put them.
    expect(hsl()).toStrictEqual(['200', '80', '0']);

    elsewhere('site-1', (config) => ({ ...config, styling: { primaryColor: '#00ff00' } }));
    await read();
    expect(hsl()).toStrictEqual(['120', '100', '50']);
    elsewhere('site-1', (config) => ({ ...config, styling: { primaryColor: '#000000' } }));
    await read();
    // Black again, from the source: its own HSL, not the earlier slider position.
    expect(hsl()).toStrictEqual(['0', '0', '0']);

    await setValue(slider('lightness'), '50');
    expect(hex().value).toBe('#808080');
    await save();
    expect(lastPatch()?.config).toStrictEqual({ styling: { primaryColor: '#808080' } });
    expect(server.config['site-1'].styling).toStrictEqual({ primaryColor: '#808080' });
    expect(hex().value).toBe('#808080');
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
