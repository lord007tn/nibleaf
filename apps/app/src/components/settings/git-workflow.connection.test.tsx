// @vitest-environment jsdom
// Connection configuration in GitWorkflow (connected). Real QueryClient (the app's own), the real status query,
// save mutation and component; only the HTTP calls are replaced, and held until the test answers them. No provider
// is reached, and every value is a fictional fixture.
//
// On main e1e90bc3 the host copied the status into the fields from an effect on every new status object: a
// metadata-only refetch (sync state, operations, polling) or the save's own readback wiped edits, and the save sent
// no import targets, which the server then cleared.
import type { MessageKey } from '@nibleaf/i18n';
import { translateFn } from '@nibleaf/i18n';
import { dehydrate, onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  status: vi.fn(),
  put: vi.fn(),
  operations: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: mocks.success } }));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/env', () => ({ env: { VITE_APP_URL: 'https://app.example.test' } }));
vi.mock('@nibleaf/i18n/react', async () => {
  const { translateFn: translate } = await vi.importActual<typeof import('@nibleaf/i18n')>('@nibleaf/i18n');
  return {
    // As the real hook: `t` is bound to the locale it rendered with.
    useLocale: () => {
      const locale = mocks.locale;
      return { locale, t: (key: Parameters<typeof translate>[0], variables?: Parameters<typeof translate>[1]) => translate(key, variables, locale) };
    },
  };
});
vi.mock('@/services/api', () => ({
  api: {
    app: {
      projects: { ':projectId': { git: { $get: mocks.status, connection: { $put: mocks.put }, operations: { $post: mocks.operations } } } },
    },
  },
}));

import { useSaveGitWorkflowConnection } from '@/features/site-git/api/git-workflow-connection';
import { sentGitWorkflowConnectionValues } from '@/features/site-git/model/git-workflow-connection';
import { queryKeys } from '@/hooks/api/query-keys';
import { gitWorkflowQueryOptions } from '@/hooks/api/query-options';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { resetDashboardSession } from '@/integrations/tanstack-query/session-cache';
import { GitWorkflow } from './git-workflow';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

// Fictional, low-entropy fixture token; never a real credential.
const TOKEN = 'fixture-token-0000000000000000';
const NEWER_TOKEN = 'fixture-token-1111111111111111';
const t = (key: MessageKey, variables?: Record<string, string>) => translateFn(key, variables, mocks.locale);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Settings = { repository: string; baseBranch: string; headBranch: string; contentPath: string };
type Stored = Settings & {
  id: string;
  importBranchId: string | null;
  importLanguageId: string | null;
  lastSyncStatus: string;
  operations: unknown[];
};
const SETTINGS: Settings = { repository: 'acme-fixture/docs', baseBranch: 'main', headBranch: 'nibleaf/docs', contentPath: 'docs' };
const TARGETS = { importBranchId: 'branch-fixture-1', importLanguageId: 'language-fixture-1' };
const running = {
  id: 'op-fixture-1',
  kind: 'PULL',
  status: 'RUNNING',
  commitMessage: null,
  changedFiles: null,
  pullRequestNo: null,
  pullRequestUrl: null,
  error: null,
  createdAt: '2026-11-15T09:00:00.000Z',
  conflicts: [],
};
/** Each site's stored connection, as the server holds it now. */
let stored: Record<string, Stored>;
const status = (projectId: string) => ({
  ...stored[projectId],
  credentialConfigured: true,
  webhookConfigured: true,
  lastSyncError: null,
  lastSyncedAt: '2026-11-15T09:00:00.000Z',
  pullRequests: [],
  files: [],
});
const seed = (projectId: string, over: Partial<Stored> = {}) => {
  stored[projectId] = {
    id: `connection-${projectId}`,
    ...SETTINGS,
    repository: `acme-fixture/${projectId}`,
    ...TARGETS,
    lastSyncStatus: 'SUCCEEDED',
    operations: [],
    ...over,
  };
};
/** Someone else changes a site's stored connection. */
const change = (projectId: string, over: Partial<Stored>) => {
  stored[projectId] = { ...(stored[projectId] as Stored), ...over };
};
type PutRequest = { param: { projectId: string }; json: Settings & { importBranchId?: string; importLanguageId?: string; token?: string } };
/**
 * The server's answer to a PUT, built from the request's own body as `connectGitHub` stores it: the settings
 * normalized (`sentGitWorkflowConnectionValues`, which workflow.connect.test.ts proves equal to the real action),
 * the import targets as sent or cleared, and the redacted connection.
 */
