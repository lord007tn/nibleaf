// @vitest-environment jsdom
import { updateWorkspaceSettingsBody } from '@nibleaf/validators';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigDirtyProvider } from '@/components/project-settings/shared';
import { GitTab } from '@/components/settings/git-tab';
import { queryKeys } from '@/hooks/api/query-keys';

/**
 * The repository form inside the real GitTab, over the real settings query and
 * mutations. Behind `fetch`, a stand-in settings API runs the real body
 * validator, then stores what main's server stores: the PATCH replaces `git`
 * wholesale with the validated object, carries the import and push-sync
 * bookkeeping over, and keeps the webhook secret apart (the GET returns it to
 * an admin). apps/server/src/actions/workspace.git-connection.test.ts runs
 * these payloads through the server's own merge and read.
 */
type Site = 'site-a' | 'site-b';
const SERVER_MANAGED = ['lastImportedAt', 'lastSyncAt', 'lastSyncStatus', 'lastSyncError'] as const;
let db: { git: Record<string, Record<string, unknown>>; secrets: Record<string, string> };
const readSettings = (site: string) => ({
  plan: 'free',
  notifications: {},
  integrations: {},
  git: { ...db.git[site], ...(db.secrets[site] ? { webhookSecret: db.secrets[site] } : {}) },
  name: 'Acme',
  slug: 'acme',
  projectCount: 2,
  memberCount: 1,
});

const ui = vi.hoisted(() => ({
  locale: 'en',
  branches: [] as Array<{ id: string; name: string }> | undefined,
  toast: { success: vi.fn(), error: vi.fn() },
  confirm: vi.fn(),
}));
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, vars?: Record<string, string>) => `${ui.locale}:${key}${vars ? `:${Object.values(vars).join('|')}` : ''}`,
  translateFn: (key: string) => key,
}));
vi.mock('sonner', () => ({ toast: ui.toast }));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => ui.confirm }));
vi.mock('@tanstack/react-router', () => ({ useBlocker: () => undefined }));
vi.mock('@/services/api-origin', () => ({ apiOrigin: () => 'http://dashboard.test' }));
vi.mock('@/components/settings/git-workflow', () => ({ GitWorkflow: () => null }));
vi.mock('./git-pipeline', () => ({ GitPipeline: () => null }));
vi.mock('@/hooks/api', async (original) => ({
  ...(await original<typeof import('@/hooks/api')>()),
  useBranches: () => ({ data: ui.branches }),
  useLanguages: () => ({ data: [{ id: 'fr', code: 'fr', label: 'Français' }] }),
  useGitWorkflow: () => ({ data: null, isPending: false }),
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
Element.prototype.scrollIntoView = vi.fn();

let api: {
  patches: Array<{ site: string; body: { git: Record<string, unknown> } }>;
  reads: Record<string, number>;
  holdPatch?: Promise<void>;
  failPatch: number;
  failReads: Set<string>;
};

function stubApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const [, , , , site, rest] = new URL(request.url).pathname.split('/');
      if (rest !== 'settings' || !site) return Response.json({ error: { message: 'unexpected' } }, { status: 404 });
      if (request.method === 'GET') {
        api.reads[site] = (api.reads[site] ?? 0) + 1;
        if (api.failReads.has(site)) return Response.json({ error: { message: 'offline' } }, { status: 503 });
        return Response.json({ data: readSettings(site) });
      }
      const body = await request.json();
      api.patches.push({ site, body });
      await api.holdPatch;
      if (api.failPatch > 0) {
        api.failPatch -= 1;
        return Response.json({ error: { message: 'Could not save.' } }, { status: 500 });
      }
      const parsed = updateWorkspaceSettingsBody.safeParse(body);
      if (!parsed.success) return Response.json({ error: { message: 'Invalid settings.' } }, { status: 400 });
      const previous = db.git[site] ?? {};
      const next: Record<string, unknown> = { ...parsed.data.git };
      for (const key of SERVER_MANAGED) if (next[key] === undefined && previous[key] !== undefined) next[key] = previous[key];
      db.git[site] = JSON.parse(JSON.stringify(next));
      return Response.json({ data: readSettings(site) });
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

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
let dirty: Set<string>;

const STORED = {
  connected: true,
  provider: 'github',
  repo: 'team/docs',
  branch: 'main',
  path: 'docs',
  autoPublish: false,
  lastImportedAt: '2026-11-01T08:00:00.000Z',
  lastSyncAt: '2026-11-02T08:00:00.000Z',
  lastSyncStatus: 'failed',
  lastSyncError: 'Could not read docs/intro.md',
};

beforeEach(() => {
  db = {
    git: { 'site-a': { ...STORED }, 'site-b': { ...STORED, repo: 'team/handbook', path: 'handbook' } },
    secrets: { 'site-a': 'f00d', 'site-b': 'beef' },
  };
  api = { patches: [], reads: {}, failPatch: 0, failReads: new Set() };
  ui.locale = 'en';
  ui.branches = [];
  ui.toast.success.mockReset();
  ui.toast.error.mockReset();
  ui.confirm.mockReset();
  stubApi();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 }, mutations: { retry: false } } });
  dirty = new Set();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

/** The settings page: one GitTab per site, keyed by it as the route does (`keyed: false` keeps one instance). */
const show = (site: Site, { keyed = true } = {}) =>
  act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ConfigDirtyProvider report={(id, changed) => (changed ? dirty.add(id) : dirty.delete(id))}>
          <GitTab key={keyed ? `git-${site}` : 'git'} projectId={site} />
        </ConfigDirtyProvider>
      </QueryClientProvider>,
    ),
  );
