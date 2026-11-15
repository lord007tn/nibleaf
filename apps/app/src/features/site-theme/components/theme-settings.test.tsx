// @vitest-environment jsdom
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import {
  applyThemeTemplateConfig,
  canonicalThemeTemplateJson,
  previewThemeConfigChanges,
  resolveTheme,
  THEME_SCHEMA_VERSION,
  THEME_TEMPLATE_KIND,
  themeOwnedConfig,
  themeTemplateFromConfig,
} from '@nibleaf/shared/themes';
import { parseThemeTemplate } from '@nibleaf/validators';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeSection } from '@/components/project-settings/theme-section';
import type { Project } from '@/hooks/api';
import { projectQueryOptions } from '@/hooks/api/query-options';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, translateFn: (key: string) => key }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@tanstack/react-router', () => ({ useBlocker: () => undefined }));
vi.mock('@/services/api-origin', () => ({ apiOrigin: () => 'http://dashboard.test' }));
vi.mock('@/lib/site-theme', () => ({
  projectThemeVariables: () => ({}),
  projectThemeStyle: () => ({}),
  // main's section reads it; kept so this suite also runs against main.
  siteAppearance: (config?: { styling?: { theme?: string } } | null) => config?.styling?.theme ?? 'system',
}));
vi.mock('@/components/site/documentation-theme-provider', () => ({
  DocumentationThemeProvider: ({ children, theme }: { children: unknown; theme: { id: string } }) => (
    <div data-preset={theme.id} data-testid="preview">
      {children as never}
    </div>
  ),
  DocumentationStudioPreviewLayout: () => null,
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

/**
 * Theme Studio through the real project query, the real project PATCH and the
 * real import and export mutations. Behind `fetch`, a stand-in API keeps each
 * site's config: a PATCH merges each section one level deep, as the API does
 * (apps/server/src/actions/projects.test.ts runs the real merge), and the
 * import endpoint applies a template the way `actions/themes.ts` does, with the
 * same shared functions. A test can hold an answer, fail a request, or change a
 * site's config as another writer would.
 */
type Site = 'site-1' | 'site-2';
type Config = Record<string, unknown>;
type Gate = { promise: Promise<void>; open: () => Promise<void> };
let server: {
  config: Record<Site, Config>;
  failReads: Set<Site>;
  failPatch: boolean;
  failImport: boolean;
  holdPatch?: Promise<void>;
  holdImport?: Promise<void>;
  patches: Array<{ site: Site; config: Config }>;
  imports: Array<{ site: Site; apply: boolean; mode: string }>;
  exports: number;
};
const project = (site: Site) => ({ id: site, name: 'Handbook', slug: `handbook-${site}`, config: structuredClone(server.config[site]) });
const isObject = (value: unknown): value is Config => typeof value === 'object' && value !== null && !Array.isArray(value);
/** The API's project PATCH merge: each object section one level deep, anything else replaced. */
const mergeConfig = (existing: Config, incoming: Config) => {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming))
    merged[key] = isObject(value) ? { ...(isObject(merged[key]) ? merged[key] : {}), ...value } : value;
  return merged;
};
/** `importProjectTheme` from apps/server/src/actions/themes.ts, on the same shared functions. */
const importTheme = (current: Config, body: { template: unknown; mode: 'merge' | 'replace'; apply: boolean }) => {
  const parsed = parseThemeTemplate(body.template);
  if (!parsed.success) return;
  const incoming = {
    ...parsed.template.config,
    theme: {
      version: THEME_SCHEMA_VERSION,
      preset: parsed.template.config.theme?.preset ?? 'harbor',
      ...parsed.template.config.theme,
      metadata: parsed.template.metadata,
    },
  };
  const next = applyThemeTemplateConfig(applyThemeTemplateConfig(current, themeOwnedConfig(current), 'replace'), incoming, body.mode);
  const changes = previewThemeConfigChanges(current, next);
  return {
    next,
    result: {
      applied: body.apply,
      mode: body.mode,
      migratedFrom: parsed.migratedFrom,
      changes,
      theme: resolveTheme(themeOwnedConfig(next)),
      template: themeTemplateFromConfig(next),
      publishedChangesPending: body.apply && changes.length > 0,
    },
  };
};

function stubApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const [, , , , site, rest, sub] = new URL(request.url).pathname.split('/') as [string, string, string, string, Site, string?, string?];
      if (rest === 'theme-template' && sub === 'import') {
        const body = (await request.json()) as { template: unknown; mode: 'merge' | 'replace'; apply: boolean };
        server.imports.push({ site, apply: body.apply, mode: body.mode });
        await server.holdImport;
        const answer = importTheme(server.config[site], body);
        if (server.failImport || !answer) return Response.json({ error: { message: 'Theme template is invalid.' } }, { status: 400 });
        if (body.apply) server.config[site] = answer.next;
        return Response.json({ data: answer.result });
      }
      if (rest === 'theme-template') {
        server.exports += 1;
        const template = themeTemplateFromConfig(server.config[site]);
        return Response.json({ data: { template, json: canonicalThemeTemplateJson(template) } });
      }
      if (request.method === 'GET') {
        if (server.failReads.has(site)) return Response.json({ error: { message: 'offline' } }, { status: 503 });
        return Response.json({ data: project(site) });
      }
      const { config } = (await request.json()) as { config: Config };
      server.patches.push({ site, config });
      if (server.failPatch) return Response.json({ error: { message: 'down' } }, { status: 500 });
      server.config[site] = mergeConfig(server.config[site], config);
      const answer = project(site);
      await server.holdPatch;
      return Response.json({ data: answer });
    }),
  );
}