const serve = ({ param: { projectId }, json: { token: _token, importBranchId, importLanguageId, ...settings } }: PutRequest) => {
  stored[projectId] = {
    ...(stored[projectId] as Stored),
    ...sentGitWorkflowConnectionValues(settings),
    importBranchId: importBranchId || null,
    importLanguageId: importLanguageId || null,
  };
  return json(200, { data: { connection: { ...stored[projectId], credentialConfigured: true, webhookConfigured: true }, webhookSecret: null } });
};
const lastPut = () => mocks.put.mock.calls.at(-1)?.[0] as PutRequest;
const refused = () => json(400, { error: { message: 'Base branch trunk was not found.' } });

/** Lets requests settle: TanStack tells React on a timer, so each tick gets its own act. */
const settle = async () => {
  for (let tick = 0; tick < 4; tick += 1) await act(async () => new Promise((done) => setTimeout(done, 0)));
};
function held() {
  let resolve: (value: Response) => void = () => undefined;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return {
    promise,
    answer: async (response: Response) => {
      await act(async () => resolve(response));
      await settle();
    },
  };
}

let container: HTMLDivElement;
let root: Root;
let client: ReturnType<typeof createQueryClient>;

const render = async (node: ReactNode) => {
  await act(async () => root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
  await settle();
};
const workflow = (projectId: string, key?: string) => render(<GitWorkflow key={key} projectId={projectId} />);
const buttons = () => [...container.querySelectorAll('button')];
const press = async (element: HTMLElement | undefined) => {
  if (!element) throw new Error('nothing to press');
  await act(async () => element.click());
  await settle();
};
const panel = (label: MessageKey) => press(buttons().find((item) => item.hasAttribute('aria-pressed') && item.textContent?.startsWith(t(label))));
const openConfiguration = async (projectId = 'site-a', key?: string) => {
  await workflow(projectId, key);
  await panel('settings.git.workflow.nav.connection');
};
const form = () => container.querySelector<HTMLInputElement>('#git2-update-repo')?.form as HTMLFormElement;
const saveButton = () => form().querySelector<HTMLButtonElement>('button[type="submit"]') as HTMLButtonElement;
const discardButton = () => buttons().find((item) => item.textContent?.trim() === t('forms.discard'));
const field = (id: string) => {
  const input = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!input) throw new Error(`no #${id}`);
  return input;
};
const type = async (id: string, value: string) => {
  const input = field(id);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
/** Enter in a field: the keydown, then the browser's implicit submission in the same task. */
const pressEnter = async (id: string, init: KeyboardEventInit = {}) => {
  await act(async () => {
    const input = field(id);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }));
    input.form?.requestSubmit();
  });
  await settle();
};
const save = () => press(saveButton());
const shown = () => ({
  repository: field('git2-update-repo').value,
  baseBranch: field('git2-update-base').value,
  headBranch: field('git2-update-head').value,
  contentPath: field('git2-update-path').value,
});
const refetch = async (projectId = 'site-a') => {
  await act(async () => client.invalidateQueries({ queryKey: queryKeys.gitWorkflow.detail(projectId) }));
  await settle();
};
const bodies = () => mocks.put.mock.calls.map(([request]) => request);
const reads = (projectId: string) => mocks.status.mock.calls.filter(([request]) => request.param.projectId === projectId).length;
const conflictShown = () => container.textContent?.includes(t('forms.changedElsewhere')) ?? false;
const successes = () => mocks.success.mock.calls.map(([message]) => message);
const errors = () => mocks.error.mock.calls.map(([message]) => message);
const isBusy = () => saveButton().getAttribute('aria-busy') === 'true';
const refreshButton = () => buttons().find((item) => item.textContent?.trim() === t('common.refresh'));
/** A refusal that echoes what it was sent: the server's message must never reach a cache, the console or a toast. */
const echoed = () => json(400, { error: { message: `Bad credentials: ${TOKEN}` } });
/**
 * Nothing the app keeps holds the token: no mutation at all (the save is a direct request), no query's data or
 * error, no dehydrated state (every mutation and query, or the default), no console line and no toast.
 */
const expectNoTokenKept = () => {
  expect(client.getMutationCache().getAll()).toEqual([]);
  const queries = client.getQueryCache().getAll();
  expect(JSON.stringify(queries.map(({ state }) => [state.data, state.error?.message, String(state.error ?? '')]))).not.toContain(TOKEN);
  expect(JSON.stringify(dehydrate(client, { shouldDehydrateMutation: () => true, shouldDehydrateQuery: () => true }))).not.toContain(TOKEN);
  expect(JSON.stringify(dehydrate(client))).not.toContain(TOKEN);
  const logged = vi
    .mocked(console.error)
    .mock.calls.flat()
    .map((item) => (item instanceof Error ? JSON.stringify({ ...item, message: item.message, cause: String(item.cause ?? '') }) : String(item)));
  expect(logged.join(' ')).not.toContain(TOKEN);
  expect(JSON.stringify([successes(), errors()])).not.toContain(TOKEN);
};

