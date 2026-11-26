// @vitest-environment jsdom
// Connect and Save of a Slack, Discord or Zapier webhook in the Integrations tab. The real tab, the app's own
// QueryClient and API module (the Hono RPC client); only `fetch` is replaced, and its answers are held until the
// test gives them. No provider is reached. Every URL is a fictional `.example.test` fixture.
//
// The catalog here offers Slack, Discord and Zapier as `available`. Production marks them `coming_soon` today
// (INTEGRATION_CATALOG), which shows only Remove, so this form is reachable only once that is turned off.
import { INTEGRATION_CATALOG, type IntegrationCatalogEntry } from '@nibleaf/shared/integrations';
import { dehydrate, onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), locale: 'en' }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => `${mocks.locale}:${key}` }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <a className={className} href="#settings">
      {children}
    </a>
  ),
}));
vi.mock('@/features/site-analytics-settings/components/analytics-settings', () => ({ AnalyticsSettings: () => null }));
// `services/api` as the browser runs it: Vitest has no Start compiler, so take its client branch.
vi.mock('@tanstack/react-start', () => ({ createIsomorphicFn: () => ({ server: () => ({ client: (client: () => string) => client }) }) }));
vi.mock('@/env.server', () => ({ serverEnv: {} }));
vi.mock('@nibleaf/i18n/runtime', () => ({ getLocale: () => mocks.locale }));
vi.mock('@nibleaf/server/rpc', async () => ({ hcWithType: (await import('hono/client')).hc }));

import { queryKeys } from '@/hooks/api/query-keys';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { resetDashboardSession } from '@/integrations/tanstack-query/session-cache';
import { IntegrationsTab } from './integrations-tab';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

// Fictional, low-entropy fixtures; never real credentials.
const URL_A = 'https://hooks.example.test/services/T0FIXTURE/B0FIXTURE/fixture-webhook-aaaa';
const URL_B = 'https://hooks.example.test/services/T0FIXTURE/B0FIXTURE/fixture-webhook-bbbb';
const SECRETS = [URL_A, URL_B, 'fixture-webhook-aaaa', 'fixture-webhook-bbbb'];

type Provider = 'slack' | 'discord' | 'zapier';
type Connection = NonNullable<IntegrationCatalogEntry['connection']>;
type Sent = { method: string; path: string; body: Record<string, unknown> };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** What the fixture server holds: each site's webhook connections. */
let stored: Record<string, Partial<Record<Provider, Connection>>>;
const connection = (projectId: string, providerId: Provider, revision: number, label: string | null): Connection => ({
  id: `connection-${projectId}-${providerId}`,
  providerId,
  category: 'webhook',
  ownership: 'project',
  status: 'active',
  health: { status: 'unverified', checkedAt: null, code: null },
  credential: { configured: true },
  config: { providerId, label },
  revision,
  createdAt: '2026-11-16T09:00:00.000Z',
  updatedAt: '2026-11-16T09:00:00.000Z',
});
const catalog = (projectId: string) =>
  INTEGRATION_CATALOG.filter((manifest) => manifest.category === 'webhook').map((manifest) => ({
    ...manifest,
    availability: 'available',
    connection: stored[projectId]?.[manifest.id as Provider] ?? null,
  }));

/** The server's answer to a write, from its own body, as the server stores it (the URL is never echoed back). */
const serve = ({ method, path, body }: Sent) => {
  const [, projectId, , providerFromPath] = path.replace('/api/app/projects/', '/').split('/');
  stored[projectId as string] ??= {};
  const site = stored[projectId as string] as Partial<Record<Provider, Connection>>;
  const providerId = (providerFromPath ?? body.providerId) as Provider;
  const current = site[providerId];
  if (method === 'POST') {
    if (current) return json(409, { error: { code: 'integration:already_connected', message: 'Already connected.' } });
    site[providerId] = connection(projectId as string, providerId, 1, (body.label as string | undefined) ?? null);
  } else {
    if (!current || current.revision !== body.expectedRevision)
      return json(409, { error: { code: 'integration:revision_conflict', message: 'The integration changed.' } });
    site[providerId] = connection(projectId as string, providerId, current.revision + 1, (body.label as string | null) ?? null);
  }
  return json(200, { data: site[providerId] });
};