const gate = (): Gate => {
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
const downloads: Blob[] = [];

function Canvas() {
  const [site, setSite] = useState<Site>('site-1');
  showSite = setSite;
  return <Section site={site} />;
}
function Section({ site }: { site: Site }) {
  const { data } = useQuery(projectQueryOptions(site));
  return data ? <ThemeSection project={data as Project} /> : null;
}

/** The site's own theme: Signal with an authored accent and metadata, beside Styling's colour and radius. */
const AUTHORED = {
  version: 1,
  preset: 'signal',
  metadata: { name: 'Handbook', description: 'Our theme', author: 'Docs team' },
  colors: { light: { accent: '#2f4ad0' } },
};
const STYLING = { primaryColor: '#5546e8', radius: 'pill', theme: 'dark' };
const SIBLINGS = { seo: { metaTitle: 'Docs' }, typography: { bodyFont: 'Inter' } };

async function open(config: Config = { ...SIBLINGS, styling: { ...STYLING }, theme: structuredClone(AUTHORED) }, strict = false) {
  server.config['site-1'] = structuredClone(config);
  const tree = (
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
        <Canvas />
      </ConfirmProvider>
    </QueryClientProvider>
  );
  await act(async () => root.render(strict ? <StrictMode>{tree}</StrictMode> : tree));
  await vi.waitFor(() => expect(container.querySelector('input[type="color"]')).not.toBeNull());
  await settle();
}

beforeEach(() => {
  server = {
    config: { 'site-1': {}, 'site-2': { theme: { version: 1, preset: 'manuscript' }, styling: { theme: 'light' } } },
    failReads: new Set(),
    failPatch: false,
    failImport: false,
    patches: [],
    imports: [],
    exports: 0,
  };
  stubApi();
  downloads.length = 0;
  // jsdom has no object URLs: the download's Blob is kept instead, and the link is never followed.
  URL.createObjectURL = (blob: Blob) => {
    downloads.push(blob);
    return 'blob:theme';
  };
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(vi.fn());
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })),
  );
  Element.prototype.scrollIntoView = vi.fn();
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
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