beforeEach(() => {
  mocks.locale = 'en';
  stored = {};
  seed('site-a');
  seed('site-b');
  client = createQueryClient();
  mocks.status.mockReset().mockImplementation(async ({ param }) => json(200, { data: status(param.projectId) }));
  mocks.put.mockReset();
  mocks.operations.mockReset();
  mocks.success.mockReset();
  mocks.error.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('refetches keep edits', () => {
  it('an identical refetch and a sync-state/operations refetch keep a dirty edit (main wiped it on the second)', async () => {
    await openConfiguration();
    await type('git2-update-path', 'guides');
    await refetch();
    expect(shown().contentPath).toBe('guides');

    change('site-a', { lastSyncStatus: 'RUNNING', operations: [running] });
    await refetch();
    await refetch();
    expect(shown()).toEqual({ ...SETTINGS, repository: 'acme-fixture/site-a', contentPath: 'guides' });
    expect(conflictShown()).toBe(false);
    expect(discardButton()).toBeDefined();
  });

  it('a changed value is adopted where untouched, kept where edited, and both-sides changes are a conflict: Use their version', async () => {
    await openConfiguration();
    await type('git2-update-path', 'guides');
    await type('git2-update-base', 'develop');
    change('site-a', { headBranch: 'nibleaf/other', baseBranch: 'trunk' });
    await refetch();
    expect(shown()).toMatchObject({ headBranch: 'nibleaf/other', contentPath: 'guides', baseBranch: 'develop' });
    expect(conflictShown()).toBe(true);

    await press(buttons().find((item) => item.textContent?.trim() === t('forms.useTheirs')));
    expect(shown()).toMatchObject({ baseBranch: 'trunk', contentPath: 'guides' });
    expect(conflictShown()).toBe(false);
  });

  it('Keep mine keeps the edit and saves it', async () => {
    await openConfiguration();
    await type('git2-update-base', 'develop');
    change('site-a', { baseBranch: 'trunk' });
    await refetch();
    await press(buttons().find((item) => item.textContent?.trim() === t('forms.keepMine')));
    expect(conflictShown()).toBe(false);
    expect(shown().baseBranch).toBe('develop');
    mocks.put.mockImplementationOnce(async (request: PutRequest) => serve(request));
    await save();
    expect(bodies()[0]?.json.baseBranch).toBe('develop');
    expect(successes()).toEqual([t('settings.git.workflow.connected')]);
  });

  it('Discard returns to the latest confirmed values and clears a typed token', async () => {
    await openConfiguration();
    await type('git2-update-repo', 'acme-fixture/elsewhere');
    await type('git2-update-token', TOKEN);
    change('site-a', { contentPath: 'content' });
    await refetch();
    await press(discardButton());
    expect(shown()).toEqual({ ...SETTINGS, repository: 'acme-fixture/site-a', contentPath: 'content' });
    expect(field('git2-update-token').value).toBe('');
    expect(discardButton()).toBeUndefined();
  });

  it('switching panel keeps the edits, as main did', async () => {
    await openConfiguration();
    await type('git2-update-path', 'guides');
    await panel('settings.git.workflow.nav.overview');
    await refetch();
    await panel('settings.git.workflow.nav.connection');
    expect(shown().contentPath).toBe('guides');
  });
});

describe('the save', () => {
  it('sends the settings as typed with the latest import targets, keeps an edit made during the save, and says "saved" only when clean', async () => {
    await openConfiguration();
    await type('git2-update-repo', ' https://github.com/acme-fixture/moved.git ');
    const put = held();
    mocks.put.mockImplementationOnce(() => put.promise);
    await save();
    expect(bodies()).toEqual([
      {
        param: { projectId: 'site-a' },
        json: { ...SETTINGS, repository: ' https://github.com/acme-fixture/moved.git ', ...TARGETS },
      },
    ]);
    expect(isBusy()).toBe(true);
    // Enter during the save sends nothing.
    await pressEnter('git2-update-path');
    expect(bodies()).toHaveLength(1);

    await type('git2-update-path', 'typed-during-save');
    await put.answer(serve(lastPut()));
    expect(shown()).toMatchObject({ repository: 'acme-fixture/moved', contentPath: 'typed-during-save' });
    expect(isBusy()).toBe(false);
    expect(discardButton()).toBeDefined();
    expect(successes()).toEqual([]);
    // The success refreshed the site's status, and the readback did not wipe the edit.
    expect(reads('site-a')).toBe(2);
    // The import targets the form never shows are stored as they were.
    expect(stored['site-a']).toMatchObject({ repository: 'acme-fixture/moved', ...TARGETS });
  });

  it('a normalized save reads back as its own echo: clean, "saved" once', async () => {
    await openConfiguration();
    await type('git2-update-repo', 'HTTPS://GITHUB.COM/acme-fixture/site-a.GIT');
    await type('git2-update-base', ' refs/heads/main ');
    await type('git2-update-path', ' /docs\\guides/ ');
    mocks.put.mockImplementationOnce(async (request: PutRequest) => serve(request));
    await save();
    expect(shown()).toEqual({ ...SETTINGS, repository: 'acme-fixture/site-a', contentPath: 'docs/guides' });
    expect(conflictShown()).toBe(false);
    expect(discardButton()).toBeUndefined();
    expect(successes()).toEqual([t('settings.git.workflow.connected')]);
  });

  it('a save while a refresh is in flight waits for it and sends its targets, never an older copy', async () => {
    await openConfiguration();
    await type('git2-update-path', 'guides');
    const read = held();
    mocks.status.mockImplementationOnce(() => read.promise);
    await act(async () => {
      void client.invalidateQueries({ queryKey: queryKeys.gitWorkflow.detail('site-a') });
    });
    mocks.put.mockImplementationOnce(async (request: PutRequest) => serve(request));
    await save();
    expect(bodies()).toHaveLength(0);
    change('site-a', { importBranchId: 'branch-fixture-2', importLanguageId: null });
    await read.answer(json(200, { data: status('site-a') }));
    expect(bodies().map(({ json: body }) => body)).toEqual([
      { ...SETTINGS, repository: 'acme-fixture/site-a', contentPath: 'guides', importBranchId: 'branch-fixture-2' },
    ]);
  });

  it('a refused save keeps the values and the token, reports once, and a retry saves', async () => {
    await openConfiguration();
    await type('git2-update-base', 'trunk');
    await type('git2-update-token', TOKEN);
    mocks.put.mockImplementationOnce(async () => refused());
    await save();
    expect(errors()).toHaveLength(1);
    expect(shown().baseBranch).toBe('trunk');
    expect(field('git2-update-token').value).toBe(TOKEN);
    expect(reads('site-a')).toBe(1);

    mocks.put.mockImplementationOnce(async (request: PutRequest) => serve(request));
    await save();
    expect(bodies()[1]?.json).toEqual({ ...SETTINGS, repository: 'acme-fixture/site-a', baseBranch: 'trunk', ...TARGETS, token: TOKEN });
    expect(field('git2-update-token').value).toBe('');
    expect(successes()).toEqual([t('settings.git.workflow.connected')]);
  });
});

describe('the token', () => {
  it('starts blank and is sent only when typed', async () => {
    await openConfiguration();
    expect(field('git2-update-token').value).toBe('');
    await type('git2-update-token', '   ');
    mocks.put.mockImplementation(async (request: PutRequest) => serve(request));
    await save();
    expect(bodies()[0]?.json).not.toHaveProperty('token');

    await type('git2-update-token', TOKEN);
    const put = held();
    mocks.put.mockImplementationOnce(() => put.promise);
    await save();
    expect(bodies()[1]?.json.token).toBe(TOKEN);
    expectNoTokenKept();
    await put.answer(serve(lastPut()));
    expect(field('git2-update-token').value).toBe('');
  });

  it('a newer token typed during the save is kept, and the form does not say "saved"', async () => {
    await openConfiguration();
    await type('git2-update-token', TOKEN);
    const put = held();
    mocks.put.mockImplementationOnce(() => put.promise);
    await save();
    await type('git2-update-token', NEWER_TOKEN);
    await put.answer(serve(lastPut()));
    expect(field('git2-update-token').value).toBe(NEWER_TOKEN);
    expect(successes()).toEqual([]);
    expect(discardButton()).toBeDefined();
  });
});

describe('the token never stays in a cache', () => {
  it('a refusal that echoes the token: pending, settled, corrected and retried, unmounted, then a session reset', async () => {
    await openConfiguration();
    await type('git2-update-token', TOKEN);
    const put = held();
    mocks.put.mockImplementationOnce(() => put.promise);
    await save();
    expect(bodies()[0]?.json.token).toBe(TOKEN);
    expectNoTokenKept();

    await put.answer(echoed());
    expect(errors()).toEqual([t('settings.git.workflow.connectError')]);
    expect(field('git2-update-token').value).toBe(TOKEN);
    expectNoTokenKept();

    await type('git2-update-token', NEWER_TOKEN);
    mocks.put.mockImplementationOnce(async (request: PutRequest) => serve(request));
    await save();
    expect(bodies()[1]?.json.token).toBe(NEWER_TOKEN);
    expect(field('git2-update-token').value).toBe('');
    expectNoTokenKept();

    await act(async () => root.unmount());
    root = createRoot(container);
    expectNoTokenKept();
    await act(async () => resetDashboardSession(client));
    expectNoTokenKept();
  });

  it('a session reset while the save runs: the answer touches nothing, and nothing keeps the token', async () => {
    await openConfiguration();
    await type('git2-update-token', TOKEN);
    const put = held();
    mocks.put.mockImplementationOnce(() => put.promise);
    await save();
    await act(async () => resetDashboardSession(client));
    expectNoTokenKept();
    await put.answer(echoed());
    expectNoTokenKept();
  });

  it('offline: a save whose status read pauses sends nothing; one sent while offline is held by no cache', async () => {
    await openConfiguration();
    await type('git2-update-token', TOKEN);
    try {
      await act(async () => onlineManager.setOnline(false));
      // The cached status is invalidated, so the save needs a read, which pauses offline: nothing is sent.
      await act(async () => {
        void client.invalidateQueries({ queryKey: queryKeys.gitWorkflow.detail('site-a') });
      });
      await save();
      expect(bodies()).toEqual([]);
      expect(errors()).toEqual([t('settings.git.workflow.connectError')]);
      expect(isBusy()).toBe(false);
      expectNoTokenKept();
    } finally {
      await act(async () => onlineManager.setOnline(true));
      await settle();
    }
    // A save whose status is known goes out directly; while it is held, offline, nothing keeps the token.
    const put = held();
    mocks.put.mockImplementationOnce(() => put.promise);
    await save();
    expect(bodies()).toHaveLength(1);
    await act(async () => onlineManager.setOnline(false));
    expectNoTokenKept();
    await act(async () => onlineManager.setOnline(true));
    await put.answer(serve(lastPut()));
    expectNoTokenKept();
  });
});

describe('the import targets come from a read the cache adopted', () => {
  it('a manual Refresh in flight: Save waits for it and sends the targets it brought', async () => {
    await openConfiguration();
    await type('git2-update-path', 'guides');
    const read = held();
    mocks.status.mockImplementationOnce(() => read.promise);
    await press(refreshButton());
    mocks.put.mockImplementationOnce(async (request: PutRequest) => serve(request));
    await save();
    expect(bodies()).toEqual([]);
    expect(isBusy()).toBe(true);
    change('site-a', { importBranchId: 'branch-fixture-2', importLanguageId: 'language-fixture-2' });
    await read.answer(json(200, { data: status('site-a') }));
    expect(bodies().map(({ json: body }) => body)).toEqual([
      {
        ...SETTINGS,
        repository: 'acme-fixture/site-a',
        contentPath: 'guides',
        importBranchId: 'branch-fixture-2',
        importLanguageId: 'language-fixture-2',
      },
    ]);
  });

  it('a read cancelled back to the old status is not trusted: one more read, and its targets are sent', async () => {
    await openConfiguration();
    await type('git2-update-path', 'guides');
    const read = held();
    mocks.status.mockImplementationOnce(() => read.promise);
    await act(async () => {
      void client.invalidateQueries({ queryKey: queryKeys.gitWorkflow.detail('site-a') });
    });
    mocks.put.mockImplementationOnce(async (request: PutRequest) => serve(request));
    await save();
    change('site-a', { importBranchId: 'branch-fixture-2' });
    const before = reads('site-a');
    await act(async () => client.cancelQueries({ queryKey: queryKeys.gitWorkflow.detail('site-a') }));
    await settle();
    // One more read for the save, then the success's own readback.
    expect(reads('site-a')).toBe(before + 2);
    expect(bodies().map(({ json: body }) => body)).toEqual([
      {
        ...SETTINGS,
        repository: 'acme-fixture/site-a',
        contentPath: 'guides',
        importBranchId: 'branch-fixture-2',
        importLanguageId: 'language-fixture-1',
      },
    ]);
    await read.answer(json(200, { data: status('site-a') }));
  });

  it('when the second read is cancelled too, nothing is sent: the values stay and Save is ready again', async () => {
    await openConfiguration();
    await type('git2-update-path', 'guides');
    const first = held();
    const second = held();
    mocks.status.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    await act(async () => {
      void client.invalidateQueries({ queryKey: queryKeys.gitWorkflow.detail('site-a') });
    });
    await save();
    await act(async () => client.cancelQueries({ queryKey: queryKeys.gitWorkflow.detail('site-a') }));
    await settle();
    await act(async () => client.cancelQueries({ queryKey: queryKeys.gitWorkflow.detail('site-a') }));
    await settle();
    expect(bodies()).toEqual([]);
    expect(errors()).toEqual([t('settings.git.workflow.connectError')]);
    expect(shown().contentPath).toBe('guides');
    expect(isBusy()).toBe(false);
    await first.answer(json(200, { data: status('site-a') }));
    await second.answer(json(200, { data: status('site-a') }));
    expect(bodies()).toEqual([]);
  });

  it('a read that fails sends nothing (the screen then shows the load error, as on main)', async () => {
    await openConfiguration();
    await type('git2-update-path', 'guides');
    const read = held();
    mocks.status.mockImplementationOnce(() => read.promise);
    await act(async () => {
      void client.invalidateQueries({ queryKey: queryKeys.gitWorkflow.detail('site-a') });
    });
    await save();
    // A 4xx is not retried; the save's one more read is refused too.
    mocks.status.mockImplementation(async () => json(403, { error: { message: 'Refused by the test.' } }));
    await read.answer(json(403, { error: { message: 'Refused by the test.' } }));
    expect(bodies()).toEqual([]);
    expect(container.textContent).toContain(t('settings.git.workflow.loadError'));
  });

  it('controls: the values pressed are sent, a newer edit stays, and the request keeps its site', async () => {
    await openConfiguration('site-a', 'git-site-a');
    await type('git2-update-path', 'guides');
    const read = held();
    mocks.status.mockImplementationOnce(() => read.promise);
    await press(refreshButton());
    mocks.put.mockImplementationOnce(async (request: PutRequest) => serve(request));
    await save();
    await type('git2-update-path', 'typed-while-waiting');
    await read.answer(json(200, { data: status('site-a') }));
    expect(bodies().map(({ param, json: body }) => [param.projectId, body.contentPath, body.importBranchId])).toEqual([
      ['site-a', 'guides', 'branch-fixture-1'],
    ]);
    expect(shown().contentPath).toBe('typed-while-waiting');
    expect(discardButton()).toBeDefined();

    // Leaving for B while A waits: A's request still goes for A, with A's latest targets; B sends nothing.
    const readA = held();
    mocks.status.mockImplementationOnce(() => readA.promise);
    await press(refreshButton());
    mocks.put.mockImplementationOnce(async (request: PutRequest) => serve(request));
    await save();
    await openConfiguration('site-b', 'git-site-b');
    change('site-a', { importLanguageId: 'language-fixture-3' });
    await readA.answer(json(200, { data: status('site-a') }));
    expect(bodies().map(({ param, json: body }) => [param.projectId, body.importLanguageId])).toEqual([
      ['site-a', 'language-fixture-1'],
      ['site-a', 'language-fixture-3'],
    ]);
    expect(shown().repository).toBe('acme-fixture/site-b');
  });
});

describe('round 2: the session, the adopted read and the cleaned error', () => {
  /** The save hook alone, keeping the callback a render gave it. */
  let probe: ReturnType<typeof useSaveGitWorkflowConnection> | undefined;
  function Probe({ projectId }: { projectId: string }) {
    probe = useSaveGitWorkflowConnection(projectId);
    return null;
  }
  const statusKey = queryKeys.gitWorkflow.detail('site-a');
  const values = { ...SETTINGS, repository: 'acme-fixture/site-a' };
  const statusQuery = () => client.getQueryCache().find({ queryKey: statusKey, exact: true });

  it('a callback kept from before a session reset reads and sends nothing', async () => {
    await render(<Probe projectId="site-a" />);
    client.setQueryData(statusKey, status('site-a'));
    const kept = probe;
    await act(async () => resetDashboardSession(client));
    const before = reads('site-a');
    mocks.put.mockImplementation(async (request: PutRequest) => serve(request));
    await expect(kept?.save({ projectId: 'site-a', values }, TOKEN)).rejects.toThrow();
    await settle();
    expect(reads('site-a')).toBe(before);
    expect(bodies()).toEqual([]);
    expect(statusQuery()).toBeUndefined();
  });

  it('a session reset in the same tick as the save, with the status cached: nothing is sent', async () => {
    await render(<Probe projectId="site-a" />);
    // A valid, idle status: the save takes it from the cache without a read.
    client.setQueryData(statusKey, status('site-a'));
    mocks.put.mockImplementation(async (request: PutRequest) => serve(request));
    const before = reads('site-a');
    let outcome: Promise<unknown> = Promise.resolve();
    await act(async () => {
      outcome = (probe?.save({ projectId: 'site-a', values }, TOKEN) ?? Promise.resolve()).catch((error: unknown) => error);
      // Before the save's continuation runs.
      resetDashboardSession(client);
    });
    await settle();
    expect(await outcome).toBeInstanceOf(Error);
    expect(mocks.put).not.toHaveBeenCalled();
    expect(JSON.stringify([mocks.put.mock.calls, mocks.status.mock.calls, mocks.operations.mock.calls])).not.toContain(TOKEN);
    expect(reads('site-a')).toBe(before);
    expect(statusQuery()).toBeUndefined();
    expect(probe?.isPending()).toBe(false);
  });

  it('a session reset while the save waits on a read: no read after it, and the cleared cache stays empty', async () => {
    await render(<Probe projectId="site-a" />);
    client.setQueryData(statusKey, status('site-a'));
    const read = held();
    mocks.status.mockImplementationOnce(() => read.promise);
    await act(async () => {
      // The reset cancels this read; its rejection is expected here.
      client.fetchQuery({ ...gitWorkflowQueryOptions('site-a'), staleTime: 0 }).catch(() => undefined);
    });
    mocks.put.mockImplementation(async (request: PutRequest) => serve(request));
    let outcome: Promise<unknown> = Promise.resolve();
    await act(async () => {
      outcome = (probe?.save({ projectId: 'site-a', values }, TOKEN) ?? Promise.resolve()).catch((error: unknown) => error);
    });
    const before = reads('site-a');
    await act(async () => resetDashboardSession(client));
    await settle();
    expect(await outcome).toBeInstanceOf(Error);
    expect(reads('site-a')).toBe(before);
    expect(bodies()).toEqual([]);
    expect(statusQuery()).toBeUndefined();
    await read.answer(json(200, { data: status('site-a') }));
    expect(statusQuery()).toBeUndefined();
  });

  it('a setQueryData write while a Refresh is held is not the read: Save still waits for the GET', async () => {
    await openConfiguration();
    await type('git2-update-path', 'guides');
    const read = held();
    mocks.status.mockImplementationOnce(() => read.promise);
    await press(refreshButton());
    mocks.put.mockImplementationOnce(async (request: PutRequest) => serve(request));
    await save();
    await act(async () => {
      client.setQueryData(statusKey, status('site-a'));
    });
    await settle();
    expect(bodies()).toEqual([]);
    expect(isBusy()).toBe(true);
    change('site-a', { importBranchId: 'branch-fixture-2' });
    await read.answer(json(200, { data: status('site-a') }));
    expect(bodies().map(({ json: body }) => body.importBranchId)).toEqual(['branch-fixture-2']);
  });

  it('a refusal echoing the token in every field: message, code, reason, details and Retry-After all dropped', async () => {
    await openConfiguration();
    await type('git2-update-token', TOKEN);
    const echo = `echo-${TOKEN}`;
    mocks.put.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              message: echo,
              code: echo,
              details: { reason: echo, path: echo, sourceFile: echo, limit: echo, errors: [{ message: echo, path: echo }] },
            },
          }),
          { status: 400, headers: { 'content-type': 'application/json', 'retry-after': echo } },
        ),
    );
    await save();
    expect(errors()).toEqual([t('settings.git.workflow.connectError')]);
    const logged = vi.mocked(console.error).mock.calls.flat();
    const error = logged.find((item) => item instanceof Error) as (Error & Record<string, unknown>) | undefined;
    expect(error).toBeDefined();
    expect(JSON.stringify({ ...error, message: error?.message, reason: error?.reason, cause: String(error?.cause ?? '') })).not.toContain(TOKEN);
    expect(error).toMatchObject({ status: 400, code: undefined, retryAfter: undefined, details: undefined });
    expectNoTokenKept();
  });

  it('a numeric Retry-After and the status are kept, so a 429 still reads as rate limited', async () => {
    await openConfiguration();
    mocks.put.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ error: { message: 'slow down', code: 'rate:limited' } }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '30' },
        }),
    );
    await save();
    expect(errors()).toEqual([t('error.rateLimited')]);
    const error = vi
      .mocked(console.error)
      .mock.calls.flat()
      .find((item) => item instanceof Error);
    expect(error).toMatchObject({ status: 429, retryAfter: '30', code: undefined });
  });
});

