// @vitest-environment jsdom
// AI answers → a source card → Add/Manage key: the site's own OpenAI or OpenRouter key. The real ProviderKeyForm, its
// status query and its Check and Save requests with the app's own QueryClient; only HTTP is replaced (every API call is
// answered here) and a Check or Save can be held until the test answers it. Sites, keys and models are fictional:
// `test-key-000n` is a low-entropy placeholder, nothing like a provider key, and nothing reaches a provider.
//
// This file imports nothing this branch adds, so it also runs against main's form and hooks (the PR lists which cases
// pass there). Cases ordinary use reaches: pressing Check or Save (once or several times in a tick), a language change,
// the panel closing, another site or provider, offline, and a session change (AppGuard remounts the dashboard). Cases
// marked "programmatic" are not reachable from the page: editing the key while a Check or Save runs (the field is
// disabled then, on main too), a session ending at an exact await, and a replaced QueryClient.
import { translateFn } from '@nibleaf/i18n';
import { dehydrate, onlineManager, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  detailGet: vi.fn(),
  capabilityGet: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: mocks.success } }));
vi.mock('@nibleaf/i18n/react', async () => {
  const { translateFn: translate } = await vi.importActual<typeof import('@nibleaf/i18n')>('@nibleaf/i18n');
  // Bound to the language of the render that asked for it, as the app's translator is.
  const bound = (locale: 'en' | 'ar') => (key: Parameters<typeof translate>[0], variables?: Parameters<typeof translate>[1]) =>
    translate(key, variables, locale);
  return { useT: () => bound(mocks.locale), useLocale: () => ({ locale: mocks.locale, t: bound(mocks.locale) }) };
});
type Sent = { path: 'check' | 'save'; projectId: string; body: Record<string, unknown> };
/** Check and Save requests, held until the test answers them, in the order they were sent. */
const held: Array<Sent & { resolve: (value: Response) => void; reject: (error: unknown) => void }> = [];
vi.mock('@/services/api', () => {
  const answer = (path: string, request: { param: { projectId: string }; json?: Record<string, unknown> }) => {
    const projectId = request.param.projectId;
    if (path === 'settings.ai.$get') return mocks.detailGet(projectId);
    if (path === 'ai.draft-capability.$get') return mocks.capabilityGet(projectId);
    const kind = path === 'settings.ai.models.$post' ? 'check' : path === 'settings.ai.connection.$put' ? 'save' : null;
    if (!kind) throw new Error(`unexpected API call ${path}`);
    return new Promise<Response>((resolve, reject) => held.push({ path: kind, projectId, body: request.json ?? {}, resolve, reject }));
  };
  const node = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_target, property) => (typeof property === 'string' && property !== 'then' ? node([...path, property]) : undefined),
      apply: (_target, _this, args: unknown[]) => answer(path.slice(3).join('.'), args[0] as never),
    });
  return { api: node([]) };
});

import { queryKeys } from '@/hooks/api/query-keys';
import { aiDraftCapabilityQueryOptions } from '@/hooks/api/query-options';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { resetDashboardSession } from '@/integrations/tanstack-query/session-cache';
import { ProviderKeyForm } from './provider-key-form';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const KEY_A = 'test-key-0001';
const KEY_B = 'test-key-0002';
const KEYS = [KEY_A, KEY_B];
const t = (key: Parameters<typeof translateFn>[0]) => translateFn(key, undefined, mocks.locale);
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** Each site's saved connections: a saved OpenAI key at revision 2 unless a test changes it. */
let revision: number;
const provider = (id: string, rev = revision) => ({
  id,
  configured: true,
  revision: rev,
  verified: true,
  verifiedAt: null,
  answerModel: 'fixture-model-a',
});
const detail = (rev = revision) => ({ encryptionConfigured: true, providers: [provider('openai', rev), provider('openrouter', rev)] });
const models = (...ids: string[]) => json(200, { data: { models: ids.map((id) => ({ id })) } });
/** A refusal that echoes the key it was sent, in its message and its details. */
const echoed = (status: number, code: string, entry: Sent, headers?: Record<string, string>) =>
  json(
    status,
    { error: { code, message: `Provider said: ${String(entry.body.apiKey)} was refused`, details: { apiKey: entry.body.apiKey, reason: 'echo' } } },
    headers,
  );

/** Lets requests and queries settle: TanStack tells React on a timer, and main's toasts import sonner lazily. */
const settle = async () => {
  for (let tick = 0; tick < 6; tick += 1) await act(async () => new Promise((done) => setTimeout(done, 0)));
};