async function open(site: Site = 'site-a', options?: { keyed?: boolean }) {
  await show(site, options);
  await vi.waitFor(() => expect(host.querySelector('#git-repo, #git-clone-url')).not.toBeNull());
  await settle();
}
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 20)));

const field = (id: string) => {
  const element = host.querySelector<HTMLInputElement>(`#${id}`);
  if (!element) throw new Error(`No #${id}`);
  return element;
};
const type = (id: string, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field(id), value);
    field(id).dispatchEvent(new Event('input', { bubbles: true }));
  });
const button = (label: string) => [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === `en:${label}`);
const pick = (provider: 'GitHub' | 'GitLab' | 'en:settings.git.provider.git.name') =>
  act(async () => [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === provider)?.click());
const submitButton = () => host.querySelector<HTMLButtonElement>('form button[type="submit"]') as HTMLButtonElement;
/** Enter in a field: the keydown, then the browser's implicit submission in the same task. */
const pressEnter = (id: string, init: KeyboardEventInit = {}) =>
  act(async () => {
    const input = field(id);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }));
    input.form?.requestSubmit();
  });
const save = () => pressEnter('git-repo');
const refetch = async (site: Site = 'site-a') => {
  await act(async () => client.invalidateQueries({ queryKey: queryKeys.workspace.projectSettings(site) }));
  await settle();
};
const sent = (index = -1) => api.patches.at(index)?.body.git;
const shown = () => ({
  repo: host.querySelector<HTMLInputElement>('#git-repo')?.value,
  cloneUrl: host.querySelector<HTMLInputElement>('#git-clone-url')?.value,
  instanceUrl: host.querySelector<HTMLInputElement>('#git-instance-url')?.value,
  branch: field('git-branch').value,
  path: field('git-path').value,
});
const toggleAutoPublish = () => host.querySelector<HTMLElement>('[role="switch"]')?.click();
/**
 * The auto-publish toggle (main's instant save, out of this form's scope) sends
 * the stored connection with main's display defaults filled in, among them a
 * blank clone URL the validator refuses. A stored clone URL lets it save.
 */
const SAVABLE_BY_TOGGLE = { cloneUrl: 'https://git.example.com/team/docs.git' };
const conflict = () => host.textContent?.includes('en:forms.changedElsewhere') ?? false;