/** TanStack Query tells its observers on the next task: let that render. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const buttonNamed = (name: string, scope: ParentNode = container) => {
  const found = [...scope.querySelectorAll('button')].find((button) => !button.hidden && button.textContent?.trim().startsWith(name));
  if (!found) throw new Error(`No button named ${name}`);
  return found;
};
const click = (el: HTMLElement) => act(async () => el.click());
const region = () => container.querySelector<HTMLElement>('[data-slot="save-region"]');
const status = () => container.querySelector('[role="status"][aria-live="polite"]')?.textContent?.trim() ?? '';
const conflict = () => Boolean(container.textContent?.includes('forms.changedElsewhere'));
const field = (label: string) => {
  const found = [...container.querySelectorAll('label')].find((el) => el.textContent === label)?.parentElement;
  if (!found) throw new Error(`No field ${label}`);
  return found;
};
const segment = (fieldLabel: string, option: string) => buttonNamed(option, field(fieldLabel));
const appearance = (option: 'light' | 'dark' | 'system') => click(segment('settings.theme.appearance', `settings.styling.theme.${option}`));
const shownAppearance = () => field('settings.theme.appearance').querySelector('[aria-pressed="true"]')?.textContent;
const preset = (id: string) =>
  click(
    [...container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((b) =>
      b.textContent?.includes(`settings.theme.preset.${id}.name`),
    ) as HTMLElement,
  );
const activePreset = () => container.querySelector<HTMLElement>('[data-testid="preview"]')?.dataset.preset;
const color = (key: string) => {
  const found = container.querySelector<HTMLInputElement>(`input[type="color"][aria-label="settings.theme.color.${key}"]`);
  if (!found) throw new Error(`No colour ${key}`);
  return found;
};
const setColor = (key: string, value: string) =>
  act(async () => {
    const el = color(key);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const leaveColor = (key: string) =>
  act(async () => {
    color(key).focus();
    color(key).blur();
  });
const undoButton = () => buttonNamed('settings.theme.undo');
const undo = () => click(undoButton());
const startSave = async () => {
  const before = server.patches.length;
  await click(buttonNamed('common.save', region() ?? container));
  await vi.waitFor(() => expect(server.patches.length).toBe(before + 1));
};
const finished = async () => {
  await vi.waitFor(() => expect(queryClient.isMutating()).toBe(0));
  await settle();
  await settle();
};
const save = async () => {
  await startSave();
  await finished();
};
const discard = () => click(buttonNamed('forms.discard', region() ?? undefined));
const lastPatch = () => server.patches.at(-1)?.config;
/** Another writer changes the site, and the project query reads it again. */
const elsewhere = async (change: (config: Config) => Config, site: Site = 'site-1') => {
  server.config[site] = change(structuredClone(server.config[site]));
  await act(() => queryClient.refetchQueries({ queryKey: projectQueryOptions(site).queryKey }));
  await settle();
};
const storedTheme = (site: Site = 'site-1') => server.config[site].theme as Config;
const storedStyling = (site: Site = 'site-1') => server.config[site].styling as Config;
const textarea = () => container.querySelector<HTMLTextAreaElement>('textarea[aria-label="settings.theme.importJson"]') as HTMLTextAreaElement;
const typeTemplate = (text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea(), text);
    textarea().dispatchEvent(new Event('input', { bubbles: true }));
  });
const importResult = () => container.querySelector<HTMLElement>('[data-import-result]');
const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"], [role="dialog"]');
const answer = (choice: 'discard' | 'keep') => {
  const open = dialog();
  if (!open) throw new Error('No confirmation open');
  return click(buttonNamed(choice === 'discard' ? 'settings.chrome.scope.discardConfirm' : 'settings.unsaved.keep', open));
};
const template = (preset: string, extra: Config = {}) =>
  JSON.stringify({
    kind: THEME_TEMPLATE_KIND,
    version: 1,
    metadata: { name: 'Imported', description: 'From a file' },
    config: { theme: { preset }, ...extra },
  });

