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
import { QueryClientProvider } from '@tanstack/react-query';
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

import { queryKeys } from '@/hooks/api/query-keys';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
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
/** What the server answers a PUT with, having stored `settings` (already normalized). */
const answer = (projectId: string, settings: Partial<Settings>) => {
  stored[projectId] = { ...stored[projectId], ...settings } as Stored;
  return json(200, { data: { connection: { ...stored[projectId], credentialConfigured: true, webhookConfigured: true }, webhookSecret: null } });
};
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

    stored['site-a'] = { ...stored['site-a'], lastSyncStatus: 'RUNNING', operations: [running] } as Stored;
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
    stored['site-a'] = { ...stored['site-a'], headBranch: 'nibleaf/other', baseBranch: 'trunk' };
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
    stored['site-a'] = { ...stored['site-a'], baseBranch: 'trunk' };
    await refetch();
    await press(buttons().find((item) => item.textContent?.trim() === t('forms.keepMine')));
    expect(conflictShown()).toBe(false);
    expect(shown().baseBranch).toBe('develop');
    mocks.put.mockImplementationOnce(async () => answer('site-a', { baseBranch: 'develop' }));
    await save();
    expect(bodies()[0]?.json.baseBranch).toBe('develop');
    expect(successes()).toEqual([t('settings.git.workflow.connected')]);
  });

  it('Discard returns to the latest confirmed values and clears a typed token', async () => {
    await openConfiguration();
    await type('git2-update-repo', 'acme-fixture/elsewhere');
    await type('git2-update-token', TOKEN);
    stored['site-a'] = { ...stored['site-a'], contentPath: 'content' };
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
    await put.answer(answer('site-a', { repository: 'acme-fixture/moved' }));
    expect(shown()).toMatchObject({ repository: 'acme-fixture/moved', contentPath: 'typed-during-save' });
    expect(isBusy()).toBe(false);
    expect(discardButton()).toBeDefined();
    expect(successes()).toEqual([]);
    // The success refreshed the site's status, and the readback did not wipe the edit.
    expect(reads('site-a')).toBe(2);
  });

  it('a normalized save reads back as its own echo: clean, "saved" once', async () => {
    await openConfiguration();
    await type('git2-update-repo', 'HTTPS://GITHUB.COM/acme-fixture/site-a.GIT');
    await type('git2-update-base', ' refs/heads/main ');
    await type('git2-update-path', ' /docs\\guides/ ');
    mocks.put.mockImplementationOnce(async () => answer('site-a', { contentPath: 'docs/guides' }));
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
    mocks.put.mockImplementationOnce(async () => answer('site-a', { contentPath: 'guides' }));
    await save();
    expect(bodies()).toHaveLength(0);
    stored['site-a'] = { ...stored['site-a'], importBranchId: 'branch-fixture-2', importLanguageId: null };
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

    mocks.put.mockImplementationOnce(async () => answer('site-a', { baseBranch: 'trunk' }));
    await save();
    expect(bodies()[1]?.json).toEqual({ ...SETTINGS, repository: 'acme-fixture/site-a', baseBranch: 'trunk', ...TARGETS, token: TOKEN });
    expect(field('git2-update-token').value).toBe('');
    expect(successes()).toEqual([t('settings.git.workflow.connected')]);
  });
});

describe('the token', () => {
  it('starts blank, is sent only when typed, and never sits in the mutation cache', async () => {
    await openConfiguration();
    expect(field('git2-update-token').value).toBe('');
    await type('git2-update-token', '   ');
    mocks.put.mockImplementation(async () => answer('site-a', {}));
    await save();
    expect(bodies()[0]?.json).not.toHaveProperty('token');

    await type('git2-update-token', TOKEN);
    const put = held();
    mocks.put.mockImplementationOnce(() => put.promise);
    await save();
    expect(bodies()[1]?.json.token).toBe(TOKEN);
    expect(
      JSON.stringify(
        client
          .getMutationCache()
          .getAll()
          .map((mutation) => mutation.state),
      ),
    ).not.toContain(TOKEN);
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((query) => query.state.data),
      ),
    ).not.toContain(TOKEN);
    await put.answer(answer('site-a', {}));
    expect(field('git2-update-token').value).toBe('');
  });

  it('a newer token typed during the save is kept, and the form does not say "saved"', async () => {
    await openConfiguration();
    await type('git2-update-token', TOKEN);
    const put = held();
    mocks.put.mockImplementationOnce(() => put.promise);
    await save();
    await type('git2-update-token', NEWER_TOKEN);
    await put.answer(answer('site-a', {}));
    expect(field('git2-update-token').value).toBe(NEWER_TOKEN);
    expect(successes()).toEqual([]);
    expect(discardButton()).toBeDefined();
  });
});

describe('Enter, IME, focus and validation', () => {
  it('Enter saves through the same path as Save; an IME Enter saves nothing; neither reaches Sync or Disconnect', async () => {
    await openConfiguration();
    await type('git2-update-path', 'guides');
    await pressEnter('git2-update-path', { isComposing: true });
    await pressEnter('git2-update-path', { keyCode: 229 } as KeyboardEventInit);
    expect(bodies()).toHaveLength(0);
    mocks.put.mockImplementationOnce(async () => answer('site-a', { contentPath: 'guides' }));
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
    mocks.put.mockImplementationOnce(async () => answer('site-a', { contentPath: 'guides' }));
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
    await put.answer(answer('site-a', { contentPath: 'guides' }));
    expect(discardButton()).toBeUndefined();
    expect(successes()).toHaveLength(1);
  });

  it('same-site status polling while an operation runs keeps the draft', async () => {
    stored['site-a'] = { ...stored['site-a'], lastSyncStatus: 'RUNNING', operations: [running] } as Stored;
    await openConfiguration();
    await type('git2-update-repo', 'acme-fixture/renamed');
    for (let tick = 0; tick < 3; tick += 1) {
      stored['site-a'] = { ...stored['site-a'], operations: [{ ...running, id: `op-fixture-${tick + 2}` }] } as Stored;
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

    await put.answer(answer('site-a', { contentPath: 'guides' }));
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
