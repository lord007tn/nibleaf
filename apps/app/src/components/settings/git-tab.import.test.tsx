// @vitest-environment jsdom
// The legacy Git import's "Import now" in GitTab. The real GitTab, GitPipeline, query hooks and mutation with the
// app's own QueryClient and ConfirmProvider; only the HTTP calls are replaced (every API call is answered here), and
// the import POST is held until the test answers it. The per-site GitHub connection above the legacy import is out
// of scope and renders as nothing.
//
// Which cases ordinary use reaches: a double press (same tick or later), a language change, leaving for another site
// and coming back (the settings page keys the tab by site, `git-${projectId}`, so that is an unmount and a new
// instance), and two sites' tabs at once. A site change on the *same* instance is not reachable through the settings
// page; those tests are marked "programmatic".
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { translateFn } from '@nibleaf/i18n';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  importPost: vi.fn(),
  calls: [] as string[],
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: mocks.success } }));
vi.mock('@nibleaf/i18n/react', async () => {
  const { translateFn: translate } = await vi.importActual<typeof import('@nibleaf/i18n')>('@nibleaf/i18n');
  return {
    useT: () => (key: Parameters<typeof translate>[0], variables?: Parameters<typeof translate>[1]) => translate(key, variables, mocks.locale),
  };
});
vi.mock('./git-workflow', () => ({ GitWorkflow: () => null }));
// Every API call: the import POST goes to `mocks.importPost`; the reads get a connected legacy import for each site.
vi.mock('@/services/api', () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const answer = (path: string, request: { param?: { projectId?: string } } | undefined) => {
    const projectId = request?.param?.projectId;
    mocks.calls.push(`${path} ${projectId ?? ''}`.trim());
    if (path === 'settings.git.import.$post') return mocks.importPost(request);
    if (path === 'settings.$get') {
      const git = { connected: true, provider: 'github', repo: `acme-fixture/${projectId}`, branch: 'main', path: 'docs' };
      return json({ data: { plan: 'free', notifications: {}, integrations: {}, git } });
    }
    if (path === 'git.$get') return json({ data: null });
    return json({ data: [] });
  };
  const node = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_target, property) => (typeof property === 'string' && property !== 'then' ? node([...path, property]) : undefined),
      apply: (_target, _this, args: unknown[]) =>
        answer(path.slice(3).join('.'), args[0] as { param?: { projectId?: string } } | undefined) as Promise<Response>,
    });
  return { api: node([]) };
});

import { queryKeys } from '@/hooks/api/query-keys';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { GitTab } from './git-tab';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
Element.prototype.scrollIntoView = vi.fn();

const t = (key: Parameters<typeof translateFn>[0], variables?: Parameters<typeof translateFn>[1]) => translateFn(key, variables, mocks.locale);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const SUMMARY = { imported: 3, updated: 1, skipped: 0, warnings: [] };
const ok = () => json(200, { data: SUMMARY });
const RESULT = () => t('settings.git.import.result', { imported: 3, updated: 1 });
const ERROR = () => t('settings.git.import.error');
/** Lets mutations and queries settle: TanStack tells React on a timer, so each tick gets its own act. */
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

let client: ReturnType<typeof createQueryClient>;
let refreshed: () => unknown[];
const hosts: Array<{ host: HTMLDivElement; root: Root }> = [];
/** A mounted settings page: renders GitTab for a site, optionally keyed as the settings page keys it. */
function page() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  hosts.push({ host, root });
  const render = async (node: ReactNode) => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <ConfirmProvider>{node}</ConfirmProvider>
        </QueryClientProvider>,
      ),
    );
    await settle();
  };
  const importButton = () =>
    [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes(t('settings.git.import.now')));
  return {
    host,
    /** The site's tab, keyed as the settings page keys it (`git-${projectId}`) unless `key` says otherwise. */
    open: (projectId: string, key: string | null = `git-${projectId}`) => render(<GitTab key={key ?? undefined} projectId={projectId} />),
    importButton,
    press: async () => {
      await act(async () => importButton()?.click());
      await settle();
    },
    isBusy: () => importButton()?.getAttribute('aria-busy') === 'true',
  };
}
const posts = () => mocks.importPost.mock.calls.map(([request]) => request);
/** The success refresh, per site: its settings, then its pages. */
const siteRefresh = (projectId: string) => [queryKeys.workspace.projectSettings(projectId), queryKeys.pages.allForProject(projectId)];