describe('Enter, IME, focus and validation', () => {
  it('Enter saves through the same path as Save; an IME Enter saves nothing; neither reaches Sync or Disconnect', async () => {
    await openConfiguration();
    await type('git2-update-path', 'guides');
    await pressEnter('git2-update-path', { isComposing: true });
    await pressEnter('git2-update-path', { keyCode: 229 } as KeyboardEventInit);
    expect(bodies()).toHaveLength(0);
    mocks.put.mockImplementationOnce(async (request: PutRequest) => serve(request));
    await pressEnter('git2-update-path');
    expect(bodies()).toHaveLength(1);
    expect(mocks.operations).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field('git2-update-path'));
    // Disconnect is a plain button in the form, never its submit.
    const disconnect = buttons().find((item) => item.textContent?.trim() === t('settings.git.disconnect'));
    expect(disconnect?.getAttribute('type')).toBe('button');
  });

  it('a blank required setting sends nothing, says why on the field and moves focus there; the problem stays until a clean save', async () => {
    await openConfiguration();
    await type('git2-update-repo', ' ');
    await save();
    expect(bodies()).toHaveLength(0);
    const repository = field('git2-update-repo');
    expect(repository.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(repository.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      t('validation.required', { label: t('settings.git.repository.title') }),
    );
    expect(document.activeElement).toBe(repository);

    // Fixed and saved, but a refused save keeps the attempt: blanking a branch shows its problem at once.
    await type('git2-update-repo', 'acme-fixture/site-a');
    await type('git2-update-path', 'guides');
    mocks.put.mockImplementationOnce(async () => refused());
    await save();
    await type('git2-update-head', '');
    expect(field('git2-update-head').getAttribute('aria-invalid')).toBe('true');

    // A clean save ends it.
    await type('git2-update-head', 'nibleaf/docs');
    mocks.put.mockImplementationOnce(async (request: PutRequest) => serve(request));
    await save();
    await type('git2-update-head', '');
    expect(field('git2-update-head').hasAttribute('aria-invalid')).toBe(false);
  });

  it('Discard hides the problems', async () => {
    await openConfiguration();
    await type('git2-update-base', '');
    await save();
    expect(field('git2-update-base').getAttribute('aria-invalid')).toBe('true');
    await press(discardButton());
    await type('git2-update-base', '');
    expect(field('git2-update-base').hasAttribute('aria-invalid')).toBe(false);
  });
});