describe('a refetch keeps the person’s edits (main reset every field)', () => {
  it('keeps a dirty repository and path through another writer’s branch change, and takes the branch', async () => {
    await open();
    await type('git-repo', 'team/handbook');
    await type('git-path', 'guides');
    db.git['site-a'] = { ...db.git['site-a'], branch: 'release' };
    await refetch();
    // Main: repo "team/docs", path "docs", dirty false.
    expect(shown()).toMatchObject({ repo: 'team/handbook', path: 'guides', branch: 'release' });
    expect(dirty.size).toBeGreaterThan(0);
    expect(conflict()).toBe(false);
  });

  it('keeps a picked provider and its fields through a refetch that changes auto publish', async () => {
    await open();
    await pick('GitLab');
    await type('git-instance-url', 'https://git.example.com');
    db.git['site-a'] = { ...db.git['site-a'], autoPublish: true };
    await refetch();
    expect(field('git-instance-url').value).toBe('https://git.example.com');
    expect(dirty.size).toBeGreaterThan(0);
  });
});

describe('what a repository save sends, through the real validator and merge', () => {
  it('GitHub, from a GitLab connection: clears the instance, keeps flags, bookkeeping and the secret', async () => {
    db.git['site-a'] = {
      ...STORED,
      provider: 'gitlab',
      repo: 'group/docs',
      instanceUrl: 'https://git.example.com',
      autoPublish: true,
      importBranchId: 'b1',
    };
    ui.branches = [{ id: 'b1', name: 'Draft' }];
    await open();
    await pick('GitHub');
    await type('git-repo', '  team/docs  ');
    await type('git-branch', '  ');
    await save();
    await settle();
    expect(sent()).toEqual({
      provider: 'github',
      repo: 'team/docs',
      branch: 'main',
      path: 'docs',
      importBranchId: 'b1',
      connected: true,
      autoPublish: true,
    });
    expect(db.git['site-a']).toEqual({
      provider: 'github',
      repo: 'team/docs',
      branch: 'main',
      path: 'docs',
      importBranchId: 'b1',
      connected: true,
      autoPublish: true,
      lastImportedAt: STORED.lastImportedAt,
      lastSyncAt: STORED.lastSyncAt,
      lastSyncStatus: 'failed',
      lastSyncError: STORED.lastSyncError,
    });
    expect(db.secrets['site-a']).toBe('f00d');
  });

  it('GitLab: a blank instance and branch are saved with their defaults', async () => {
    await open();
    await pick('GitLab');
    await type('git-repo', 'group/docs');
    await type('git-instance-url', ' ');
    await type('git-branch', '');
    await save();
    await settle();
    expect(sent()).toEqual({
      provider: 'gitlab',
      repo: 'group/docs',
      instanceUrl: 'https://gitlab.com',
      branch: 'main',
      path: 'docs',
      connected: true,
      autoPublish: false,
    });
    expect(db.git['site-a']).toMatchObject({ provider: 'gitlab', instanceUrl: 'https://gitlab.com', branch: 'main' });
  });

  it('Git URL: sends the clone URL and clears the repository; a blank path stays blank', async () => {
    await open();
    await pick('en:settings.git.provider.git.name');
    await type('git-clone-url', ' https://git.example.com/team/docs.git ');
    await type('git-path', '  ');
    await pressEnter('git-clone-url');
    await settle();
    expect(sent()).toEqual({
      provider: 'git',
      cloneUrl: 'https://git.example.com/team/docs.git',
      branch: 'main',
      path: '',
      connected: true,
      autoPublish: false,
    });
    expect(db.git['site-a']).not.toHaveProperty('repo');
    // The read-back is the save's own echo: nothing left to save.
    expect(dirty.size).toBe(0);
    expect(ui.toast.success).toHaveBeenCalledWith('en:settings.git.repoSaved');
  });

  it('reads a normalized echo back as clean, and the fields show what was stored', async () => {
    await open();
    await type('git-repo', '  team/handbook ');
    await type('git-path', ' guides ');
    await save();
    await settle();
    expect(shown()).toMatchObject({ repo: 'team/handbook', path: 'guides' });
    expect(dirty.size).toBe(0);
    expect(ui.toast.success).toHaveBeenCalledOnce();
    expect(submitButton().getAttribute('aria-busy')).toBeNull();
  });

  it('sends the auto publish a refetch brought in while the repository was being edited', async () => {
    await open();
    await type('git-repo', 'team/handbook');
    db.git['site-a'] = { ...db.git['site-a'], autoPublish: true };
    await refetch();
    await save();
    await settle();
    expect(sent()).toMatchObject({ repo: 'team/handbook', autoPublish: true });
    expect(db.git['site-a']).toMatchObject({ autoPublish: true, connected: true, lastSyncStatus: 'failed' });
  });

  it('reads the settings again before saving when a failed refetch left them stale, so auto publish is never flipped back', async () => {
    await open();
    await type('git-repo', 'team/handbook');
    db.git['site-a'] = { ...db.git['site-a'], autoPublish: true };
    api.failReads.add('site-a');
    await refetch();
    api.failReads.clear();
    const reads = api.reads['site-a'];
    await save();
    await settle();
    expect(api.reads['site-a']).toBeGreaterThan(reads ?? 0);
    expect(sent()).toMatchObject({ autoPublish: true });
    expect(db.git['site-a']?.autoPublish).toBe(true);
  });

  it('toggling auto publish beside a dirty repository edit keeps the edit, and the save keeps the toggle', async () => {
    db.git['site-a'] = { ...STORED, ...SAVABLE_BY_TOGGLE };
    await open();
    await type('git-repo', 'team/handbook');
    await act(async () => toggleAutoPublish());
    await settle();
    expect(db.git['site-a']).toMatchObject({ autoPublish: true, repo: 'team/docs' });
    expect(field('git-repo').value).toBe('team/handbook');
    await save();
    await settle();
    expect(db.git['site-a']).toMatchObject({ autoPublish: true, repo: 'team/handbook' });
  });

  it('keeps an import branch the options no longer list, and does not dirty the draft while options load', async () => {
    db.git['site-a'] = { ...STORED, importBranchId: 'b-removed', importLanguageId: 'fr' };
    ui.branches = undefined;
    await open();
    expect(dirty.size).toBe(0);
    ui.branches = [{ id: 'b1', name: 'Draft' }];
    await show('site-a');
    await settle();
    expect(dirty.size).toBe(0);
    await type('git-path', 'guides');
    await save();
    await settle();
    expect(sent()).toMatchObject({ importBranchId: 'b-removed', importLanguageId: 'fr', path: 'guides' });
  });
});

