// @vitest-environment jsdom
// The webhook Connect/Save command (Slack, Discord, Zapier) and its panel's lifetime. The real command, the real send
// (useWebhookIntegrationSave), the app's own QueryClient and API module; only `fetch` is replaced, and its answers are
// held until the test gives them. No provider is reached. Every URL and id is a fictional, low-entropy fixture.
//
// Programmatic cases keep a `save` past its panel, take one from a render React never committed, or swap the
// QueryClient under a mounted panel. The app does none of these today: the Integrations tab keys panels by site,
// AppGuard remounts on an account change, and Slack, Discord and Zapier are `coming_soon`. Ordinary cases are the
// keyed navigation and the presses the app does make.
import type { MessageKey } from '@nibleaf/i18n';
import { dehydrate, type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode, StrictMode, Suspense, startTransition, use } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), locale: 'en' }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));
// The words of the render that made them, as useT gives them.
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => {
    const locale = mocks.locale;
    return (key: string) => `${locale}:${key}`;
  },
}));
// `services/api` as the browser runs it: Vitest has no Start compiler, so take its client branch.
vi.mock('@tanstack/react-start', () => ({ createIsomorphicFn: () => ({ server: () => ({ client: (client: () => string) => client }) }) }));
vi.mock('@/env.server', () => ({ serverEnv: {} }));
vi.mock('@nibleaf/i18n/runtime', () => ({ getLocale: () => mocks.locale }));
vi.mock('@nibleaf/server/rpc', async () => ({ hcWithType: (await import('hono/client')).hc }));

import { queryKeys } from '@/hooks/api/query-keys';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { resetDashboardSession } from '@/integrations/tanstack-query/session-cache';
import type { WebhookIntegrationSave } from '../api/webhook-integration-save';
import { useWebhookIntegrationSaveCommand } from './use-webhook-integration-save-command';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const SITE_A = '00000000-0000-4000-8000-000000000001';
const SITE_B = '00000000-0000-4000-8000-000000000002';
const URL_1 = 'https://hooks.example.test/fixture-0001';
const URL_2 = 'https://hooks.example.test/fixture-0002';

type Provider = 'slack' | 'discord' | 'zapier';
type Command = ReturnType<typeof useWebhookIntegrationSaveCommand>;
type Sent = { method: string; path: string; body: Record<string, unknown> };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = (providerId: Provider = 'slack', revision = 1) => json(200, { data: { id: `connection-${providerId}`, providerId, revision } });
const refused = () => json(422, { error: { code: 'integration:invalid_config', message: 'Refused.' } });
const conflict = () => json(409, { error: { code: 'integration:revision_conflict', message: 'The integration changed.' } });

const sent: Sent[] = [];
const writes = vi.fn<(request: Sent) => Promise<Response>>();
const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = { method: init?.method ?? 'GET', path: new URL(String(input)).pathname, body: JSON.parse(String(init?.body ?? '{}')) };
  sent.push(request);
  return writes(request);
});