describe('sites, locale and polling', () => {
  it('a locale change on the same site keeps the draft and the save in flight', async () => {
    await openConfiguration();
    await type('git2-update-path', 'guides');
    const put = held();
    mocks.put.mockImplementationOnce(() => put.promise);
    await save();
    mocks.locale = 'ar';
    await workflow('site-a');
    expect(shown().contentPath).toBe('guides');
    expect(isBusy()).toBe(true);
    await put.answer(serve(lastPut()));
    expect(discardButton()).toBeUndefined();
    expect(successes()).toHaveLength(1);
  });

  it('same-site status polling while an operation runs keeps the draft', async () => {
    change('site-a', { lastSyncStatus: 'RUNNING', operations: [running] });
    await openConfiguration();
    await type('git2-update-repo', 'acme-fixture/renamed');
    for (let tick = 0; tick < 3; tick += 1) {
      change('site-a', { operations: [{ ...running, id: `op-fixture-${tick + 2}` }] });
      await act(async () => client.refetchQueries({ queryKey: queryKeys.gitWorkflow.detail('site-a') }));
      await settle();
    }
    expect(shown().repository).toBe('acme-fixture/renamed');
    expect(conflictShown()).toBe(false);
  });

  it('keyed A → B → A while A saves: B is independent and quiet; A comes back busy, then fresh', async () => {
    await openConfiguration('site-a', 'git-site-a');
    await type('git2-update-path', 'guides');
    await type('git2-update-token', TOKEN);
    const put = held();
    mocks.put.mockImplementationOnce(() => put.promise);
    await save();

    await openConfiguration('site-b', 'git-site-b');
    expect(shown()).toEqual({ ...SETTINGS, repository: 'acme-fixture/site-b' });
    expect(field('git2-update-token').value).toBe('');
    expect(isBusy()).toBe(false);

    await openConfiguration('site-a', 'git-site-a');
    expect(isBusy()).toBe(true);
    await press(saveButton());
    expect(bodies()).toHaveLength(1);

    await put.answer(serve(lastPut()));
    // The request still refreshed A, and its outcome told nobody.
    expect(stored['site-a']?.contentPath).toBe('guides');
    expect(shown().contentPath).toBe('guides');
    expect(field('git2-update-token').value).toBe('');
    expect(isBusy()).toBe(false);
    expect(successes()).toEqual([]);
    expect(errors()).toEqual([]);
  });

  it('an obsolete failure after leaving the site says nothing', async () => {
    await openConfiguration('site-a', 'git-site-a');
    await type('git2-update-path', 'guides');
    const put = held();
    mocks.put.mockImplementationOnce(() => put.promise);
    await save();
    await openConfiguration('site-b', 'git-site-b');
    await put.answer(refused());
    expect(errors()).toEqual([]);
    expect(reads('site-a')).toBe(1);
  });
});