describe('Theme Studio follows the project query', () => {
  it('main regression: a refetch reaches a clean draft (main seeded it once, on mount)', async () => {
    await open();
    expect(activePreset()).toBe('signal');
    await elsewhere((config) => ({ ...config, theme: { version: 1, preset: 'manuscript' } }));
    expect(activePreset()).toBe('manuscript');
    expect(region()).toBeNull();
    expect(undoButton().disabled).toBe(true);
  });

  it('a refetch keeps a dirty edit to another key and takes the server’s value for the rest', async () => {
    // No Styling colour: with it, Manuscript's dark accent pair fails the authored-contrast gate (as on main).
    await open({ ...SIBLINGS, styling: { theme: 'dark' }, theme: structuredClone(AUTHORED) });
    await appearance('light');
    await elsewhere((config) => ({ ...config, theme: { version: 1, preset: 'manuscript' } }));
    expect(activePreset()).toBe('manuscript');
    expect(shownAppearance()).toBe('settings.styling.theme.light');
    expect(conflict()).toBe(false);
    // Undo never brings back the theme from before their change.
    expect(undoButton().disabled).toBe(true);
    await save();
    expect(lastPatch()).toStrictEqual({ styling: { theme: 'light' } });
    expect(storedTheme()).toStrictEqual({ version: 1, preset: 'manuscript' });
  });

  it('a refetch during a save keeps the save’s pending state, and its echo is not a conflict', async () => {
    await open();
    const patch = gate();
    server.holdPatch = patch.promise;
    await preset('manuscript');
    await startSave();
    await elsewhere((config) => config);
    expect(conflict()).toBe(false);
    await patch.open();
    await finished();
    expect(region()).toBeNull();
    expect(activePreset()).toBe('manuscript');
  });
});

describe('a save sends only what changed', () => {
  it('main regression: a theme-only save never replays Styling’s colour or radius over a newer value', async () => {
    await open();
    // Styling saves a new brand colour; this form has not read it.
    server.config['site-1'] = { ...server.config['site-1'], styling: { ...STYLING, primaryColor: '#0f766e' } };
    await preset('manuscript');
    await save();
    expect(lastPatch()).toStrictEqual({ theme: expect.objectContaining({ preset: 'manuscript' }) });
    expect(storedStyling()).toStrictEqual({ ...STYLING, primaryColor: '#0f766e' });
    expect(server.config['site-1'].seo).toStrictEqual(SIBLINGS.seo);
    expect(toast.success).toHaveBeenCalledWith('settings.theme.savedDraft');
  });

  it('an appearance-only save sends `styling: { theme }` alone and keeps the authored theme as stored', async () => {
    await open();
    await appearance('system');
    await save();
    expect(lastPatch()).toStrictEqual({ styling: { theme: 'system' } });
    expect(storedStyling()).toStrictEqual({ ...STYLING, theme: 'system' });
    expect(storedTheme()).toStrictEqual(AUTHORED);
    expect(region()).toBeNull();
  });

  it('a colour edit sends the authored theme with every optional part as it was, and no resolved default', async () => {
    await open();
    await setColor('canvas', '#fdfdfd');
    await save();
    expect(lastPatch()).toStrictEqual({ theme: { ...AUTHORED, colors: { light: { accent: '#2f4ad0', canvas: '#fdfdfd' } } } });
    expect(storedTheme()).toStrictEqual({ ...AUTHORED, colors: { light: { accent: '#2f4ad0', canvas: '#fdfdfd' } } });
  });

  it('an unset appearance stays unset: "system" on it is no change, and a theme save never stores one', async () => {
    await open({ styling: { primaryColor: '#5546e8' } });
    expect(shownAppearance()).toBe('settings.styling.theme.system');
    await appearance('dark');
    await appearance('system');
    expect(region()).toBeNull();
    await preset('signal');
    await save();
    expect(Object.keys(lastPatch() ?? {})).toStrictEqual(['theme']);
    expect(storedStyling()).toStrictEqual({ primaryColor: '#5546e8' });
  });

  it('Enter in the template box never saves; Ctrl+S saves once, and not again while saving', async () => {
    await open();
    await preset('manuscript');
    await act(async () => {
      textarea().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(server.patches).toHaveLength(0);
    const patch = gate();
    server.holdPatch = patch.promise;
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    });
    await vi.waitFor(() => expect(server.patches).toHaveLength(1));
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    });
    await patch.open();
    await finished();
    expect(server.patches).toHaveLength(1);
  });
});