describe('the save lifecycle', () => {
  it('a refused save keeps every value, and a retry sends the current ones', async () => {
    await open();
    await type('git-repo', 'team/handbook');
    api.failPatch = 1;
    await save();
    await settle();
    expect(ui.toast.error).toHaveBeenCalledWith('en:settings.git.saveError');
    expect(shown()).toMatchObject({ repo: 'team/handbook' });
    expect(dirty.size).toBeGreaterThan(0);
    // A refetch after the failure keeps the failed values too (main reset them on any change).
    db.git['site-a'] = { ...db.git['site-a'], branch: 'release' };
    await refetch();
    expect(shown()).toMatchObject({ repo: 'team/handbook', branch: 'release' });
    await type('git-path', 'guides');
    await save();
    await settle();
    expect(sent()).toMatchObject({ repo: 'team/handbook', path: 'guides', branch: 'release' });
    expect(api.patches).toHaveLength(2);
    expect(dirty.size).toBe(0);
    expect(ui.toast.success).toHaveBeenCalledOnce();
  });

  it('an edit made during the save stays, dirty, and "saved" does not show', async () => {
    await open();
    await type('git-repo', 'team/handbook');
    const hold = gate();
    api.holdPatch = hold.promise;
    await save();
    expect(submitButton().getAttribute('aria-busy')).toBe('true');
    await type('git-path', 'guides');
    // Enter again during the save sends nothing.
    await save();
    expect(api.patches).toHaveLength(1);
    await hold.open();
    await settle();
    expect(shown()).toMatchObject({ repo: 'team/handbook', path: 'guides' });
    expect(db.git['site-a']).toMatchObject({ repo: 'team/handbook', path: 'docs' });
    expect(dirty.size).toBeGreaterThan(0);
    expect(ui.toast.success).not.toHaveBeenCalled();
    expect(button('forms.discard')).toBeDefined();
  });

  it('shows another writer’s change to an edited field as a conflict: Use their version', async () => {
    await open();
    await type('git-repo', 'team/handbook');
    db.git['site-a'] = { ...db.git['site-a'], repo: 'team/manual' };
    await refetch();
    expect(conflict()).toBe(true);
    expect(field('git-repo').value).toBe('team/handbook');
    await act(async () => button('forms.useTheirs')?.click());
    expect(field('git-repo').value).toBe('team/manual');
    expect(conflict()).toBe(false);
    expect(dirty.size).toBe(0);
  });

  it('a conflict: Keep mine, then save sends mine', async () => {
    await open();
    await type('git-repo', 'team/handbook');
    db.git['site-a'] = { ...db.git['site-a'], repo: 'team/manual' };
    await refetch();
    await act(async () => button('forms.keepMine')?.click());
    expect(conflict()).toBe(false);
    await save();
    await settle();
    expect(sent()).toMatchObject({ repo: 'team/handbook' });
    expect(dirty.size).toBe(0);
  });

  it('Discard returns the provider and every field to what is stored', async () => {
    await open();
    await pick('en:settings.git.provider.git.name');
    await type('git-clone-url', 'https://git.example.com/a.git');
    await act(async () => button('forms.discard')?.click());
    expect(host.querySelector('#git-clone-url')).toBeNull();
    expect(shown()).toMatchObject({ repo: 'team/docs', path: 'docs' });
    expect(dirty.size).toBe(0);
  });

  it('waits for an instant write in flight instead of racing it', async () => {
    db.git['site-a'] = { ...STORED, ...SAVABLE_BY_TOGGLE };
    await open();
    await type('git-repo', 'team/handbook');
    const hold = gate();
    api.holdPatch = hold.promise;
    await act(async () => toggleAutoPublish());
    // The toggle's write shows as busy on the repository form's Save too (TanStack reports it on its next tick).
    await vi.waitFor(() => expect(submitButton().getAttribute('aria-busy')).toBe('true'));
    await save();
    // Only the toggle's PATCH: the repository save never started.
    expect(api.patches).toHaveLength(1);
    expect(sent()).toMatchObject({ autoPublish: true, repo: 'team/docs' });
    await hold.open();
    await settle();
    api.holdPatch = undefined;
    await save();
    await settle();
    expect(sent()).toMatchObject({ autoPublish: true, repo: 'team/handbook' });
  });
});