const sent: Sent[] = [];
const reads = vi.fn<(projectId: string) => Promise<Response>>();
const writes = vi.fn<(request: Sent) => Promise<Response>>();
const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? 'GET';
  if (method === 'GET') return reads(url.pathname.split('/')[4] as string);
  const request = { method, path: url.pathname, body: JSON.parse(String(init?.body)) };
  sent.push(request);
  return writes(request);
});
const writesSent = () => sent.filter(({ method }) => method === 'POST' || method === 'PATCH');

const settle = async () => {
  for (let tick = 0; tick < 5; tick += 1) await act(async () => new Promise((done) => setTimeout(done, 0)));
};
function held() {
  let resolve: (value: Response) => void = () => undefined;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return {
    promise,
    answer: async (response: Response | (() => Response)) => {
      await act(async () => resolve(typeof response === 'function' ? response() : response));
      await settle();
    },
  };
}
const holdWrite = () => {
  const write = held();
  writes.mockImplementationOnce(() => write.promise);
  return write;
};

let container: HTMLDivElement;
let root: Root;
let client: ReturnType<typeof createQueryClient>;
const project = (id: string) => ({ id, name: 'Fixture docs' }) as Parameters<typeof IntegrationsTab>[0]['project'];

const k = (key: string) => `${mocks.locale}:${key}`;
const buttons = () => [...container.querySelectorAll('button')];
const button = (label: string) => buttons().find((item) => item.textContent?.includes(k(label)));
const press = async (element: HTMLElement | undefined) => {
  if (!element) throw new Error('nothing to press');
  await act(async () => element.click());
  await settle();
};
let shownSite = 'site-a';
/** The tab for a site, as the settings route mounts it (keyed by site), with the integration the URL opens. */
const tab = async (projectId = 'site-a', integration?: Provider) => {
  shownSite = projectId;
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <IntegrationsTab integration={integration} key={`integrations-${projectId}`} project={project(projectId)} projectId={projectId} />
      </QueryClientProvider>,
    ),
  );
  await settle();
};
/** Opens an integration's page, as following its card's link does. */
const open = (providerId: Provider = 'slack', projectId = 'site-a') => tab(projectId, providerId);
/** Back to the hub, as the back link or the browser's Back does. */
const back = () => tab(shownSite);
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
const submit = () => container.querySelector<HTMLButtonElement>('form button[type="submit"]') as HTMLButtonElement;
const isBusy = () => submit().getAttribute('aria-busy') === 'true';
const successes = () => mocks.success.mock.calls.map(([message]) => message);
const errors = () => mocks.error.mock.calls.map(([message]) => message);
const catalogReads = (projectId: string) => reads.mock.calls.filter(([site]) => site === projectId).length;

/**
 * Nothing the app keeps holds a fixture URL: no mutation (a send is a direct request), no query's data or error,
 * no dehydrated state (every mutation and query, or the default), no console line and no toast.
 */
const expectNoUrlKept = () => {
  const mutations = client.getMutationCache().getAll();
  const kept = JSON.stringify([
    mutations.map(({ state, options }) => [state, options.meta, String(state.error ?? ''), (state.error as Error | null)?.message]),
    client
      .getQueryCache()
      .getAll()
      .map(({ state, options }) => [state.data, options.meta, String(state.error ?? '')]),
    dehydrate(client, { shouldDehydrateMutation: () => true, shouldDehydrateQuery: () => true }),
    dehydrate(client),
    vi
      .mocked(console.error)
      .mock.calls.flat()
      .map((item) => (item instanceof Error ? { ...item, message: item.message, cause: String(item.cause ?? '') } : String(item))),
    successes(),
    errors(),
  ]);
  for (const secret of SECRETS) expect(kept).not.toContain(secret);
  expect(mutations).toEqual([]);
};