describe('saves, conflicts and Undo', () => {
  it('a failed save keeps the draft and its Undo, says why once, and claims nothing', async () => {
    await open();
    await preset('manuscript');
    server.failPatch = true;
    await save();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(status()).not.toBe('common.saved');
    expect(activePreset()).toBe('manuscript');
    expect(region()).not.toBeNull();
    await undo();
    expect(activePreset()).toBe('signal');
  });

  it('edits made during a save survive it, stay unsaved, and Undo steps back only to what was saved', async () => {
    await open();
    const patch = gate();
    server.holdPatch = patch.promise;
    await preset('manuscript');
    await startSave();
    await appearance('light');
    await patch.open();
    await finished();
    expect(lastPatch()).toStrictEqual({ theme: expect.objectContaining({ preset: 'manuscript' }) });
    expect(shownAppearance()).toBe('settings.styling.theme.light');
    expect(region()).not.toBeNull();
    // The edit made during the save can be undone, back to what was saved; nothing from before the save.
    await undo();
    expect(shownAppearance()).toBe('settings.styling.theme.dark');
    expect(activePreset()).toBe('manuscript');
    expect(region()).toBeNull();
    expect(undoButton().disabled).toBe(true);
  });

  it('no late Undo after a settled save or a Discard', async () => {
    await open();
    await preset('manuscript');
    await save();
    expect(undoButton().disabled).toBe(true);
    await preset('harbor');
    await discard();
    expect(activePreset()).toBe('manuscript');
    expect(undoButton().disabled).toBe(true);
  });

  it('a real change elsewhere offers Use theirs and Keep mine; Keep mine stores the whole authored theme', async () => {
    await open();
    await setColor('canvas', '#fdfdfd');
    // Someone else stores layout and components the draft's theme doesn't have.
    await elsewhere((config) => ({ ...config, theme: { ...AUTHORED, layout: { shell: 'console' }, components: { tabs: 'pills' } } }));
    expect(conflict()).toBe(true);
    await click(buttonNamed('forms.keepMine'));
    expect(conflict()).toBe(false);
    await save();
    const mine = { ...AUTHORED, colors: { light: { accent: '#2f4ad0', canvas: '#fdfdfd' } } };
    expect(lastPatch()).toStrictEqual({ theme: { ...mine, layout: {}, components: {} } });
    expect(resolveTheme({ theme: storedTheme() as never }).layout).toStrictEqual(resolveTheme({ theme: mine as never }).layout);
    expect(region()).toBeNull();
  });

  it('Use theirs takes their theme and leaves no Undo across it', async () => {
    await open();
    await setColor('canvas', '#fdfdfd');
    await elsewhere((config) => ({ ...config, theme: { version: 1, preset: 'harbor' } }));
    await click(buttonNamed('forms.useTheirs'));
    expect(activePreset()).toBe('harbor');
    expect(region()).toBeNull();
    expect(undoButton().disabled).toBe(true);
  });

  it('a late save for one site never reaches another site’s form (A → B → A)', async () => {
    await open();
    const patch = gate();
    server.holdPatch = patch.promise;
    await preset('manuscript');
    await startSave();
    await act(async () => showSite('site-2'));
    await settle();
    expect(activePreset()).toBe('manuscript');
    expect(shownAppearance()).toBe('settings.styling.theme.light');
    expect(undoButton().disabled).toBe(true);
    await patch.open();
    await finished();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(region()).toBeNull();
    expect(server.patches.map((entry) => entry.site)).toStrictEqual(['site-1']);
    await act(async () => showSite('site-1'));
    await settle();
    expect(activePreset()).toBe('manuscript');
    expect(region()).toBeNull();
    expect(undoButton().disabled).toBe(true);
  });
});