beforeEach(() => {
  mocks.locale = 'en';
  mocks.calls = [];
  client = createQueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  refreshed = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  mocks.importPost.mockReset().mockImplementation(async () => ok());
  mocks.success.mockReset();
  mocks.error.mockReset();
});
afterEach(async () => {
  for (const { host, root } of hosts.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
});

describe('the legacy Git import owns its request', () => {
  it('sends an empty POST for the site, refreshes its settings and pages, and shows the result', async () => {
    const tab = page();
    await tab.open('site-a');
    await tab.press();
    expect(posts()).toEqual([{ param: { projectId: 'site-a' } }]);
    expect(refreshed()).toEqual(siteRefresh('site-a'));
    expect(mocks.success.mock.calls).toEqual([[RESULT()]]);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(tab.isBusy()).toBe(false);
  });

  it('sends once for two presses in the same tick, and stays busy (keeping focus) until the answer', async () => {
    const tab = page();
    await tab.open('site-a');
    const answer = held();
    mocks.importPost.mockImplementation(() => answer.promise);
    tab.importButton()?.focus();
    await act(async () => {
      tab.importButton()?.click();
      tab.importButton()?.click();
    });
    await settle();
    expect(posts()).toHaveLength(1);
    expect(tab.isBusy()).toBe(true);
    // Busy is aria-disabled, not :disabled, so the browser keeps keyboard focus on it.
    expect(tab.importButton()?.getAttribute('aria-disabled')).toBe('true');
    expect(tab.importButton()?.disabled).toBe(false);
    expect(document.activeElement).toBe(tab.importButton());
    await tab.press();
    expect(posts()).toHaveLength(1);
    await answer.answer(ok());
    expect(mocks.success.mock.calls).toEqual([[RESULT()]]);
    expect(refreshed()).toEqual(siteRefresh('site-a'));
    expect(tab.isBusy()).toBe(false);
  });

  it('refreshes nothing after a refusal, shows the existing error once, and sends the same request on retry', async () => {
    const tab = page();
    await tab.open('site-a');
    mocks.importPost.mockImplementationOnce(async () => json(409, { error: { code: 'import:in_progress', message: 'Running' } }));
    await tab.press();
    expect(mocks.error.mock.calls).toEqual([[ERROR()]]);
    expect(refreshed()).toEqual([]);
    expect(tab.isBusy()).toBe(false);
    await tab.press();
    expect(posts()).toEqual([{ param: { projectId: 'site-a' } }, { param: { projectId: 'site-a' } }]);
    expect(mocks.success.mock.calls).toEqual([[RESULT()]]);
    expect(refreshed()).toEqual(siteRefresh('site-a'));
  });

  it('does not retry a dropped request, refreshes nothing, and lets the person press again', async () => {
    const tab = page();
    await tab.open('site-a');
    mocks.importPost.mockImplementationOnce(async () => Promise.reject(new TypeError('fetch failed')));
    await tab.press();
    expect(posts()).toHaveLength(1);
    expect(mocks.error.mock.calls).toEqual([[ERROR()]]);
    expect(refreshed()).toEqual([]);
    expect(tab.isBusy()).toBe(false);
  });

  it('keeps the request, its busy state and its report through a language change on the same site', async () => {
    const tab = page();
    await tab.open('site-a');
    const answer = held();
    mocks.importPost.mockImplementation(() => answer.promise);
    await tab.press();
    mocks.locale = 'ar';
    await tab.open('site-a');
    expect(tab.isBusy()).toBe(true);
    expect(tab.importButton()?.textContent).toContain(t('settings.git.import.importing'));
    await answer.answer(ok());
    expect(mocks.success.mock.calls).toEqual([[t('settings.git.import.result', { imported: 3, updated: 1 })]]);
    expect(refreshed()).toEqual(siteRefresh('site-a'));
  });

  it('shows the site busy after a keyed A → B → A while its import runs, and sends nothing more', async () => {
    const tab = page();
    await tab.open('site-a');
    const answer = held();
    mocks.importPost.mockImplementation(() => answer.promise);
    await tab.press();
    await tab.open('site-b');
    expect(tab.isBusy()).toBe(false);
    await tab.open('site-a');
    expect(tab.isBusy()).toBe(true);
    await tab.press();
    expect(posts()).toEqual([{ param: { projectId: 'site-a' } }]);
    await answer.answer(ok());
    // The success still refreshes site A; its result belongs to the panel that is gone.
    expect(refreshed()).toEqual(siteRefresh('site-a'));
    expect(mocks.success).not.toHaveBeenCalled();
    expect(tab.isBusy()).toBe(false);
  });

  it('refreshes the site it was sent for after leaving for another site (keyed), and reports nothing', async () => {
    const tab = page();
    await tab.open('site-a');
    const answer = held();
    mocks.importPost.mockImplementation(() => answer.promise);
    await tab.press();
    await tab.open('site-b');
    await answer.answer(ok());
    expect(refreshed()).toEqual(siteRefresh('site-a'));
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('reports nothing and refreshes nothing when a request fails after leaving (keyed)', async () => {
    const tab = page();
    await tab.open('site-a');
    const answer = held();
    mocks.importPost.mockImplementation(() => answer.promise);
    await tab.press();
    await tab.open('site-b');
    await answer.answer(json(500, { error: { message: 'Boom' } }));
    expect(refreshed()).toEqual([]);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(posts()).toHaveLength(1);
  });

  it('does not block another site: busy for A, B imports at once, each refreshed and reported in its own panel', async () => {
    const a = page();
    const b = page();
    await a.open('site-a');
    await b.open('site-b');
    const answerA = held();
    const answerB = held();
    mocks.importPost.mockImplementationOnce(() => answerA.promise).mockImplementationOnce(() => answerB.promise);
    await a.press();
    expect(a.isBusy()).toBe(true);
    expect(b.isBusy()).toBe(false);
    await b.press();
    expect(posts()).toEqual([{ param: { projectId: 'site-a' } }, { param: { projectId: 'site-b' } }]);
    await answerB.answer(ok());
    expect(a.isBusy()).toBe(true);
    expect(b.isBusy()).toBe(false);
    expect(refreshed()).toEqual(siteRefresh('site-b'));
    await answerA.answer(json(500, { error: { message: 'Boom' } }));
    expect(a.isBusy()).toBe(false);
    expect(refreshed()).toEqual(siteRefresh('site-b'));
    expect(mocks.success.mock.calls).toEqual([[RESULT()]]);
    expect(mocks.error.mock.calls).toEqual([[ERROR()]]);
  });

  it('a finishing request does not release a newer one: B stays busy while A’s late answer lands (programmatic)', async () => {
    const tab = page();
    await tab.open('site-a', null);
    const answerA = held();
    const answerB = held();
    mocks.importPost.mockImplementationOnce(() => answerA.promise).mockImplementationOnce(() => answerB.promise);
    await tab.press();
    await tab.open('site-b', null);
    expect(tab.isBusy()).toBe(false);
    await tab.press();
    expect(tab.isBusy()).toBe(true);
    await answerA.answer(ok());
    expect(tab.isBusy()).toBe(true);
    expect(mocks.success).not.toHaveBeenCalled();
    await tab.press();
    expect(posts()).toEqual([{ param: { projectId: 'site-a' } }, { param: { projectId: 'site-b' } }]);
    await answerB.answer(ok());
    expect(tab.isBusy()).toBe(false);
    expect(refreshed()).toEqual([...siteRefresh('site-a'), ...siteRefresh('site-b')]);
    expect(mocks.success.mock.calls).toEqual([[RESULT()]]);
  });

  it('programmatic: refreshes the site it was sent for when the same instance has moved to another, and reports nothing', async () => {
    const tab = page();
    await tab.open('site-a', null);
    const answer = held();
    mocks.importPost.mockImplementation(() => answer.promise);
    await tab.press();
    await tab.open('site-b', null);
    await answer.answer(ok());
    expect(posts()).toEqual([{ param: { projectId: 'site-a' } }]);
    expect(refreshed()).toEqual(siteRefresh('site-a'));
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('programmatic: A → B → A on the same instance is a new panel, still busy for A, and a stale failure is not reported', async () => {
    const tab = page();
    await tab.open('site-a', null);
    const answer = held();
    mocks.importPost.mockImplementation(() => answer.promise);
    await tab.press();
    await tab.open('site-b', null);
    expect(tab.isBusy()).toBe(false);
    await tab.open('site-a', null);
    expect(tab.isBusy()).toBe(true);
    await tab.press();
    await answer.drop(new TypeError('fetch failed'));
    expect(posts()).toHaveLength(1);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(refreshed()).toEqual([]);
  });
});
