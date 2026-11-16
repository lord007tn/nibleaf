// @vitest-environment jsdom
// The Mintlify and GitBook imports in ImportTab. Real QueryClient (the app's own), the real mutation and the real
// component; only the HTTP calls are replaced, and held until the test answers them.
//
// Which cases ordinary use reaches: a double press, choosing another source chip while a request runs (and coming
// back), leaving for another site (the settings page keys the tab by site, so that is an unmount) and returning.
// A site change on the *same* instance is not reachable through the settings page; those tests are marked
// "programmatic" and check identity only.
import { translateFn } from '@nibleaf/i18n';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  ghost: vi.fn(),
  mintlify: vi.fn(),
  gitbook: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: mocks.success } }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@nibleaf/i18n/react', async () => {
  const { translateFn: translate } = await vi.importActual<typeof import('@nibleaf/i18n')>('@nibleaf/i18n');
  return {
    useT: () => (key: Parameters<typeof translate>[0], variables?: Parameters<typeof translate>[1]) => translate(key, variables, mocks.locale),
  };
});
vi.mock('@/services/api', () => ({
  api: {
    app: {
      projects: {
        ':projectId': {
          settings: { import: { ghost: { $post: mocks.ghost }, mintlify: { $post: mocks.mintlify }, gitbook: { $post: mocks.gitbook } } },
        },
      },
    },
  },
}));

import { queryKeys } from '@/hooks/api/query-keys';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { ImportTab } from './import-tab';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const t = (key: Parameters<typeof translateFn>[0], variables?: Parameters<typeof translateFn>[1]) => translateFn(key, variables, mocks.locale);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const SUMMARY = { imported: 3, updated: 1, skipped: 0, warnings: [] };
const ok = () => json(200, { data: SUMMARY });
const refusal = (status: number, error: Record<string, unknown>) => async () => json(status, { error: { message: 'Refused', ...error } });
/** Lets mutations settle: TanStack tells React on a timer, so each tick gets its own act. */
const settle = async () => {
  for (let tick = 0; tick < 4; tick += 1) await act(async () => new Promise((done) => setTimeout(done, 0)));
};
function held() {
  let resolve: (value: Response) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<Response>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return {
    promise,
    answer: async (response: Response) => {
      await act(async () => resolve(response));
      await settle();
    },
    drop: async (error: unknown) => {
      await act(async () => reject(error));
      await settle();
    },
  };
}

let container: HTMLDivElement;
let root: Root;
let client: ReturnType<typeof createQueryClient>;
let refreshed: () => unknown[];

