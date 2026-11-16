// @vitest-environment jsdom
import { updateWorkspaceSettingsBody } from '@nibleaf/validators';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigDirtyProvider } from '@/components/project-settings/shared';
import { GitTab } from './git-tab';

/**
 * The Git tab's instant writes (auto publish, Disconnect, and the new
 * connection switching the legacy import off) in the real GitTab, over the real
 * settings query and `useWriteGitSettings`. Behind `fetch`, a stand-in settings
 * API keeps each PATCH body as sent, runs the real body validator (answering
 * 422 or 500 as the route does), then stores what the server stores: `git` replaced wholesale with
 * the validated object, the import and push-sync bookkeeping carried over, and
 * the webhook secret kept apart (the GET returns it to an admin).
 * apps/server/src/actions/workspace.git-connection.test.ts runs the same
 * payloads through the server's own merge and read.
 */
type Site = 'site-a' | 'site-b';
const SERVER_MANAGED = ['lastImportedAt', 'lastSyncAt', 'lastSyncStatus', 'lastSyncError'] as const;
const BOOKKEEPING = {
  lastImportedAt: '2026-11-01T08:00:00.000Z',
  lastSyncAt: '2026-11-02T08:00:00.000Z',
  lastSyncStatus: 'failed',
  lastSyncError: 'Could not read docs/intro.md',
};
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
  toast: { success: vi.fn(), error: vi.fn() },
  confirm: vi.fn(),
  workflow: null as Record<string, unknown> | null,
  onConnected: undefined as (() => void) | undefined,
}));
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, vars?: Record<string, string>) => `en:${key}${vars ? `:${Object.values(vars).join('|')}` : ''}`,
  translateFn: (key: string) => key,
}));
vi.mock('sonner', () => ({ toast: ui.toast }));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => ui.confirm }));
vi.mock('@tanstack/react-router', () => ({ useBlocker: () => undefined }));
vi.mock('@/services/api-origin', () => ({ apiOrigin: () => 'http://dashboard.test' }));
// The per-site connection is out of scope: only the hand-off it calls when it connects.
vi.mock('./git-workflow', () => ({
  GitWorkflow: ({ onConnected }: { onConnected?: () => void }) => {
    ui.onConnected = onConnected;
    return null;
  },
}));
vi.mock('@/features/site-git/components/git-pipeline', () => ({ GitPipeline: () => null }));
vi.mock('@/hooks/api', async (original) => ({
  ...(await original<typeof import('@/hooks/api')>()),
  useBranches: () => ({ data: [] }),
  useLanguages: () => ({ data: [] }),
  useGitWorkflow: () => ({ data: ui.workflow, isPending: false }),
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
Element.prototype.scrollIntoView = vi.fn();

let api: {
  /** Each PATCH: the body as sent, and the validator's result (`undefined` when it refused it). */
  patches: Array<{ site: string; body: { git: Record<string, unknown> }; parsed?: { git?: Record<string, unknown> }; status: number }>;
  reads: Record<string, number>;
  holdPatch?: Promise<void>;
  failPatch: number;
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
        return Response.json({ data: readSettings(site) });
      }
      const body = await request.json();
      const patch: (typeof api.patches)[number] = { site, body, status: 0 };
      api.patches.push(patch);
      await api.holdPatch;
      if (api.failPatch > 0) {
        api.failPatch -= 1;
        patch.status = 500;
        return Response.json({ error: { message: 'Could not save.' } }, { status: 500 });
      }
      // As the route answers: 422 for a body the validator refuses, 500 when it throws (a blank clone
      // or instance URL reaches its `new URL()` refinement).
      let parsed: ReturnType<typeof updateWorkspaceSettingsBody.safeParse>;
      try {
        parsed = updateWorkspaceSettingsBody.safeParse(body);
      } catch {
        patch.status = 500;
        return Response.json({ error: { code: 'http:internal', message: 'Internal error.' } }, { status: 500 });
      }
      if (!parsed.success) {
        patch.status = 422;
        return Response.json({ error: { code: 'validation:failed', message: 'Validation failed.' } }, { status: 422 });
      }
      patch.parsed = parsed.data;
      patch.status = 200;
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

/**
 * Stored legacy connections, one per provider, each with only its own address
 * (no stored clone URL for GitHub and GitLab, no repository for a Git URL),
 * the shapes main's display defaults broke (#780: a blank clone URL made the
 * validator throw, a 500; a blank repository, a 422). Between them: `autoPublish` false,
 * true and unset, a blank content path, a self-hosted GitLab instance, and an
 * import branch and language.
 */
const CONNECTIONS = {
  github: { connected: true, provider: 'github', repo: 'team/docs', branch: 'main', path: 'docs', autoPublish: false },
  gitlab: {
    connected: true,
    provider: 'gitlab',
    repo: 'group/docs',
    instanceUrl: 'https://git.example.com',
    branch: 'release',
    path: '',
    importBranchId: 'b1',
    importLanguageId: 'fr',
    autoPublish: true,
  },
  git: { connected: true, provider: 'git', cloneUrl: 'https://git.example.com/team/docs.git', branch: 'main', path: 'guides' },
} as const;
type Provider = keyof typeof CONNECTIONS;

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
let dirty: Set<string>;

beforeEach(() => {
  db = {
    git: { 'site-a': { ...CONNECTIONS.github, ...BOOKKEEPING }, 'site-b': { ...CONNECTIONS.github, repo: 'team/handbook', ...BOOKKEEPING } },
    secrets: { 'site-a': 'f00d', 'site-b': 'beef' },
  };
  api = { patches: [], reads: {}, failPatch: 0 };
  ui.toast.success.mockReset();
  ui.toast.error.mockReset();
  ui.confirm.mockReset();
  ui.confirm.mockResolvedValue(true);
  ui.workflow = null;
  ui.onConnected = undefined;
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

/** The settings page: one GitTab per site, keyed by it as the route does. */
const show = (site: Site) =>
  act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ConfigDirtyProvider report={(id, changed) => (changed ? dirty.add(id) : dirty.delete(id))}>
          <GitTab key={`git-${site}`} projectId={site} />
        </ConfigDirtyProvider>
      </QueryClientProvider>,
    ),
  );
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
async function open(site: Site = 'site-a') {
  await show(site);
  await vi.waitFor(() => expect(host.querySelector('#git-repo, #git-clone-url')).not.toBeNull());
  await settle();
}
const button = (label: string) => [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === `en:${label}`);
const autoPublishSwitch = () => host.querySelector<HTMLElement>('[role="switch"]');
const legacy = () => host.querySelector('[data-testid="git-legacy"]');
const type = (id: string, value: string) =>
  act(async () => {
    const input = host.querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const sent = (index = -1) => api.patches.at(index);

/** The three instant writes, as the person (or the new connection) triggers them. */
const ACTIONS = {
  'auto publish': {
    run: () => act(async () => autoPublishSwitch()?.click()),
    change: (stored: Record<string, unknown>) => ({ autoPublish: stored.autoPublish !== true }),
    toast: 'en:settings.git.webhook.autoPublishSaved',
  },
  Disconnect: {
    run: () => act(async () => button('settings.git.disconnect')?.click()),
    change: () => ({ connected: false }),
    toast: 'en:settings.git.disconnectedToast',
  },
  'legacy switch-off': {
    run: () => act(async () => ui.onConnected?.()),
    change: () => ({ connected: false }),
    toast: 'en:settings.git.legacy.switched',
  },
} as const;

/** No body carries the webhook secret (the server keeps it apart). */
const expectNoSecret = (value: unknown) => expect(JSON.stringify(value)).not.toMatch(/f00d|beef|webhookSecret/);

describe('every instant write on every provider, through the real validator and merge (#780)', () => {
  const cases = (Object.keys(CONNECTIONS) as Provider[]).flatMap((provider) =>
    (Object.keys(ACTIONS) as Array<keyof typeof ACTIONS>).map((action) => [provider, action] as const),
  );

  it.each(cases)('%s · %s: stores exactly the stored connection with that one change, and reads it back', async (provider, action) => {
    const stored: Record<string, unknown> = CONNECTIONS[provider];
    db.git['site-a'] = { ...stored, ...BOOKKEEPING };
    const { run, change, toast } = ACTIONS[action];
    await open();
    const readsBefore = api.reads['site-a'] ?? 0;
    await run();
    await settle();

    expect(api.patches).toHaveLength(1);
    const patch = sent();
    // Accepted (main: 500 or 422, from a blank clone URL or repository among its display defaults).
    expect(patch?.status).toBe(200);
    // The serializer, before the validator: the stored client fields with the one change, nothing else.
    expect(patch?.body).toEqual({ git: { ...stored, ...change(stored) } });
    expectNoSecret(patch?.body);
    // After the validator: unchanged by it (no normalization hides a bad body).
    expect(patch?.parsed).toEqual(patch?.body);
    // What the server stores: the change, the connection as it was, the bookkeeping and the secret kept.
    expect(db.git['site-a']).toEqual({ ...stored, ...change(stored), ...BOOKKEEPING });
    expect(db.secrets['site-a']).toBe('f00d');
    // Truthful outcome: the success toast, no error, and the settings read back after it.
    expect(ui.toast.success).toHaveBeenCalledWith(toast);
    expect(ui.toast.error).not.toHaveBeenCalled();
    expect(api.reads['site-a']).toBeGreaterThan(readsBefore);
    if (action === 'auto publish') expect(autoPublishSwitch()?.getAttribute('aria-checked')).toBe(String(stored.autoPublish !== true));
    else expect(legacy()).toBeNull();
  });

  it('Remove (once the new connection replaced the legacy import) sends the same disconnect', async () => {
    db.git['site-a'] = { ...CONNECTIONS.gitlab, ...BOOKKEEPING };
    ui.workflow = { repository: 'team/docs', operations: [] };
    await show('site-a');
    await settle();
    await act(async () => button('settings.git.legacy.remove')?.click());
    await settle();
    expect(sent()?.body).toEqual({ git: { ...CONNECTIONS.gitlab, connected: false } });
    expect(sent()?.parsed).toEqual(sent()?.body);
    expect(db.git['site-a']).toEqual({ ...CONNECTIONS.gitlab, connected: false, ...BOOKKEEPING });
  });

  it('a cancelled Disconnect sends nothing', async () => {
    ui.confirm.mockResolvedValue(false);
    await open();
    await ACTIONS.Disconnect.run();
    await settle();
    expect(api.patches).toHaveLength(0);
  });

  it('the new connection switches nothing off when no legacy import is connected', async () => {
    db.git['site-a'] = { connected: false, provider: 'github', repo: 'team/docs', branch: 'main', path: 'docs' };
    await show('site-a');
    await settle();
    await ACTIONS['legacy switch-off'].run();
    await settle();
    expect(api.patches).toHaveLength(0);
  });
});

describe('what an instant write never sends', () => {
  it('the repository draft: an unsaved provider and fields stay in the form, the toggle sends the stored connection', async () => {
    await open();
    await type('git-repo', 'team/handbook');
    await act(async () => [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'GitLab')?.click());
    await type('git-instance-url', 'https://gitlab.example.org');
    await ACTIONS['auto publish'].run();
    await settle();
    expect(sent()?.body).toEqual({ git: { ...CONNECTIONS.github, autoPublish: true } });
    expect(db.git['site-a']).toMatchObject({ provider: 'github', repo: 'team/docs', autoPublish: true });
    expect(db.git['site-a']).not.toHaveProperty('instanceUrl');
    // The draft is still there, unsaved.
    expect(host.querySelector<HTMLInputElement>('#git-repo')?.value).toBe('team/handbook');
    expect(host.querySelector<HTMLInputElement>('#git-instance-url')?.value).toBe('https://gitlab.example.org');
    expect(dirty.size).toBeGreaterThan(0);
  });

  it('display defaults: an unset branch, path, instance and flag stay unset', async () => {
    db.git['site-a'] = { connected: true, provider: 'gitlab', repo: 'group/docs' };
    await open();
    await ACTIONS['auto publish'].run();
    await settle();
    expect(sent()?.body).toEqual({ git: { connected: true, provider: 'gitlab', repo: 'group/docs', autoPublish: true } });
    expect(sent()?.parsed).toEqual(sent()?.body);
    expect(db.git['site-a']).toEqual({ connected: true, provider: 'gitlab', repo: 'group/docs', autoPublish: true });
  });

  it('another provider’s address left from before, and server-managed fields', async () => {
    db.git['site-a'] = {
      ...CONNECTIONS.github,
      cloneUrl: 'https://git.example.com/team/docs.git',
      instanceUrl: 'https://git.example.com',
      ...BOOKKEEPING,
    };
    await open();
    await ACTIONS.Disconnect.run();
    await settle();
    expect(sent()?.body).toEqual({ git: { ...CONNECTIONS.github, connected: false } });
    expect(db.git['site-a']).toEqual({ ...CONNECTIONS.github, connected: false, ...BOOKKEEPING });
  });
});

describe('the instant write lifecycle', () => {
  it('a refused write changes nothing and refreshes nothing; a retry sends the same body and saves', async () => {
    await open();
    const reads = api.reads['site-a'];
    api.failPatch = 1;
    await ACTIONS['auto publish'].run();
    await settle();
    expect(ui.toast.error).toHaveBeenCalledWith('en:settings.git.saveError');
    expect(ui.toast.success).not.toHaveBeenCalled();
    expect(db.git['site-a']).toMatchObject({ autoPublish: false });
    expect(api.reads['site-a']).toBe(reads);
    expect(autoPublishSwitch()?.getAttribute('aria-checked')).toBe('false');
    // Not retried for the person: they press again.
    expect(api.patches).toHaveLength(1);
    await ACTIONS['auto publish'].run();
    await settle();
    expect(api.patches).toHaveLength(2);
    expect(sent(1)?.body).toEqual(sent(0)?.body);
    expect(db.git['site-a']).toEqual({ ...CONNECTIONS.github, autoPublish: true, ...BOOKKEEPING });
    expect(autoPublishSwitch()?.getAttribute('aria-checked')).toBe('true');
  });

  it('keyed A → B → A with A’s write held: B sends its own connection, the new A waits, and A reads back its result', async () => {
    db.git['site-a'] = { ...CONNECTIONS.git, ...BOOKKEEPING };
    await open('site-a');
    const hold = gate();
    api.holdPatch = hold.promise;
    await ACTIONS['auto publish'].run();
    await vi.waitFor(() => expect(api.patches).toHaveLength(1));
    await open('site-b');
    const readsB = api.reads['site-b'];
    await open('site-a');
    // The remounted A shows the held write: the toggle and Disconnect wait for it.
    expect(autoPublishSwitch()?.hasAttribute('data-disabled')).toBe(true);
    expect(button('settings.git.disconnect')?.getAttribute('aria-busy')).toBe('true');
    await ACTIONS.Disconnect.run();
    expect(api.patches).toHaveLength(1);
    await hold.open();
    await settle();
    api.holdPatch = undefined;
    expect(api.patches[0]).toMatchObject({ site: 'site-a', body: { git: { ...CONNECTIONS.git, autoPublish: true } }, status: 200 });
    expect(db.git['site-a']).toEqual({ ...CONNECTIONS.git, autoPublish: true, ...BOOKKEEPING });
    expect(db.git['site-b']).toMatchObject({ repo: 'team/handbook', autoPublish: false });
    expect(api.reads['site-b']).toBe(readsB);
    expect(autoPublishSwitch()?.getAttribute('aria-checked')).toBe('true');
    // Once it settled, A's Disconnect goes out from A's stored connection.
    await ACTIONS.Disconnect.run();
    await settle();
    expect(sent()).toMatchObject({ site: 'site-a', body: { git: { ...CONNECTIONS.git, autoPublish: true, connected: false } }, status: 200 });
  });
});