const settle = async () => {
  for (let tick = 0; tick < 5; tick += 1) await act(async () => new Promise((done) => setTimeout(done, 0)));
};
const holdWrite = () => {
  let resolve: (value: Response) => void = () => undefined;
  writes.mockImplementationOnce(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  return {
    answer: async (response: Response) => {
      await act(async () => resolve(response));
      await settle();
    },
  };
};

/** Every render of every panel, by name, committed or not. */
const renders = new Map<string, Command[]>();
const last = (name: string) => {
  const command = renders.get(name)?.at(-1);
  if (!command) throw new Error(`no render of ${name}`);
  return command;
};
function Panel({ name, projectId = SITE_A, providerId = 'slack' }: { name: string; projectId?: string; providerId?: Provider }) {
  const command = useWebhookIntegrationSaveCommand({
    projectId,
    providerId,
    providerName: `settings.integrations.provider.${providerId}` as MessageKey,
  });
  renders.set(name, [...(renders.get(name) ?? []), command]);
  return <output data-panel={name} data-pending={String(command.pending)} data-site={projectId} />;
}
const on = (queryClient: QueryClient, children: ReactNode) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
const panelOf = (name: string) => container.querySelector(`[data-panel="${name}"]`);
const busy = (name: string) => panelOf(name)?.getAttribute('data-pending') === 'true';

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
const show = async (tree: ReactNode) => {
  await act(async () => root.render(tree));
  await settle();
};

const connect = (projectId = SITE_A, providerId: Provider = 'slack'): WebhookIntegrationSave => ({
  projectId,
  providerId,
  revision: null,
  label: '',
});
const edit = (projectId = SITE_A, providerId: Provider = 'slack', revision = 1): WebhookIntegrationSave => ({
  projectId,
  providerId,
  revision,
  label: '',
});
/** Presses `command` and returns whether it was accepted; `saved` counts the field clears it asked for. */
const press = async (command: Command, request = connect(), webhookUrl = URL_1, saved = vi.fn()) => {
  let accepted = false;
  await act(async () => {
    accepted = command.save(request, webhookUrl, saved);
  });
  return accepted;
};

/** The site's integrations, cached in `queryClient` with no observer; `reads` counts their rereads. */
const reads = vi.fn(async () => []);
const cacheSite = async (queryClient: QueryClient, projectId = SITE_A) => {
  await queryClient.prefetchQuery({ queryKey: queryKeys.integrations.all(projectId), queryFn: reads });
  reads.mockClear();
};
const invalidated = (queryClient: QueryClient, projectId = SITE_A) =>
  queryClient.getQueryState(queryKeys.integrations.all(projectId))?.isInvalidated === true;

const successes = () => mocks.success.mock.calls.map(([message]) => message);
const errors = () => mocks.error.mock.calls.map(([message]) => message);
const quiet = () => {
  expect(successes()).toEqual([]);
  expect(errors()).toEqual([]);
};
/** The no-cache contract: no mutation, no query, no dehydrated state and no toast holds a URL. */
const expectNoUrlKept = (...clients: QueryClient[]) => {
  for (const queryClient of clients) {
    expect(queryClient.getMutationCache().getAll()).toEqual([]);
    const kept = JSON.stringify([
      queryClient
        .getQueryCache()
        .getAll()
        .map(({ state, options }) => [state.data, options.meta, String(state.error ?? '')]),
      dehydrate(queryClient, { shouldDehydrateMutation: () => true, shouldDehydrateQuery: () => true }),
      successes(),
      errors(),
    ]);
    for (const url of [URL_1, URL_2]) expect(kept).not.toContain(url);
  }
};

beforeEach(() => {
  mocks.locale = 'en';
  sent.length = 0;
  renders.clear();
  client = createQueryClient();
  vi.stubGlobal('fetch', transport);
  writes.mockReset().mockImplementation(async ({ body }) => ok(body.providerId as Provider));
  reads.mockClear();
  mocks.success.mockReset();
  mocks.error.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('a retained save sends nothing once its panel is gone (programmatic)', () => {
  it('kept past an unmount in the same session: refused, no request, nothing said', async () => {
    await show(on(client, <Panel name="p" />));
    const kept = last('p');
    await show(on(client, null));
    const saved = vi.fn();
    expect(await press(kept, connect(), URL_1, saved)).toBe(false);
    await settle();
    expect(sent).toEqual([]);
    expect(saved).not.toHaveBeenCalled();
    quiet();
  });

  it('kept past a QueryClient replaced without a remount: refused; the current save still sends', async () => {
    await show(on(client, <Panel name="p" />));
    const kept = last('p');
    const replacement = createQueryClient();
    await show(on(replacement, <Panel name="p" />));
    expect(last('p')).not.toBe(kept);
    expect(await press(kept)).toBe(false);
    await settle();
    expect(sent).toEqual([]);
    expect(await press(last('p'))).toBe(true);
    await settle();
    expect(sent).toHaveLength(1);
  });

  it('kept past a site or provider change without a remount: refused', async () => {
    await show(on(client, <Panel name="p" />));
    const siteA = last('p');
    await show(on(client, <Panel name="p" projectId={SITE_B} />));
    const siteB = last('p');
    await show(on(client, <Panel name="p" projectId={SITE_B} providerId="discord" />));
    expect(await press(siteA)).toBe(false);
    expect(await press(siteB, connect(SITE_B))).toBe(false);
    await settle();
    expect(sent).toEqual([]);
  });

  it('a save asked to send another site or provider than its panel: refused', async () => {
    await show(on(client, <Panel name="p" />));
    expect(await press(last('p'), connect(SITE_B))).toBe(false);
    expect(await press(last('p'), connect(SITE_A, 'discord'))).toBe(false);
    await settle();
    expect(sent).toEqual([]);
    expect(busy('p')).toBe(false);
  });

  it("a retire kept past a QueryClient replacement leaves the new panel's press alone", async () => {
    await show(on(client, <Panel name="p" />));
    const kept = last('p');
    await show(on(createQueryClient(), <Panel name="p" />));
    const write = holdWrite();
    const saved = vi.fn();
    expect(await press(last('p'), connect(), URL_1, saved)).toBe(true);
    await act(async () => kept.retire());
    await write.answer(ok());
    expect(successes()).toEqual(['en:settings.integrations.connectedToast']);
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it('taken from a render React never committed: refused; the committed save still sends', async () => {
    const never = new Promise<never>(() => undefined);
    function Wait(): null {
      use(never);
      return null;
    }
    const tree = (projectId: string, waiting: boolean) =>
      on(
        client,
        <Suspense fallback={null}>
          <Panel name="p" projectId={projectId} />
          {waiting ? <Wait /> : null}
        </Suspense>,
      );
    await show(tree(SITE_A, false));
    const committed = last('p');
    // A transition to site B that suspends: React renders B, keeps A on screen and never commits B.
    await act(async () => startTransition(() => root.render(tree(SITE_B, true))));
    const abandoned = last('p');
    expect(abandoned).not.toBe(committed);
    expect(panelOf('p')?.getAttribute('data-site')).toBe(SITE_A);

    expect(await press(abandoned, connect(SITE_B))).toBe(false);
    await settle();
    expect(sent).toEqual([]);
    expect(await press(committed)).toBe(true);
    await settle();
    expect(sent.map(({ path }) => path)).toEqual([`/api/app/projects/${SITE_A}/integrations`]);
  });
});

describe('a held send whose panel changed under it (programmatic)', () => {
  it('QueryClient replaced, late success: nothing said or cleared in the new panel; the original site is refreshed and released', async () => {
    const original = client;
    const replacement = createQueryClient();
    await cacheSite(original);
    const tree = (panelClient: QueryClient) => (
      <>
        {on(panelClient, <Panel name="p" />)}
        {on(original, <Panel name="watch" />)}
      </>
    );
    await show(tree(original));
    const write = holdWrite();
    const oldSaved = vi.fn();
    expect(await press(last('p'), connect(), URL_1, oldSaved)).toBe(true);
    expect(busy('watch')).toBe(true);

    await show(tree(replacement));
    // The new client has no send in flight: the replacement panel is not busy and its own press is its own.
    expect(busy('p')).toBe(false);
    const newWrite = holdWrite();
    const newSaved = vi.fn();
    expect(await press(last('p'), connect(), URL_2, newSaved)).toBe(true);

    await write.answer(ok());
    quiet();
    expect(oldSaved).not.toHaveBeenCalled();
    expect(newSaved).not.toHaveBeenCalled();
    expect(invalidated(original)).toBe(true);
    // The original count is released on the original client.
    expect(busy('watch')).toBe(false);

    await newWrite.answer(ok());
    expect(successes()).toEqual(['en:settings.integrations.connectedToast']);
    expect(newSaved).toHaveBeenCalledTimes(1);
    expect(oldSaved).not.toHaveBeenCalled();
    expectNoUrlKept(original, replacement);
  });

  it('QueryClient replaced, late refusal: no error in the new panel; a conflict still rereads the original site', async () => {
    const original = client;
    await cacheSite(original);
    await show(on(original, <Panel name="p" />));
    const refusal = holdWrite();
    expect(await press(last('p'))).toBe(true);
    await show(on(createQueryClient(), <Panel name="p" />));
    await refusal.answer(refused());
    quiet();

    await show(on(original, <Panel name="p" />));
    const stale = holdWrite();
    expect(await press(last('p'), edit())).toBe(true);
    await show(on(createQueryClient(), <Panel name="p" />));
    await stale.answer(conflict());
    quiet();
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it('site changed without a remount: the answer refreshes the original site only and says nothing in the new one', async () => {
    await cacheSite(client, SITE_A);
    await cacheSite(client, SITE_B);
    await show(on(client, <Panel name="p" />));
    const write = holdWrite();
    const saved = vi.fn();
    expect(await press(last('p'), connect(), URL_1, saved)).toBe(true);

    await show(on(client, <Panel name="p" projectId={SITE_B} />));
    expect(busy('p')).toBe(false);
    await write.answer(ok());
    quiet();
    expect(saved).not.toHaveBeenCalled();
    expect(invalidated(client, SITE_A)).toBe(true);
    expect(invalidated(client, SITE_B)).toBe(false);
  });

  it('unmounted while held: a late success says nothing but refreshes the site; a late refusal says nothing', async () => {
    await cacheSite(client);
    await show(on(client, <Panel name="p" />));
    const success = holdWrite();
    const saved = vi.fn();
    expect(await press(last('p'), connect(), URL_1, saved)).toBe(true);
    await show(on(client, null));
    await success.answer(ok());
    quiet();
    expect(saved).not.toHaveBeenCalled();
    expect(invalidated(client)).toBe(true);

    await show(on(client, <Panel name="p" />));
    const refusal = holdWrite();
    expect(await press(last('p'))).toBe(true);
    await show(on(client, null));
    await refusal.answer(refused());
    quiet();
    expectNoUrlKept(client);
  });
});

describe('ordinary presses', () => {
  it('StrictMode: one press sends one request and is answered once; (programmatic) the save kept past the unmount is refused', async () => {
    await show(
      on(
        client,
        <StrictMode>
          <Panel name="p" />
        </StrictMode>,
      ),
    );
    const saved = vi.fn();
    expect(await press(last('p'), connect(), URL_1, saved)).toBe(true);
    await settle();
    expect(sent).toHaveLength(1);
    expect(successes()).toEqual(['en:settings.integrations.connectedToast']);
    expect(saved).toHaveBeenCalledTimes(1);

    const kept = last('p');
    await show(on(client, null));
    expect(await press(kept)).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it('two presses in the same tick send one request', async () => {
    await show(on(client, <Panel name="p" />));
    const command = last('p');
    const accepted: boolean[] = [];
    await act(async () => {
      accepted.push(command.save(connect(), URL_1, vi.fn()), command.save(connect(), URL_1, vi.fn()));
    });
    await settle();
    expect(accepted).toEqual([true, false]);
    expect(sent).toHaveLength(1);
  });

  it('a failure, then a retry: one error, then a new request with a new key that is answered', async () => {
    writes.mockImplementationOnce(async () => refused());
    await show(on(client, <Panel name="p" />));
    const saved = vi.fn();
    expect(await press(last('p'), connect(), URL_1, saved)).toBe(true);
    await settle();
    expect(errors()).toHaveLength(1);
    expect(saved).not.toHaveBeenCalled();

    expect(await press(last('p'), connect(), URL_1, saved)).toBe(true);
    await settle();
    expect(sent).toHaveLength(2);
    expect(sent[1]?.body.idempotencyKey).not.toBe(sent[0]?.body.idempotencyKey);
    expect(successes()).toEqual(['en:settings.integrations.connectedToast']);
    expect(saved).toHaveBeenCalledTimes(1);
    expectNoUrlKept(client);
  });

  it('an edited URL retires the press: its answer says nothing and still refreshes the site', async () => {
    await cacheSite(client);
    await show(on(client, <Panel name="p" />));
    const write = holdWrite();
    const saved = vi.fn();
    expect(await press(last('p'), connect(), URL_1, saved)).toBe(true);
    await act(async () => last('p').retire());
    await write.answer(ok());
    quiet();
    expect(saved).not.toHaveBeenCalled();
    expect(invalidated(client)).toBe(true);
  });

  it('a locale change keeps the press and words the answer in the language shown', async () => {
    await show(on(client, <Panel name="p" />));
    const write = holdWrite();
    expect(await press(last('p'), edit())).toBe(true);
    mocks.locale = 'ar';
    await show(on(client, <Panel name="p" />));
    await write.answer(ok());
    expect(successes()).toEqual(['ar:settings.integrations.updatedToast']);
  });

  it('an independent panel for the same site and provider is busy and refused; only the presser answers', async () => {
    await show(
      on(
        client,
        <>
          <Panel name="p" />
          <Panel name="other" />
          <Panel name="discord" providerId="discord" />
        </>,
      ),
    );
    const write = holdWrite();
    const saved = vi.fn();
    const otherSaved = vi.fn();
    expect(await press(last('p'), connect(), URL_1, saved)).toBe(true);
    expect(busy('other')).toBe(true);
    expect(busy('discord')).toBe(false);
    expect(await press(last('other'), connect(), URL_2, otherSaved)).toBe(false);

    await write.answer(ok());
    expect(successes()).toEqual(['en:settings.integrations.connectedToast']);
    expect(saved).toHaveBeenCalledTimes(1);
    expect(otherSaved).not.toHaveBeenCalled();
    expect(busy('other')).toBe(false);
    expect(sent).toHaveLength(1);
  });
});

describe('ordinary keyed navigation', () => {
  it('site A → B → A: B is independent; reopened A is busy and quiet, then fresh', async () => {
    await cacheSite(client, SITE_A);
    const at = (projectId: string) => show(on(client, <Panel key={projectId} name="p" projectId={projectId} />));
    await at(SITE_A);
    const write = holdWrite();
    const saved = vi.fn();
    expect(await press(last('p'), connect(), URL_1, saved)).toBe(true);

    await at(SITE_B);
    expect(busy('p')).toBe(false);
    expect(await press(last('p'), connect(SITE_B), URL_2)).toBe(true);
    await settle();
    expect(successes()).toEqual(['en:settings.integrations.connectedToast']);
    mocks.success.mockReset();

    await at(SITE_A);
    expect(busy('p')).toBe(true);
    expect(await press(last('p'))).toBe(false);
    await write.answer(ok());
    quiet();
    expect(saved).not.toHaveBeenCalled();
    expect(invalidated(client, SITE_A)).toBe(true);
    expect(busy('p')).toBe(false);
    expect(await press(last('p'))).toBe(true);
  });

  it('provider A → B → A: the reopened panel is busy and quiet', async () => {
    const at = (providerId: Provider) => show(on(client, <Panel key={providerId} name="p" providerId={providerId} />));
    await at('slack');
    const write = holdWrite();
    expect(await press(last('p'))).toBe(true);
    await at('discord');
    expect(busy('p')).toBe(false);
    await at('slack');
    expect(busy('p')).toBe(true);
    await write.answer(ok());
    quiet();
    expect(busy('p')).toBe(false);
  });

  it('an account change (session reset and remount) while held: the answer says and refreshes nothing', async () => {
    await cacheSite(client);
    await show(on(client, <Panel key="account-1" name="p" />));
    const write = holdWrite();
    expect(await press(last('p'))).toBe(true);
    await act(async () => resetDashboardSession(client));
    await show(on(client, <Panel key="account-2" name="p" />));
    expect(busy('p')).toBe(false);
    await write.answer(ok());
    quiet();
    expect(client.getQueryState(queryKeys.integrations.all(SITE_A))).toBeUndefined();
    expectNoUrlKept(client);
  });
});