const render = async (node: ReactNode) => {
  await act(async () => root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
  await settle();
};
const tab = (projectId: string | undefined, key?: string) => render(<ImportTab key={key} projectId={projectId} />);

const buttons = () => [...container.querySelectorAll('button')];
const chip = (label: string) => buttons().find((item) => item.hasAttribute('aria-pressed') && item.textContent?.trim() === label);
/** The Import button: its running text is always in the markup (hidden while idle). */
const importButton = () => buttons().find((item) => item.textContent?.includes(t('settings.import.running')));
const press = async (element: HTMLElement | undefined) => {
  await act(async () => element?.click());
  await settle();
};
const MINTLIFY = () => t('settings.import.mintlify.title');
const GITBOOK = () => t('settings.import.gitbook.title');
const chooseSource = (label: string) => press(chip(label));
const field = (selector: string) => {
  const input = container.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`no ${selector}`);
  return input;
};
const type = async (selector: string, value: string) => {
  const input = field(selector);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const replaceSwitch = () => {
  const element = container.querySelector<HTMLElement>('[role="switch"]');
  if (!element) throw new Error('no replace switch');
  return element;
};
/** A source chosen and a fictional repository typed, as people paste it. */
const ready = async (label: string, repo = '  https://github.com/acme/handbook.git  ') => {
  await chooseSource(label);
  await type('#import-repo', repo);
};
const isBusy = (button = importButton()) => button?.getAttribute('aria-busy') === 'true';
const isDisabled = (button = importButton()) => Boolean(button?.disabled || button?.getAttribute('aria-disabled') === 'true');
const mintlifyPosts = () => mocks.mintlify.mock.calls.map(([request]) => request);
const gitbookPosts = () => mocks.gitbook.mock.calls.map(([request]) => request);
const errors = () => mocks.error.mock.calls.map(([message]) => message);
const showsResult = () => buttons().some((item) => item.textContent?.trim() === t('settings.import.again'));
const siteRefresh = (projectId: string) => [queryKeys.pages.allForProject(projectId), queryKeys.projects.detail(projectId), queryKeys.projects.all()];

beforeEach(() => {
  mocks.locale = 'en';
  client = createQueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  refreshed = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  mocks.ghost.mockReset().mockImplementation(async () => ok());
  mocks.mintlify.mockReset().mockImplementation(async () => ok());
  mocks.gitbook.mockReset().mockImplementation(async () => ok());
  mocks.success.mockReset();
  mocks.error.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('Mintlify and GitBook imports own their request', () => {
  it('sends the normalized Mintlify body for the site, omitting empty optional fields', async () => {
    await tab('site-a');
    await ready(MINTLIFY());
    await press(importButton());
    expect(mintlifyPosts()).toEqual([{ param: { projectId: 'site-a' }, json: { repo: 'acme/handbook', replaceExisting: false } }]);
    expect(gitbookPosts()).toEqual([]);
    expect(refreshed()).toEqual(siteRefresh('site-a'));
    expect(mocks.success).toHaveBeenCalledWith(t('settings.import.success'));
    expect(showsResult()).toBe(true);
  });

  it('sends every GitBook field as typed, trimmed, with the replace opt-in', async () => {
    await tab('site-a');
    await ready(GITBOOK(), 'acme/handbook');
    await type('#import-branch', '  release/v2  ');
    await type('#import-source-url', ' https://help.example.com/docs ');
    await type('#import-gitbook-path', '  /spaces/guides/  ');
    expect(replaceSwitch().getAttribute('aria-checked')).toBe('false');
    await press(replaceSwitch());
    await press(importButton());
    expect(gitbookPosts()).toEqual([
      {
        param: { projectId: 'site-a' },
        json: {
          sourceUrl: 'https://help.example.com/docs',
          repo: 'acme/handbook',
          branch: 'release/v2',
          replaceExisting: true,
          path: 'spaces/guides',
        },
      },
    ]);
    expect(mintlifyPosts()).toEqual([]);
  });

  it.each([
    ['not owner/repo', 'acme', '', 'settings.import.mintlify.invalidRepo'],
    ['another host', 'https://gitlab.com/acme/handbook', '', 'settings.import.mintlify.invalidRepo'],
    ['a source URL with credentials', 'acme/handbook', 'https://user:secret@help.example.com', 'settings.import.sourceUrl'],
    ['a source URL with another protocol', 'acme/handbook', 'ftp://help.example.com', 'settings.import.sourceUrl'],
  ] as const)('refuses %s before sending, keeping what was typed', async (_case, repo, sourceUrl, message) => {
    await tab('site-a');
    await ready(MINTLIFY(), repo);
    if (sourceUrl) await type('#import-source-url', sourceUrl);
    await press(importButton());
    expect(errors()).toEqual([t(message)]);
    expect(mintlifyPosts()).toEqual([]);
    expect(isBusy()).toBe(false);
    expect(field('#import-repo').value).toBe(repo);
  });

  it('sends once for presses in the same tick, and stays busy (keeping focus) until the answer', async () => {
    await tab('site-a');
    await ready(MINTLIFY());
    const answer = held();
    mocks.mintlify.mockImplementation(() => answer.promise);
    const button = importButton();
    button?.focus();
    await act(async () => {
      button?.click();
      button?.click();
    });
    await settle();
    expect(isBusy()).toBe(true);
    expect(importButton()?.disabled).toBe(false);
    expect(importButton()?.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(importButton());
    await press(importButton());
    await answer.answer(ok());
    expect(mintlifyPosts()).toHaveLength(1);
    expect(mocks.success).toHaveBeenCalledTimes(1);
  });

  it('sends what was pressed, even when the fields change while it runs', async () => {
    await tab('site-a');
    await ready(MINTLIFY());
    const answer = held();
    mocks.mintlify.mockImplementation(() => answer.promise);
    await press(importButton());
    await type('#import-repo', 'other/repo');
    await press(replaceSwitch());
    await answer.answer(ok());
    expect(mintlifyPosts()).toEqual([{ param: { projectId: 'site-a' }, json: { repo: 'acme/handbook', replaceExisting: false } }]);
  });

  it('keeps the other providers busy while one runs (no simultaneous imports), with the chips still usable', async () => {
    await tab('site-a');
    await ready(MINTLIFY());
    const answer = held();
    mocks.mintlify.mockImplementation(() => answer.promise);
    await press(importButton());
    await chooseSource(GITBOOK());
    expect(chip(GITBOOK())?.getAttribute('aria-pressed')).toBe('true');
    expect(isBusy()).toBe(true);
    await press(importButton());
    await chooseSource(t('settings.import.ghost.title'));
    expect(isBusy()).toBe(true);
    await press(importButton());
    expect(gitbookPosts()).toEqual([]);
    expect(mocks.ghost).not.toHaveBeenCalled();
    await answer.answer(ok());
    expect(isBusy()).toBe(false);
  });

  it('stays busy for Mintlify while a Ghost import runs', async () => {
    await tab('site-a');
    await chooseSource(t('settings.import.ghost.title'));
    await type('#import-ghost-url', 'https://blog.example.com');
    const input = field('#import-ghost-file');
    const file = new File([JSON.stringify({ db: [{ data: { posts: [] } }] })], 'journal.ghost.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    const answer = held();
    mocks.ghost.mockImplementation(() => answer.promise);
    await press(importButton());
    await vi.waitFor(() => expect(mocks.ghost).toHaveBeenCalledTimes(1));
    await ready(MINTLIFY());
    expect(isBusy()).toBe(true);
    await press(importButton());
    expect(mintlifyPosts()).toEqual([]);
    await answer.answer(ok());
    expect(isBusy()).toBe(false);
  });

  it('keeps an accepted Mintlify import after switching to GitBook: its site is refreshed, and its result does not replace the GitBook form', async () => {
    await tab('site-a');
    await ready(MINTLIFY());
    const answer = held();
    mocks.mintlify.mockImplementation(() => answer.promise);
    await press(importButton());
    await chooseSource(GITBOOK());
    await type('#import-repo', 'acme/other');
    await answer.answer(ok());
    expect(refreshed()).toEqual(siteRefresh('site-a'));
    expect(showsResult()).toBe(false);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(chip(GITBOOK())?.getAttribute('aria-pressed')).toBe('true');
    expect(field('#import-repo').value).toBe('acme/other');
    expect(isBusy()).toBe(false);
    expect(mintlifyPosts()).toHaveLength(1);
  });

  it('does not report a stale failure into another provider’s form', async () => {
    await tab('site-a');
    await ready(GITBOOK());
    const answer = held();
    mocks.gitbook.mockImplementation(() => answer.promise);
    await press(importButton());
    await chooseSource(MINTLIFY());
    await answer.answer(json(409, { error: { code: 'import:in_progress', message: 'Running' } }));
    expect(mocks.error).not.toHaveBeenCalled();
    expect(isBusy()).toBe(false);
  });

  it('stays busy after Mintlify → GitBook → Mintlify while it runs, and does not report into the reopened form', async () => {
    await tab('site-a');
    await ready(MINTLIFY());
    const answer = held();
    mocks.mintlify.mockImplementation(() => answer.promise);
    await press(importButton());
    await chooseSource(GITBOOK());
    await chooseSource(MINTLIFY());
    expect(isBusy()).toBe(true);
    await press(importButton());
    await answer.answer(ok());
    expect(mintlifyPosts()).toHaveLength(1);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(showsResult()).toBe(false);
    expect(refreshed()).toEqual(siteRefresh('site-a'));
  });

  it('refreshes the site it was sent for after the tab leaves for another site (keyed), and reports nothing', async () => {
    await tab('site-a', 'import-site-a');
    await ready(GITBOOK());
    const answer = held();
    mocks.gitbook.mockImplementation(() => answer.promise);
    await press(importButton());
    await tab('site-b', 'import-site-b');
    await ready(GITBOOK());
    expect(isBusy()).toBe(false);
    await answer.answer(ok());
    expect(refreshed()).toEqual(siteRefresh('site-a'));
    expect(mocks.success).not.toHaveBeenCalled();
    expect(showsResult()).toBe(false);
  });

  it('shows the site busy after a keyed A → B → A remount while its import still runs, and sends nothing more', async () => {
    await tab('site-a', 'import-site-a');
    await ready(MINTLIFY());
    const answer = held();
    mocks.mintlify.mockImplementation(() => answer.promise);
    await press(importButton());
    await tab('site-b', 'import-site-b');
    await tab('site-a', 'import-site-a-again');
    await ready(MINTLIFY());
    expect(isBusy()).toBe(true);
    await press(importButton());
    expect(mintlifyPosts()).toHaveLength(1);
    await answer.answer(ok());
    expect(mocks.success).not.toHaveBeenCalled();
    expect(isBusy()).toBe(false);
  });

  it('programmatic: refreshes the site it was sent for when the same instance has moved to another', async () => {
    await tab('site-a');
    await ready(MINTLIFY());
    const answer = held();
    mocks.mintlify.mockImplementation(() => answer.promise);
    await press(importButton());
    await tab('site-b');
    await answer.answer(ok());
    expect(mintlifyPosts()).toEqual([{ param: { projectId: 'site-a' }, json: { repo: 'acme/handbook', replaceExisting: false } }]);
    expect(refreshed()).toEqual(siteRefresh('site-a'));
    expect(mocks.success).not.toHaveBeenCalled();
    expect(showsResult()).toBe(false);
  });

  it('programmatic: A → B → A on the same instance is a new panel, still busy for A', async () => {
    await tab('site-a');
    await ready(GITBOOK());
    const answer = held();
    mocks.gitbook.mockImplementation(() => answer.promise);
    await press(importButton());
    await tab('site-b');
    expect(isBusy()).toBe(false);
    await tab('site-a');
    expect(isBusy()).toBe(true);
    await answer.drop(new TypeError('fetch failed'));
    expect(mocks.error).not.toHaveBeenCalled();
    expect(refreshed()).toEqual([]);
    expect(gitbookPosts()).toHaveLength(1);
  });

  it('refreshes nothing after a refusal, keeps every field, and sends the same body on retry', async () => {
    await tab('site-a');
    await ready(GITBOOK(), 'acme/handbook');
    await type('#import-gitbook-path', 'docs');
    await press(replaceSwitch());
    mocks.gitbook.mockImplementationOnce(refusal(409, { code: 'import:in_progress' }));
    await press(importButton());
    expect(errors()).toEqual([t('settings.import.inProgress')]);
    expect(refreshed()).toEqual([]);
    expect(isBusy()).toBe(false);
    expect(isDisabled()).toBe(false);
    expect(field('#import-repo').value).toBe('acme/handbook');
    expect(field('#import-gitbook-path').value).toBe('docs');
    expect(replaceSwitch().getAttribute('aria-checked')).toBe('true');
    await press(importButton());
    const body = { repo: 'acme/handbook', replaceExisting: true, path: 'docs' };
    expect(gitbookPosts()).toEqual([
      { param: { projectId: 'site-a' }, json: body },
      { param: { projectId: 'site-a' }, json: body },
    ]);
    expect(showsResult()).toBe(true);
  });

  it.each([
    ['import:busy', refusal(503, { code: 'import:busy' }), () => t('settings.import.busy')],
    [
      'import:incomplete with its file and path',
      refusal(422, { code: 'import:incomplete', details: { path: 'guides/intro.mdx', sourceFile: 'docs.json' } }),
      () => `${t('settings.import.incomplete')} (docs.json: guides/intro.mdx)`,
    ],
    ['import:limit', refusal(413, { code: 'import:limit' }), () => t('settings.import.limit')],
    [
      'import:limit with a node limit',
      refusal(413, { code: 'import:limit', details: { limit: 500 } }),
      () => t('settings.import.nodeLimit', { limit: 500 }),
    ],
    ['import:invalid_document (not called invalid JSON)', refusal(400, { code: 'import:invalid_document' }), () => t('settings.import.error')],
    ['a 409', refusal(409, {}), () => t('settings.import.conflict')],
    ['a 400', refusal(400, {}), () => t('settings.import.error')],
  ])('maps %s to the existing copy', async (_case, answer, message) => {
    await tab('site-a');
    await ready(MINTLIFY());
    mocks.mintlify.mockImplementationOnce(answer);
    await press(importButton());
    expect(mocks.error.mock.calls).toEqual([[message()]]);
  });

  it.each([
    ['a gateway timeout', async () => json(504, { error: { message: 'Gateway Timeout' } })],
    ['a request timeout', async () => json(408, { error: { message: 'Request Timeout' } })],
    ['a dropped connection', async () => Promise.reject(new TypeError('fetch failed'))],
  ])('says the import may still be running after %s, for 20 seconds, and does not retry', async (_case, answer) => {
    await tab('site-a');
    await ready(GITBOOK());
    mocks.gitbook.mockImplementationOnce(answer);
    await press(importButton());
    expect(mocks.error.mock.calls).toEqual([[t('settings.import.mayStillRun'), { duration: 20_000 }]]);
    expect(gitbookPosts()).toHaveLength(1);
    expect(isDisabled()).toBe(false);
  });

  it('keeps the existing Arabic copy for busy and an unknown outcome', async () => {
    mocks.locale = 'ar';
    await tab('site-a');
    await ready(MINTLIFY());
    const answer = held();
    mocks.mintlify.mockImplementation(() => answer.promise);
    await press(importButton());
    expect(importButton()?.textContent).toContain('جارٍ الاستيراد…');
    expect(isBusy()).toBe(true);
    await answer.drop(new TypeError('fetch failed'));
    expect(mocks.error.mock.calls).toEqual([[t('settings.import.mayStillRun'), { duration: 20_000 }]]);
  });
});