let client: ReturnType<typeof createQueryClient>;
let root: Root;
let host: HTMLDivElement;
let readsOf: () => string[];
const onSaved = vi.fn();

/** The form for a site and provider, as AI answers renders it in an open source card. */
const show = async (projectId = 'site-a', providerId: 'openai' | 'openrouter' = 'openai', extra: React.ReactNode = null) => {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ProviderKeyForm onSaved={onSaved} projectId={projectId} providerId={providerId} />
        {extra}
      </QueryClientProvider>,
    ),
  );
  await settle();
};
const hide = async () => {
  await act(async () => root.render(<QueryClientProvider client={client}>{null}</QueryClientProvider>));
  await settle();
};
const input = () => host.querySelector<HTMLInputElement>('input[name="ai-provider-api-key"]');
const type = async (value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input(), value);
    input()?.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const button = (label: Parameters<typeof translateFn>[0]) =>
  [...host.querySelectorAll('button')].find((item) => item.textContent?.includes(t(label)));
const checkButton = () => button('settings.smartAi.verifyModels');
const saveButton = () => button('common.save');
/** Presses Check `times` times in one task. */
const pressCheck = async (times = 1) => {
  await act(async () => {
    for (let press = 0; press < times; press += 1) checkButton()?.click();
  });
  await settle();
};
const pressSave = async (times = 1) => {
  await act(async () => {
    for (let press = 0; press < times; press += 1) saveButton()?.closest('form')?.requestSubmit();
  });
  await settle();
};
const consent = async () => {
  await act(async () => host.querySelector<HTMLElement>('[role="checkbox"]')?.click());
};
/** "Key verified, models loaded" (or "no models"), shown only once a Check has answered for the key in the field. */
const verified = () => host.querySelector('[role="status"]')?.textContent ?? null;
const answer = async (index: number, response: Response | ((entry: Sent) => Response)) => {
  const entry = held[index];
  if (!entry) throw new Error(`no held request #${index}`);
  await act(async () => entry.resolve(typeof response === 'function' ? response(entry) : response));
  await settle();
};
const errors = () => mocks.error.mock.calls.map(([message]) => message);
const sent = () => held.map(({ path, projectId, body }) => ({ path, projectId, body }));
/** What went to the console. */
const logged = () => (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat();

beforeEach(() => {
  mocks.locale = 'en';
  revision = 2;
  held.length = 0;
  onSaved.mockReset();
  mocks.detailGet.mockReset().mockImplementation(async () => json(200, { data: detail() }));
  mocks.capabilityGet.mockReset().mockImplementation(async () => json(200, { data: { available: true } }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  client = createQueryClient();
  const reads: string[] = [];
  const invalidate = client.invalidateQueries.bind(client);
  vi.spyOn(client, 'invalidateQueries').mockImplementation((filters, options) => {
    reads.push(JSON.stringify(filters?.queryKey));
    return invalidate(filters, options);
  });
  readsOf = () => reads;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  client.clear();
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  mocks.error.mockReset();
  mocks.success.mockReset();
});

/* ---------------------------------------------------------------- where the key could be kept */

/** Every own property (enumerable or not, symbols too), Map and Set entry reachable from `start`, as text. */
const graphText = (start: unknown) => {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  const stack: unknown[] = [start];
  while (stack.length > 0 && seen.size < 200_000) {
    const value = stack.pop();
    if (typeof value === 'string') parts.push(value);
    if (value === null || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) continue;
    seen.add(value);
    if (value instanceof Map) for (const [key, item] of value) stack.push(key, item);
    if (value instanceof Set) for (const item of value) stack.push(item);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (descriptor && 'value' in descriptor) stack.push(descriptor.value);
    }
  }
  return parts.join('\n');
};
/** What the QueryClient holds or would hand on: its object graph and every dehydration. */
const clientText = () =>
  [
    graphText(client),
    graphText(dehydrate(client)),
    graphText(dehydrate(client, { shouldDehydrateMutation: () => true, shouldDehydrateQuery: () => true })),
  ].join('\n');
/** No key in the QueryClient, the console, a toast or the page (outside the key field), and no mutation at all. */
const expectNoKeyKept = () => {
  const elsewhere = [
    clientText(),
    graphText((console.error as unknown as { mock: unknown }).mock),
    graphText(mocks.error.mock),
    graphText(mocks.success.mock),
  ];
  const field = input();
  const page = [...host.querySelectorAll('*')]
    .filter((node) => node !== field)
    .map((node) =>
      [...node.childNodes]
        .filter((child) => child.nodeType === 3)
        .map((child) => child.textContent)
        .join(''),
    )
    .join('\n');
  for (const key of KEYS) {
    for (const text of elsewhere) expect(text.includes(key)).toBe(false);
    expect(page.includes(key)).toBe(false);
  }
  expect(client.getMutationCache().getAll()).toEqual([]);
};

describe('the key is never kept outside the form', () => {
  it('neither while a Check runs nor after it answers', async () => {
    await show();
    await type(KEY_A);
    await pressCheck();
    expect(sent()).toEqual([{ path: 'check', projectId: 'site-a', body: { providerId: 'openai', apiKey: KEY_A } }]);
    expectNoKeyKept();
    await answer(0, models('fixture-model-a', 'fixture-model-b'));
    expect(verified()).toBe(t('settings.smartAi.modelsVerified'));
    expectNoKeyKept();
  });

  it('nor after a refusal that echoes it: the invalid-key message only, then a corrected key and its retry', async () => {
    await show();
    await type(KEY_A);
    await pressCheck();
    await answer(0, (entry) => echoed(400, 'integration:credentials_invalid', entry));
    await vi.waitFor(() => expect(errors()).toEqual([t('settings.smartAi.invalidKey')]));
    expect(verified()).toBeNull();
    expectNoKeyKept();
    // A refused key has its own message, so nothing is logged for it (as before).
    expect(logged()).toEqual([]);
    await type(KEY_B);
    await pressCheck();
    await answer(1, models('fixture-model-b'));
    expect(sent().map(({ body }) => body.apiKey)).toEqual([KEY_A, KEY_B]);
    expect(verified()).toBe(t('settings.smartAi.modelsVerified'));
    expectNoKeyKept();
  });

  it('nor while a Save runs, after it succeeds, or after a refusal that echoes it', async () => {
    await show();
    await type(KEY_A);
    await consent();
    await pressSave();
    expect(sent()).toEqual([
      {
        path: 'save',
        projectId: 'site-a',
        body: { providerId: 'openai', answerModel: 'fixture-model-a', expectedRevision: 2, apiKey: KEY_A, replaceCredential: true },
      },
    ]);
    expectNoKeyKept();
    await answer(0, (entry) => echoed(409, 'database:conflict', entry));
    await vi.waitFor(() => expect(errors()).toEqual([t('settings.smartAi.conflict')]));
    // What reached the console is the plain failure: no message, body, code, details or reason from the server.
    expect(logged()).toHaveLength(1);
    expect(logged()[0]).toMatchObject({ status: 409, code: undefined, message: 'Could not save the provider.', details: undefined });
    expect(input()?.value).toBe(KEY_A);
    expectNoKeyKept();
    await pressSave();
    await answer(1, json(200, { data: detail(3) }));
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith(t('common.saved'));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(input()?.value).toBe('');
    expectNoKeyKept();
  });

  it('nor after a retired Check settles (programmatic edit), the panel closes, the session resets or the QueryClient is replaced (programmatic)', async () => {
    await show();
    await type(KEY_A);
    await pressCheck();
    await type(KEY_B);
    await answer(0, (entry) => echoed(400, 'integration:credentials_invalid', entry));
    expectNoKeyKept();
    await pressCheck();
    await hide();
    await answer(1, models('fixture-model-b'));
    expectNoKeyKept();
    await show();
    await type(KEY_A);
    await pressCheck();
    await act(async () => resetDashboardSession(client));
    await answer(2, models('fixture-model-a'));
    expectNoKeyKept();
    // Programmatic: the provider gets a new QueryClient while a Check runs.
    const previous = client;
    await show();
    await type(KEY_B);
    await pressCheck();
    client = createQueryClient();
    await show();
    await answer(3, (entry) => echoed(400, 'integration:credentials_invalid', entry));
    expectNoKeyKept();
    const current = client;
    client = previous;
    expectNoKeyKept();
    client = current;
  });

  it('nor offline: sent at once, never paused for a replay on reconnect, and the default dehydration is clear', async () => {
    await show();
    await type(KEY_A);
    onlineManager.setOnline(false);
    await pressCheck();
    expect(sent()).toHaveLength(1);
    expectNoKeyKept();
    const entry = held[0];
    if (!entry) throw new Error('no request');
    await act(async () => entry.reject(new TypeError(`Failed to fetch with ${KEY_A}`)));
    await settle();
    await vi.waitFor(() => expect(errors()).toEqual([t('error.network')]));
    expect(checkButton()?.disabled).toBe(false);
    expectNoKeyKept();
    onlineManager.setOnline(true);
    await settle();
    expect(sent()).toHaveLength(1);
    expectNoKeyKept();
  });
});

/* ---------------------------------------------------------------- a Check's answer belongs to its key, site and provider */

describe("a Check's answer belongs to the key, site and provider it was sent for", () => {
  it('programmatic: Check A, edit to B, late A: no models and no error for B, and B can be checked at once', async () => {
    await show();
    await type(KEY_A);
    await pressCheck();
    await type(KEY_B);
    expect(checkButton()?.disabled).toBe(false);
    await answer(0, models('fixture-model-a'));
    expect(verified()).toBeNull();
    await pressCheck();
    await answer(1, (entry) => echoed(400, 'integration:credentials_invalid', entry));
    await vi.waitFor(() => expect(errors()).toEqual([t('settings.smartAi.invalidKey')]));
    expect(sent().map(({ body }) => body.apiKey)).toEqual([KEY_A, KEY_B]);
  });

  it('programmatic: Check A, edit to B and back to A, late A: still retired; a refusal then shows nothing', async () => {
    await show();
    await type(KEY_A);
    await pressCheck();
    await type(KEY_B);
    await type(KEY_A);
    await answer(0, models('fixture-model-a'));
    expect(verified()).toBeNull();
    await pressCheck();
    await type(KEY_B);
    await type(KEY_A);
    await answer(1, (entry) => echoed(400, 'integration:credentials_invalid', entry));
    expect(errors()).toEqual([]);
    expect(verified()).toBeNull();
  });

  it('the panel closed and reopened while a Check runs: its refusal shows nothing, and the new panel is idle', async () => {
    await show();
    await type(KEY_A);
    await pressCheck();
    await hide();
    await show();
    expect(checkButton()?.disabled).toBe(false);
    await answer(0, (entry) => echoed(400, 'integration:credentials_invalid', entry));
    expect(errors()).toEqual([]);
    expect(verified()).toBeNull();
  });

  it('site A → B → A while a Check runs: the request stays site A, and its answer sets nothing', async () => {
    await show('site-a');
    await type(KEY_A);
    await pressCheck();
    await show('site-b');
    await show('site-a');
    expect(input()?.value).toBe('');
    await answer(0, models('fixture-model-a'));
    expect(verified()).toBeNull();
    expect(sent().map(({ projectId }) => projectId)).toEqual(['site-a']);
  });

  it('provider A → B → A while a Check runs: its refusal shows nothing', async () => {
    await show('site-a', 'openai');
    await type(KEY_A);
    await pressCheck();
    await show('site-a', 'openrouter');
    await show('site-a', 'openai');
    await answer(0, (entry) => echoed(400, 'integration:credentials_invalid', entry));
    expect(errors()).toEqual([]);
    expect(verified()).toBeNull();
  });

  it('a language change keeps the Check: its answer shows, in the new language', async () => {
    await show();
    await type(KEY_A);
    await pressCheck();
    mocks.locale = 'ar';
    await show();
    await answer(0, models('fixture-model-a'));
    expect(verified()).toBe(translateFn('settings.smartAi.modelsVerified', undefined, 'ar'));
  });

  it('a language change while a Check runs words its refusal in the new language', async () => {
    await show();
    await type(KEY_A);
    await pressCheck();
    mocks.locale = 'ar';
    await show();
    await answer(0, (entry) => echoed(400, 'integration:credentials_invalid', entry));
    await vi.waitFor(() => expect(errors()).toEqual([translateFn('settings.smartAi.invalidKey', undefined, 'ar')]));
  });

  it('Check pressed three times in one task sends one request', async () => {
    await show();
    await type(KEY_A);
    await pressCheck(3);
    expect(sent()).toHaveLength(1);
    expect(checkButton()?.disabled).toBe(true);
  });

  it('Save pressed three times in one task sends one request', async () => {
    await show();
    await pressSave(3);
    expect(sent()).toEqual([
      { path: 'save', projectId: 'site-a', body: { providerId: 'openai', answerModel: 'fixture-model-a', expectedRevision: 2 } },
    ]);
  });
});

/* ---------------------------------------------------------------- the saved key and Save, as before */

describe('the saved key and Save keep their behaviour', () => {
  it('a Check of the saved key sends no key, stays busy until the status is read again, then shows the models', async () => {
    await show();
    let release: () => void = () => undefined;
    mocks.detailGet.mockImplementation(
      () =>
        new Promise<Response>((done) => {
          release = () => done(json(200, { data: detail() }));
        }),
    );
    await pressCheck();
    expect(sent()).toEqual([{ path: 'check', projectId: 'site-a', body: { providerId: 'openai' } }]);
    await answer(0, models('fixture-model-a'));
    expect(readsOf()).toContain(JSON.stringify(queryKeys.workspaceAi.detail('site-a')));
    expect(checkButton()?.disabled).toBe(true);
    await act(async () => release());
    await settle();
    expect(verified()).toBe(t('settings.smartAi.modelsVerified'));
  });

  it('a failed Check of the saved key reads the status again too, even with the panel closed', async () => {
    await show();
    await pressCheck();
    await hide();
    await answer(0, json(422, { error: { code: 'integration:credentials_invalid', message: 'refused' } }));
    expect(readsOf()).toContain(JSON.stringify(queryKeys.workspaceAi.detail('site-a')));
  });

  it('a Check of a typed key leaves the status alone', async () => {
    await show();
    await type(KEY_A);
    await pressCheck();
    await answer(0, models());
    expect(readsOf()).toEqual([]);
    expect(verified()).toBe(t('settings.smartAi.noModels'));
  });

  it('a Save replaces the status with its answer, reads the drafting capability again, then says saved and closes', async () => {
    await show();
    await type(KEY_A);
    await consent();
    await pressSave();
    await answer(0, json(200, { data: detail(3) }));
    expect(client.getQueryData(queryKeys.workspaceAi.detail('site-a'))).toEqual(detail(3));
    expect(readsOf()).toEqual([JSON.stringify(queryKeys.workspaceAi.draftCapability('site-a'))]);
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith(t('common.saved'));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('a rate-limited Check says so, keeping only a numeric Retry-After', async () => {
    await show();
    await type(KEY_A);
    await pressCheck();
    await answer(0, (entry) => echoed(429, 'integration:rate_limited', entry, { 'retry-after': '30' }));
    await vi.waitFor(() => expect(errors()).toEqual([t('error.rateLimited')]));
    expect(logged()).toHaveLength(1);
    expect(logged()[0]).toMatchObject({
      status: 429,
      code: undefined,
      retryAfter: '30',
      message: 'Could not verify the provider.',
      details: undefined,
    });
    expectNoKeyKept();
  });

  it('a failed Save says what went wrong in plain words', async () => {
    await show();
    await pressSave();
    await answer(0, json(500, { error: { code: 'http:internal', message: 'stack trace here' } }));
    await vi.waitFor(() => expect(errors()).toEqual([t('settings.smartAi.error')]));
    expect(onSaved).not.toHaveBeenCalled();
  });
});

/* ---------------------------------------------------------------- session boundaries */

describe('a request belongs to the session it started in', () => {
  it('a session that ended before the press sends nothing', async () => {
    await show();
    await type(KEY_A);
    await act(async () => resetDashboardSession(client));
    await pressCheck();
    await pressSave();
    expect(sent()).toEqual([]);
    expect(errors()).toEqual([]);
  });

  it('an answer arriving after the session ended sets nothing and reports nothing', async () => {
    await show();
    await type(KEY_A);
    await pressCheck();
    await act(async () => resetDashboardSession(client));
    await answer(0, (entry) => echoed(400, 'integration:credentials_invalid', entry));
    expect(errors()).toEqual([]);
    expect(verified()).toBeNull();
  });

  it('programmatic: a session ending once the answer arrived, before its body is read, reads nothing', async () => {
    await show();
    await type(KEY_A);
    await consent();
    await pressSave();
    const response = json(200, { data: detail(3) });
    const read = vi.spyOn(response, 'json');
    const entry = held[0];
    if (!entry) throw new Error('no request');
    await act(async () => {
      entry.resolve(response);
      resetDashboardSession(client);
    });
    await settle();
    expect(read).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(readsOf()).toEqual([]);
  });

  it('programmatic: a session ending while the body is read writes nothing', async () => {
    await show();
    await type(KEY_A);
    await consent();
    await pressSave();
    let body: (value: unknown) => void = () => undefined;
    const response = json(200, {});
    vi.spyOn(response, 'json').mockReturnValue(
      new Promise((done) => {
        body = done;
      }),
    );
    await answer(0, response);
    await act(async () => resetDashboardSession(client));
    await act(async () => body({ data: detail(3) }));
    await settle();
    // The Save's answer (revision 3) is never written; the panel may read its status afresh for the next session.
    expect(client.getQueryData(queryKeys.workspaceAi.detail('site-a'))).not.toEqual(detail(3));
    expect(readsOf()).toEqual([]);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  describe('programmatic: the drafting capability on screen, so the readback after a Save is held', () => {
    let release: () => void;
    function Capability() {
      useQuery(aiDraftCapabilityQueryOptions('site-a'));
      return null;
    }
    const saveAndHoldReadback = async () => {
      mocks.capabilityGet.mockImplementation(
        () =>
          new Promise<Response>((done) => {
            release = () => done(json(200, { data: { available: true } }));
          }),
      );
      await show('site-a', 'openai', <Capability />);
      await act(async () => release());
      await settle();
      await type(KEY_A);
      await consent();
      await pressSave();
      await answer(0, json(200, { data: detail(3) }));
      expect(saveButton()?.disabled).toBe(true);
      expect(mocks.success).not.toHaveBeenCalled();
    };

    it("publishes the Save's status at once, then says saved and closes once the capability is read again", async () => {
      await saveAndHoldReadback();
      expect(client.getQueryData(queryKeys.workspaceAi.detail('site-a'))).toEqual(detail(3));
      await act(async () => release());
      await settle();
      expect(mocks.success).toHaveBeenCalledTimes(1);
      expect(onSaved).toHaveBeenCalledTimes(1);
      expect(client.getQueryData(queryKeys.workspaceAi.detail('site-a'))).toEqual(detail(3));
    });

    it('a newer status read during that wait is kept: the Save never writes its older answer over it', async () => {
      await saveAndHoldReadback();
      // Revision 4 lands (another session saved) while the capability read is held.
      revision = 4;
      await act(async () => client.refetchQueries({ queryKey: queryKeys.workspaceAi.detail('site-a'), exact: true }));
      await settle();
      expect(client.getQueryData(queryKeys.workspaceAi.detail('site-a'))).toEqual(detail(4));
      await act(async () => release());
      await settle();
      expect(client.getQueryData(queryKeys.workspaceAi.detail('site-a'))).toEqual(detail(4));
      expect(mocks.success).toHaveBeenCalledTimes(1);
    });

    it('a session ending during that read neither says saved nor closes', async () => {
      await saveAndHoldReadback();
      await act(async () => resetDashboardSession(client));
      await act(async () => release());
      await settle();
      expect(mocks.success).not.toHaveBeenCalled();
      expect(onSaved).not.toHaveBeenCalled();
    });
  });

  it('a session ending while a Save is held reports nothing when it then fails', async () => {
    await show();
    await type(KEY_A);
    await consent();
    await pressSave();
    await act(async () => resetDashboardSession(client));
    const entry = held[0];
    if (!entry) throw new Error('no request');
    await act(async () => entry.reject(new TypeError('Failed to fetch')));
    await settle();
    expect(errors()).toEqual([]);
    expect(logged()).toEqual([]);
    // And a refusal answered after the session ended, likewise (AppGuard remounts the dashboard for the next session).
    await hide();
    await show('site-a', 'openai');
    await type(KEY_A);
    await consent();
    await pressSave();
    await act(async () => resetDashboardSession(client));
    await answer(1, (sent) => echoed(409, 'database:conflict', sent));
    expect(errors()).toEqual([]);
    expect(logged()).toEqual([]);
  });

  it("programmatic: a session ending while a refusal's body is read reports nothing", async () => {
    await show();
    await type(KEY_A);
    await consent();
    await pressSave();
    let body: (value: unknown) => void = () => undefined;
    const response = json(409, {});
    vi.spyOn(response, 'json').mockReturnValue(
      new Promise((done) => {
        body = done;
      }),
    );
    await answer(0, response);
    await act(async () => resetDashboardSession(client));
    await act(async () => body({ error: { code: 'database:conflict', message: `Changed ${KEY_A}` } }));
    await settle();
    expect(errors()).toEqual([]);
    expect(logged()).toEqual([]);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('programmatic: an edit while Save runs is not cleared by its success', async () => {
    await show();
    await type(KEY_A);
    await consent();
    await pressSave();
    await type(KEY_B);
    // The same revision, so the form isn't replaced by a new one: only this save's own clearing is tested.
    await answer(0, json(200, { data: detail(2) }));
    expect(input()?.value).toBe(KEY_B);
    expect(mocks.success).toHaveBeenCalledTimes(1);
  });
});