describe('identity: the site, never the locale', () => {
  it('keeps the draft through a dashboard language change on the same site', async () => {
    await open();
    await type('git-repo', 'team/handbook');
    ui.locale = 'ar';
    await show('site-a');
    await settle();
    expect(host.textContent).toContain('ar:settings.git.repoUrl');
    expect(field('git-repo').value).toBe('team/handbook');
    expect(dirty.size).toBeGreaterThan(0);
  });

  it('site A → B → A: B starts from its own settings, A’s late answer refreshes only A and says nothing on B', async () => {
    await open('site-a');
    await type('git-repo', 'team/handbook');
    const hold = gate();
    api.holdPatch = hold.promise;
    await save();
    await open('site-b');
    expect(shown()).toMatchObject({ repo: 'team/handbook', path: 'handbook' });
    expect(dirty.size).toBe(0);
    const readsB = api.reads['site-b'];
    await hold.open();
    await settle();
    expect(api.reads['site-b']).toBe(readsB);
    expect(ui.toast.success).not.toHaveBeenCalled();
    expect(ui.toast.error).not.toHaveBeenCalled();
    expect(shown()).toMatchObject({ path: 'handbook' });
    api.holdPatch = undefined;
    await open('site-a');
    expect(shown()).toMatchObject({ repo: 'team/handbook', path: 'docs' });
    expect(dirty.size).toBe(0);
  });

  it('A → B → A while A’s save is still running: the new A form waits for it, then shows its result', async () => {
    await open('site-a');
    await type('git-repo', 'team/handbook');
    const hold = gate();
    api.holdPatch = hold.promise;
    await save();
    await open('site-b');
    await open('site-a');
    expect(submitButton().getAttribute('aria-busy')).toBe('true');
    await type('git-path', 'guides');
    await save();
    expect(api.patches).toHaveLength(1);
    await hold.open();
    await settle();
    expect(shown()).toMatchObject({ repo: 'team/handbook', path: 'guides' });
    expect(ui.toast.success).not.toHaveBeenCalled();
  });

  it('one GitTab moved to another site: the old save is obsolete there, and a failure says nothing', async () => {
    await act(async () => client.prefetchQuery({ queryKey: queryKeys.workspace.projectSettings('site-b'), queryFn: () => readSettings('site-b') }));
    await open('site-a', { keyed: false });
    await type('git-repo', 'team/handbook');
    const hold = gate();
    api.holdPatch = hold.promise;
    api.failPatch = 1;
    await save();
    await show('site-b', { keyed: false });
    await settle();
    expect(shown()).toMatchObject({ repo: 'team/handbook', path: 'handbook' });
    const readsB = api.reads['site-b'] ?? 0;
    await hold.open();
    await settle();
    expect(ui.toast.error).not.toHaveBeenCalled();
    // The failure marks site A's settings for a fresh read (nothing shows it now), never site B's.
    expect(api.reads['site-b'] ?? 0).toBe(readsB);
    expect(client.getQueryState(queryKeys.workspace.projectSettings('site-a'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(queryKeys.workspace.projectSettings('site-b'))?.isInvalidated).toBe(false);
    expect(shown()).toMatchObject({ repo: 'team/handbook', path: 'handbook' });
  });
});

describe('Enter, IME, focus and validation', () => {
  it('an Enter that confirms an IME composition saves nothing; the next plain Enter saves', async () => {
    await open();
    await type('git-repo', 'team/handbook');
    await pressEnter('git-repo', { isComposing: true });
    await pressEnter('git-repo', { keyCode: 229 } as KeyboardEventInit);
    await settle();
    expect(api.patches).toHaveLength(0);
    await pressEnter('git-repo');
    await settle();
    expect(api.patches).toHaveLength(1);
    // Focus stays where the person pressed Enter.
    expect(document.activeElement).toBe(field('git-repo'));
  });

  it('two submits in one tick send once', async () => {
    await open();
    await type('git-repo', 'team/handbook');
    await act(async () => {
      field('git-repo').form?.requestSubmit();
      field('git-repo').form?.requestSubmit();
    });
    await settle();
    expect(api.patches).toHaveLength(1);
  });

  it('a blank repository sends nothing, says why on the field and moves focus there', async () => {
    await open();
    await type('git-repo', ' ');
    await act(async () => submitButton().click());
    await settle();
    expect(api.patches).toHaveLength(0);
    expect(field('git-repo').getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('git-repo-error')?.textContent).toBe('en:validation.required:en:settings.git.repoUrl');
    expect(document.activeElement).toBe(field('git-repo'));
    await type('git-repo', 'team/handbook');
    expect(field('git-repo').getAttribute('aria-invalid')).toBeNull();
  });

  it('keeps the problem visible through an unsettled success, and hides it after a settled one', async () => {
    await open();
    await type('git-repo', '');
    await act(async () => submitButton().click());
    await type('git-repo', 'team/handbook');
    const hold = gate();
    api.holdPatch = hold.promise;
    await save();
    // Cleared again while the save runs: the try already happened, so it shows at once.
    await type('git-repo', '');
    expect(field('git-repo').getAttribute('aria-invalid')).toBe('true');
    await hold.open();
    await settle();
    expect(field('git-repo').getAttribute('aria-invalid')).toBe('true');
    api.holdPatch = undefined;
    await type('git-repo', 'team/manual');
    await save();
    await settle();
    expect(dirty.size).toBe(0);
    await type('git-repo', '');
    // A fresh draft: nothing shows until the field is left or a save is tried.
    expect(field('git-repo').getAttribute('aria-invalid')).toBeNull();
  });

  it('starts hidden again on another site', async () => {
    await act(async () => client.prefetchQuery({ queryKey: queryKeys.workspace.projectSettings('site-b'), queryFn: () => readSettings('site-b') }));
    await open('site-a', { keyed: false });
    await type('git-repo', '');
    await act(async () => submitButton().click());
    expect(field('git-repo').getAttribute('aria-invalid')).toBe('true');
    await show('site-b', { keyed: false });
    await settle();
    await type('git-repo', '');
    expect(field('git-repo').getAttribute('aria-invalid')).toBeNull();
    await act(async () => field('git-repo').dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(field('git-repo').getAttribute('aria-invalid')).toBe('true');
  });
});