describe('contrast problems show when they matter', () => {
  const FAILING = { version: 1, preset: 'harbor', colors: { light: { foreground: '#eeeeee' } } };

  it('a stored failing colour is explained but not marked until it is left or a save is tried', async () => {
    await open({ theme: FAILING });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('foreground/canvas');
    expect(color('foreground').getAttribute('aria-invalid')).toBeNull();
    await leaveColor('foreground');
    expect(color('foreground').getAttribute('aria-invalid')).toBe('true');
    expect(color('foreground').getAttribute('aria-describedby')).toBe(container.querySelector('[role="alert"]')?.id);
  });

  it('a save is refused before any request: the failing colour is marked and focused, in the mode it fails in', async () => {
    await open({ theme: { version: 1, preset: 'harbor', colors: { dark: { foreground: '#111111' } } } });
    await appearance('light');
    await click(buttonNamed('common.save', region() ?? container));
    await settle();
    expect(server.patches).toHaveLength(0);
    expect(status()).toBe('forms.fixHighlighted');
    // The dark tokens are shown, with the failing one marked and focused.
    expect(segment('settings.theme.colors', 'settings.styling.theme.dark').getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement?.getAttribute('aria-invalid')).toBe('true');
  });

  it('an invalid colour entered during a save stays marked after the save confirms, until Discard', async () => {
    await open();
    const patch = gate();
    server.holdPatch = patch.promise;
    await appearance('light');
    await startSave();
    await setColor('foreground', '#eeeeee');
    await leaveColor('foreground');
    await patch.open();
    await finished();
    expect(lastPatch()).toStrictEqual({ styling: { theme: 'light' } });
    expect(color('foreground').getAttribute('aria-invalid')).toBe('true');
    expect(region()).not.toBeNull();
    await discard();
    expect(color('foreground').getAttribute('aria-invalid')).toBeNull();
  });

  it('Use theirs clears a problem it resolves', async () => {
    await open();
    await setColor('foreground', '#eeeeee');
    await leaveColor('foreground');
    await elsewhere((config) => ({ ...config, theme: { version: 1, preset: 'harbor' } }));
    await click(buttonNamed('forms.useTheirs'));
    expect(color('foreground').getAttribute('aria-invalid')).toBeNull();
  });
});