beforeEach(() => {
  mocks.locale = 'en';
  stored = { 'site-a': {}, 'site-b': {} };
  sent.length = 0;
  client = createQueryClient();
  vi.stubGlobal('fetch', transport);
  reads.mockReset().mockImplementation(async (projectId) => json(200, { data: catalog(projectId) }));
  writes.mockReset().mockImplementation(async (request) => serve(request));
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

/** A refusal that echoes the URL in every field the client reads: message, code, details and Retry-After. */
const echoed = (status = 422) =>
  json(
    status,
    {
      error: {
        message: `Webhook ${URL_A} refused`,
        code: `integration:${URL_A}`,
        details: { reason: URL_A, path: URL_A, errors: [{ message: URL_A, path: URL_A }] },
      },
    },
    { 'retry-after': URL_A },
  );

describe('the webhook URL never stays in a cache', () => {
  it('Connect: held, echoed refusal, corrected and retried, unmounted, then a session reset', async () => {
    await open();
    await type('slack-url', URL_A);
    const write = holdWrite();
    await press(submit());
    expect(writesSent()).toHaveLength(1);
    expect(writesSent()[0]?.body.webhookUrl).toBe(URL_A);
    expect(isBusy()).toBe(true);
    expectNoUrlKept();

    await write.answer(echoed());
    expect(errors()).toEqual([k('settings.integrations.actionError')]);
    expect(field('slack-url').value).toBe(URL_A);
    expectNoUrlKept();

    await type('slack-url', URL_B);
    await press(submit());
    expect(writesSent()[1]?.body.webhookUrl).toBe(URL_B);
    expect(successes()).toEqual([k('settings.integrations.connectedToast')]);
    expect(field('slack-url').value).toBe('');
    expectNoUrlKept();

    await act(async () => root.unmount());
    root = createRoot(container);
    expectNoUrlKept();
    await act(async () => resetDashboardSession(client));
    expectNoUrlKept();
  });

  it('Save with a new URL: held, then answered, keeps nothing either', async () => {
    stored['site-a'] = { slack: connection('site-a', 'slack', 3, 'Alerts') };
    await open();
    await type('slack-url', URL_A);
    const write = holdWrite();
    await press(submit());
    expect(writesSent()[0]).toMatchObject({ method: 'PATCH', body: { webhookUrl: URL_A, replaceCredential: true, expectedRevision: 3 } });
    expectNoUrlKept();
    await write.answer(() => serve(writesSent()[0] as Sent));
    expect(successes()).toEqual([k('settings.integrations.updatedToast')]);
    expectNoUrlKept();
  });

  it('a session reset while the send is held: the answer says and refreshes nothing, and nothing keeps the URL', async () => {
    await open();
    await type('slack-url', URL_A);
    const write = holdWrite();
    await press(submit());
    await act(async () => resetDashboardSession(client));
    await settle();
    const before = reads.mock.calls.length;
    await write.answer(echoed());
    expect([successes(), errors()]).toEqual([[], []]);
    expect(reads.mock.calls.length).toBe(before);
    expectNoUrlKept();
  });

  it('unmounted while held: an echoed refusal says nothing; a success still refreshes the site', async () => {
    await open();
    await type('slack-url', URL_A);
    const refused = holdWrite();
    await press(submit());
    await act(async () => root.unmount());
    root = createRoot(container);
    await refused.answer(echoed());
    expect(errors()).toEqual([]);
    expectNoUrlKept();

    await open();
    await type('slack-url', URL_A);
    const accepted = holdWrite();
    await press(submit());
    await act(async () => root.unmount());
    root = createRoot(container);
    await accepted.answer(() => serve(writesSent()[1] as Sent));
    expect(successes()).toEqual([]);
    expect(client.getQueryState(queryKeys.integrations.all('site-a'))?.isInvalidated).toBe(true);
    expectNoUrlKept();
  });

  it('offline: the send is not paused or replayed, and nothing keeps the URL', async () => {
    await open();
    await type('slack-url', URL_A);
    try {
      await act(async () => onlineManager.setOnline(false));
      const write = holdWrite();
      await press(submit());
      expect(writesSent()).toHaveLength(1);
      expectNoUrlKept();
      await write.answer(new Response(null, { status: 503 }));
      expect(errors()).toEqual([k('settings.integrations.actionError')]);
    } finally {
      await act(async () => onlineManager.setOnline(true));
      await settle();
    }
    expect(writesSent()).toHaveLength(1);
    expectNoUrlKept();
  });
});

describe('safe errors', () => {
  it('an echoed refusal keeps only the status: the code, message, details and Retry-After are dropped', async () => {
    await open();
    await type('slack-url', URL_A);
    writes.mockImplementationOnce(async () => echoed());
    await press(submit());
    expect(errors()).toEqual([k('settings.integrations.actionError')]);
    const logged = vi
      .mocked(console.error)
      .mock.calls.flat()
      .find((item) => item instanceof Error);
    expect(logged).toMatchObject({ status: 422, code: undefined, retryAfter: undefined, details: undefined });
    expectNoUrlKept();
  });

  it.each([
    ['integration:revision_conflict', 409, 'error.conflict'],
    ['integration:idempotency_conflict', 409, 'error.conflict'],
    ['integration:rate_limited', 429, 'error.rateLimited'],
    ['integration:credentials_invalid', 422, 'settings.integrations.errorCredentialsInvalid'],
    ['integration:verification_failed', 502, 'settings.integrations.errorVerificationFailed'],
    ['integration:provider_unavailable', 503, 'settings.integrations.errorProviderUnavailable'],
  ])('%s keeps its wording', async (code, status, message) => {
    await open();
    await type('slack-url', URL_A);
    writes.mockImplementationOnce(async () => json(status, { error: { code, message: `refused ${URL_A}` } }));
    await press(submit());
    expect(errors()).toEqual([k(message)]);
    expectNoUrlKept();
  });

  it('an unknown code falls back to the status, and a numeric Retry-After is kept', async () => {
    await open();
    await type('slack-url', URL_A);
    writes.mockImplementationOnce(async () => json(429, { error: { code: 'rate:other', message: 'slow down' } }, { 'retry-after': '30' }));
    await press(submit());
    expect(errors()).toEqual([k('error.rateLimited')]);
    const logged = vi
      .mocked(console.error)
      .mock.calls.flat()
      .find((item) => item instanceof Error);
    expect(logged).toMatchObject({ status: 429, retryAfter: '30', code: undefined });
  });

  it('a network failure reads as one', async () => {
    await open();
    await type('slack-url', URL_A);
    writes.mockImplementationOnce(async () => {
      throw new TypeError(`fetch failed for ${URL_A}`);
    });
    await press(submit());
    expect(errors()).toEqual([k('error.network')]);
    expectNoUrlKept();
  });
});

describe('the request', () => {
  it('Connect sends the provider, the URL, the trimmed label and a new idempotency key per accepted press', async () => {
    await open('discord');
    await type('discord-label', '  Releases  ');
    await type('discord-url', URL_A);
    writes.mockImplementationOnce(async () => json(503, { error: { code: 'integration:provider_unavailable' } }));
    await press(submit());
    await press(submit());
    const [first, second] = writesSent();
    expect(first).toMatchObject({ method: 'POST', path: '/api/app/projects/site-a/integrations' });
    expect(first?.body).toEqual({ providerId: 'discord', webhookUrl: URL_A, label: 'Releases', idempotencyKey: expect.any(String) });
    expect(second?.body.idempotencyKey).not.toBe(first?.body.idempotencyKey);
  });

  it('Connect with a blank label sends no label; a blank URL sends nothing and says it is required', async () => {
    await open('zapier');
    await act(async () => submit().form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await settle();
    expect(writesSent()).toEqual([]);
    expect(errors()).toEqual([k('settings.integrations.webhookRequired')]);
    await type('zapier-url', URL_A);
    await press(submit());
    expect(writesSent()[0]?.body).toEqual({ providerId: 'zapier', webhookUrl: URL_A, idempotencyKey: expect.any(String) });
  });

  it('Save with a blank URL keeps the stored one: no URL, no replaceCredential; a cleared label is sent as null', async () => {
    stored['site-a'] = { slack: connection('site-a', 'slack', 3, 'Alerts') };
    await open();
    expect(field('slack-label').value).toBe('Alerts');
    await type('slack-label', '');
    await press(submit());
    expect(writesSent()[0]).toMatchObject({ method: 'PATCH', path: '/api/app/projects/site-a/integrations/slack' });
    expect(writesSent()[0]?.body).toEqual({ providerId: 'slack', label: null, expectedRevision: 3, idempotencyKey: expect.any(String) });
    expect(successes()).toEqual([k('settings.integrations.updatedToast')]);
  });

  it('a success refreshes the site it was for', async () => {
    await open();
    const before = catalogReads('site-a');
    await type('slack-url', URL_A);
    await press(submit());
    expect(catalogReads('site-a')).toBe(before + 1);
    expect(container.textContent).toContain(k('settings.integrations.statusTitle'));
    expect(button('common.save')).toBeDefined();
  });
});

describe('revision conflict', () => {
  it('rereads the site (even with nothing showing it), shows one error, keeps the edits, and the retry sends the new revision', async () => {
    stored['site-a'] = { slack: connection('site-a', 'slack', 3, 'Alerts') };
    await open();
    await type('slack-label', 'Mine');
    await type('slack-url', URL_A);
    // Someone else saves first.
    stored['site-a'] = { slack: connection('site-a', 'slack', 4, 'Theirs') };
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await press(submit());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.integrations.all('site-a'), exact: true, refetchType: 'all' });
    expect(errors()).toEqual([k('error.conflict')]);
    expect(field('slack-label').value).toBe('Mine');
    expect(field('slack-url').value).toBe(URL_A);

    await press(submit());
    expect(writesSent().map(({ body }) => body.expectedRevision)).toEqual([3, 4]);
    expect(successes()).toEqual([k('settings.integrations.updatedToast')]);
    expect(stored['site-a']?.slack?.config).toEqual({ providerId: 'slack', label: 'Mine' });
    expectNoUrlKept();
  });

  it('an untouched label takes the reread one', async () => {
    stored['site-a'] = { slack: connection('site-a', 'slack', 3, 'Alerts') };
    await open();
    await type('slack-url', URL_A);
    stored['site-a'] = { slack: connection('site-a', 'slack', 4, 'Theirs') };
    await press(submit());
    expect(field('slack-label').value).toBe('Theirs');
    expect(field('slack-url').value).toBe(URL_A);
  });
});

describe('ownership of the answer', () => {
  it('a URL corrected during the send is kept: the answer says nothing and Save waits for the send to end', async () => {
    await open();
    await type('slack-url', URL_A);
    const write = holdWrite();
    await press(submit());
    await type('slack-url', URL_B);
    expect(isBusy()).toBe(true);
    await press(submit());
    expect(writesSent()).toHaveLength(1);
    await write.answer(() => serve(writesSent()[0] as Sent));
    expect([successes(), errors()]).toEqual([[], []]);
    expect(field('slack-url').value).toBe(URL_B);
    expect(isBusy()).toBe(false);
    // The connection now exists: the corrected URL is saved over it.
    await press(submit());
    expect(writesSent()[1]).toMatchObject({ method: 'PATCH', body: { webhookUrl: URL_B, replaceCredential: true, expectedRevision: 1 } });
    expect(successes()).toEqual([k('settings.integrations.updatedToast')]);
    expectNoUrlKept();
  });

  it('URL A → B → A retires the press too: a refusal says nothing', async () => {
    await open();
    await type('slack-url', URL_A);
    const write = holdWrite();
    await press(submit());
    await type('slack-url', URL_B);
    await type('slack-url', URL_A);
    await write.answer(echoed());
    expect(errors()).toEqual([]);
    expect(field('slack-url').value).toBe(URL_A);
  });

  it('a label edited during the send keeps the press and the newer label', async () => {
    stored['site-a'] = { slack: connection('site-a', 'slack', 3, 'Alerts') };
    await open();
    await type('slack-label', 'Pressed');
    await type('slack-url', URL_A);
    const write = holdWrite();
    await press(submit());
    await type('slack-label', 'Newer');
    await write.answer(() => serve(writesSent()[0] as Sent));
    expect(successes()).toEqual([k('settings.integrations.updatedToast')]);
    expect(field('slack-url').value).toBe('');
    expect(field('slack-label').value).toBe('Newer');
  });

  it('provider A → B → A: the reopened panel is busy, quiet, and then fresh', async () => {
    await open('slack');
    await type('slack-url', URL_A);
    const write = holdWrite();
    await press(submit());
    await back();
    await open('discord');
    expect(isBusy()).toBe(false);
    await back();
    await open('slack');
    expect(field('slack-url').value).toBe('');
    expect(isBusy()).toBe(true);
    await press(submit());
    expect(writesSent()).toHaveLength(1);
    await write.answer(() => serve(writesSent()[0] as Sent));
    expect([successes(), errors()]).toEqual([[], []]);
    expect(isBusy()).toBe(false);
    expect(button('common.save')).toBeDefined();
  });

  it('site A → B → A: B is independent, the answer refreshes A only, and says nothing', async () => {
    await open('slack', 'site-a');
    await type('slack-url', URL_A);
    const write = holdWrite();
    await press(submit());
    await open('slack', 'site-b');
    expect(isBusy()).toBe(false);
    await open('slack', 'site-a');
    expect(isBusy()).toBe(true);
    const [readsA, readsB] = [catalogReads('site-a'), catalogReads('site-b')];
    await write.answer(() => serve(writesSent()[0] as Sent));
    expect([successes(), errors()]).toEqual([[], []]);
    expect(catalogReads('site-a')).toBe(readsA + 1);
    expect(catalogReads('site-b')).toBe(readsB);
    expect(stored['site-b']).toEqual({});
  });

  it('a locale change keeps the press and words its answer in the language shown', async () => {
    await open();
    await type('slack-url', URL_A);
    const write = holdWrite();
    await press(submit());
    mocks.locale = 'ar';
    await tab();
    await write.answer(echoed());
    expect(errors()).toEqual(['ar:settings.integrations.actionError']);
  });
});

describe('duplicates', () => {
  it('two submits in the same task send one request', async () => {
    await open();
    await type('slack-url', URL_A);
    const write = holdWrite();
    await act(async () => {
      submit().form?.requestSubmit();
      submit().form?.requestSubmit();
    });
    await settle();
    expect(writesSent()).toHaveLength(1);
    await write.answer(() => serve(writesSent()[0] as Sent));
    expect(successes()).toEqual([k('settings.integrations.connectedToast')]);
  });

  it('a physical double press: the second lands on a busy, disabled button', async () => {
    await open();
    await type('slack-url', URL_A);
    const write = holdWrite();
    await press(submit());
    expect(submit().disabled).toBe(true);
    await press(submit());
    expect(writesSent()).toHaveLength(1);
    await write.answer(() => serve(writesSent()[0] as Sent));
    expect(writesSent()).toHaveLength(1);
  });

  it('a failure is not retried; the next press is a new request with a new key', async () => {
    await open();
    await type('slack-url', URL_A);
    writes.mockImplementationOnce(async () => new Response(null, { status: 500 }));
    await press(submit());
    expect(writesSent()).toHaveLength(1);
    expect(errors()).toEqual([k('settings.integrations.actionError')]);
    await press(submit());
    expect(writesSent()).toHaveLength(2);
    expect(writesSent()[1]?.body.idempotencyKey).not.toBe(writesSent()[0]?.body.idempotencyKey);
    expect(successes()).toEqual([k('settings.integrations.connectedToast')]);
  });
});

describe('the other actions are unchanged', () => {
  it('Deactivate still goes through its own request and disables Save while running', async () => {
    stored['site-a'] = { slack: connection('site-a', 'slack', 3, 'Alerts') };
    await open();
    const write = holdWrite();
    await press(button('settings.integrations.deactivate'));
    expect(writesSent()[0]).toMatchObject({ method: 'POST', path: '/api/app/projects/site-a/integrations/slack/deactivate' });
    expect(writesSent()[0]?.body).toEqual({ expectedRevision: 3, idempotencyKey: expect.any(String) });
    expect(submit().disabled).toBe(true);
    await write.answer(json(200, { data: connection('site-a', 'slack', 4, 'Alerts') }));
    expect(successes()).toEqual([k('settings.integrations.deactivatedToast')]);
  });
});