describe('theme templates', () => {
  it('a preview writes nothing; a mode change retires it; a late preview never lands over newer text', async () => {
    await open();
    await typeTemplate(template('manuscript'));
    await click(buttonNamed('settings.theme.previewImport'));
    await vi.waitFor(() => expect(importResult()).not.toBeNull());
    expect(server.imports).toStrictEqual([{ site: 'site-1', apply: false, mode: 'merge' }]);
    expect(server.patches).toHaveLength(0);
    expect(storedTheme()).toStrictEqual(AUTHORED);
    await click(segment('settings.theme.exchange', 'settings.theme.replace'));
    expect(importResult()).toBeNull();

    const held = gate();
    server.holdImport = held.promise;
    await click(buttonNamed('settings.theme.previewImport'));
    await typeTemplate(template('harbor'));
    await held.open();
    await settle();
    expect(importResult()).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('Apply writes at once and the clean draft shows what was applied; a failed apply keeps the text and preview', async () => {
    await open();
    await typeTemplate(template('manuscript'));
    await click(buttonNamed('settings.theme.previewImport'));
    await vi.waitFor(() => expect(importResult()?.dataset.importResult).toBe('preview'));
    server.failImport = true;
    await click(buttonNamed('settings.theme.applyImport'));
    await settle();
    expect(toast.error).toHaveBeenCalledWith('settings.theme.import.applyError');
    expect(textarea().value).toBe(template('manuscript'));
    expect(importResult()?.dataset.importResult).toBe('preview');
    server.failImport = false;
    await click(buttonNamed('settings.theme.applyImport'));
    await vi.waitFor(() => expect(importResult()?.dataset.importResult).toBe('applied'));
    await settle();
    expect(server.patches).toHaveLength(0);
    expect(storedTheme()).toMatchObject({ preset: 'manuscript' });
    // The import keeps Styling's colour and radius and the other sections.
    expect(storedStyling()).toStrictEqual(STYLING);
    expect(server.config['site-1'].seo).toStrictEqual(SIBLINGS.seo);
    expect(activePreset()).toBe('manuscript');
    expect(region()).toBeNull();
    expect(toast.success).toHaveBeenCalledWith('settings.theme.import.applied');
  });

  it('Apply with unsaved edits asks first: keeping them writes nothing; discarding applies, and an edit made meanwhile stays', async () => {
    await open();
    await setColor('canvas', '#fdfdfd');
    await typeTemplate(template('manuscript'));
    await click(buttonNamed('settings.theme.previewImport'));
    await vi.waitFor(() => expect(importResult()).not.toBeNull());
    await click(buttonNamed('settings.theme.applyImport'));
    await answer('keep');
    expect(server.imports.filter((entry) => entry.apply)).toHaveLength(0);
    expect(color('canvas').value).toBe('#fdfdfd');

    const held = gate();
    server.holdImport = held.promise;
    await click(buttonNamed('settings.theme.applyImport'));
    await answer('discard');
    await vi.waitFor(() => expect(server.imports.filter((entry) => entry.apply)).toHaveLength(1));
    // While the apply is in flight the form can't save over it…
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    });
    // …and an edit made now is newer than the discard the person agreed to.
    await appearance('light');
    await held.open();
    await vi.waitFor(() => expect(importResult()?.dataset.importResult).toBe('applied'));
    await finished();
    expect(server.patches).toHaveLength(0);
    expect(shownAppearance()).toBe('settings.styling.theme.light');
    expect(region()).not.toBeNull();
  });

  it('Apply with unsaved edits, discarded and untouched since, leaves a clean draft on the applied theme', async () => {
    await open();
    await setColor('canvas', '#fdfdfd');
    await typeTemplate(template('manuscript'));
    await click(buttonNamed('settings.theme.previewImport'));
    await vi.waitFor(() => expect(importResult()).not.toBeNull());
    await click(buttonNamed('settings.theme.applyImport'));
    await answer('discard');
    await vi.waitFor(() => expect(importResult()?.dataset.importResult).toBe('applied'));
    await finished();
    expect(activePreset()).toBe('manuscript');
    expect(region()).toBeNull();
    expect(undoButton().disabled).toBe(true);
  });

  it('a slow file read never overwrites text typed since, and a late preview never reaches another site', async () => {
    await open();
    let release!: (text: string) => void;
    const file = {
      size: 10,
      text: () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    };
    const input = container.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await typeTemplate('typed');
    await act(async () => release(template('harbor')));
    expect(textarea().value).toBe('typed');

    await typeTemplate(template('manuscript'));
    const held = gate();
    server.holdImport = held.promise;
    await click(buttonNamed('settings.theme.previewImport'));
    await act(async () => showSite('site-2'));
    await settle();
    await held.open();
    await settle();
    expect(importResult()).toBeNull();
    expect(textarea().value).toBe('');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a late apply for one site neither toasts on another nor leaves its form locked', async () => {
    await open();
    await typeTemplate(template('manuscript'));
    await click(buttonNamed('settings.theme.previewImport'));
    await vi.waitFor(() => expect(importResult()).not.toBeNull());
    const held = gate();
    server.holdImport = held.promise;
    await click(buttonNamed('settings.theme.applyImport'));
    await vi.waitFor(() => expect(server.imports.filter((entry) => entry.apply)).toHaveLength(1));
    await act(async () => showSite('site-2'));
    await settle();
    await held.open();
    await finished();
    expect(toast.success).not.toHaveBeenCalled();
    expect(importResult()).toBeNull();
    await preset('signal');
    await save();
    expect(server.patches.map((entry) => entry.site)).toStrictEqual(['site-2']);
    expect(storedTheme('site-1')).toMatchObject({ preset: 'manuscript' });
  });

  it('Export downloads what the server stores, never the unsaved draft', async () => {
    await open();
    await preset('manuscript');
    await click(buttonNamed('settings.theme.export'));
    await vi.waitFor(() => expect(downloads).toHaveLength(1));
    const exported = JSON.parse(await (downloads[0] as Blob).text());
    expect(exported.config.theme.preset).toBe('signal');
    expect(server.exports).toBe(1);
    expect(server.patches).toHaveLength(0);
  });
});

describe('StrictMode', () => {
  it('saves once and resets per site', async () => {
    await open(undefined, true);
    await preset('manuscript');
    await save();
    expect(server.patches).toHaveLength(1);
    await act(async () => showSite('site-2'));
    await settle();
    expect(activePreset()).toBe('manuscript');
    expect(shownAppearance()).toBe('settings.styling.theme.light');
    expect(undoButton().disabled).toBe(true);
  });
});
