/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => {
  const mutation = () => ({ isPending: false, variables: undefined as unknown, mutate: vi.fn() });
  return { useApiKeys: vi.fn(), create: mutation(), rotate: mutation(), revoke: mutation(), testConnection: vi.fn(), confirm: vi.fn() };
});

vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => hooks.confirm }));
const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

vi.mock('@nibleaf/i18n/react', () => ({
  useLocale: () => ({ locale: 'en', t: (key: string, params?: Record<string, string>) => (params?.tool ? `${key}:${params.tool}` : key) }),
  useT: () => (key: string) => key,
}));
vi.mock('@/hooks/api', () => ({
  useApiKeys: hooks.useApiKeys,
  useCreateApiKey: () => hooks.create,
  useRevokeApiKey: () => hooks.revoke,
  useRotateApiKey: () => hooks.rotate,
}));

vi.mock('./assistant-setup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./assistant-setup')>()),
  testAssistantConnection: hooks.testConnection,
}));

vi.mock('./connected-apps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./connected-apps')>()),
  ConnectedApps: () => null,
}));

import { ApiKeysTab } from './api-keys-tab';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const MEMBER = 'member';
const ADMIN = 'admin';

const roots: Array<ReturnType<typeof createRoot>> = [];

beforeEach(() => {
  hooks.confirm.mockReset().mockResolvedValue(false);
  toasts.error.mockClear();
  toasts.success.mockClear();
  for (const mutation of [hooks.create, hooks.rotate, hooks.revoke]) {
    mutation.isPending = false;
    mutation.variables = undefined;
    mutation.mutate.mockReset();
  }
});

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount());
  }
  document.body.replaceChildren();
});

async function renderTab(role = 'member') {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<ApiKeysTab projectId="project-1" role={role} />));
  return container;
}
const response = (enabled = true, data: object[] = []) => ({
  data: { data, meta: { mcpEnabled: enabled, mcpEndpoint: 'https://docs.example/api/mcp' } },
  isPending: false,
});
const apiKey = (overrides: object = {}) => ({
  id: 'key-1',
  name: 'Support',
  preset: 'support_writer',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  lastUsedAt: new Date().toISOString(),
  scopes: ['mcp:connect', 'pages:write'],
  state: 'active',
  lastFour: 'abcd',
  revokedAt: null,
  lastActivity: null,
  ...overrides,
});
const button = (container: ParentNode, label: string) =>
  Array.from(container.querySelectorAll('button')).find((element) => element.textContent?.includes(label));

describe('API-key settings list state', () => {
  it('renders a localized, retryable query failure instead of the empty state', async () => {
    const refetch = vi.fn();
    hooks.useApiKeys.mockReturnValue({
      data: undefined,
      error: new Error('sensitive backend detail'),
      isError: true,
      isFetching: false,
      isPending: false,
      refetch,
    });
    const container = await renderTab();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('settings.apiKeys.loadError');
    expect(container.textContent).not.toContain('settings.apiKeys.empty');
    expect(container.textContent).not.toContain('sensitive backend detail');
    await act(async () => button(alert as ParentNode, 'error.tryAgain')?.click());
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('keeps cached rows and offers a retry when a background refresh fails', async () => {
    const refetch = vi.fn();
    hooks.useApiKeys.mockReturnValue({ ...response(true, [apiKey()]), isError: true, isFetching: false, refetch });
    const container = await renderTab();

    expect(container.querySelector('li')?.textContent).toContain('Support');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    const notice = Array.from(container.querySelectorAll('[role="status"]')).find((element) =>
      element.textContent?.includes('settings.credentials.refreshFailed'),
    );
    await act(async () => button(notice as ParentNode, 'error.tryAgain')?.click());
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('shows row-shaped skeletons with one status while the first load is pending', async () => {
    hooks.useApiKeys.mockReturnValue({ data: undefined, isError: false, isPending: true });
    const container = await renderTab();

    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(busy?.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(busy?.querySelector('[role="status"]')?.textContent).toBe('settings.apiKeys.loadingKeys');
    expect(busy?.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain('settings.apiKeys.empty');
    expect(container.textContent).not.toContain('common.loading');
  });
});

describe('API-key rows in plain words', () => {
  it('shows the preset sentence and keeps scopes, last four and raw activity in collapsed technical details', async () => {
    hooks.useApiKeys.mockReturnValue(
      response(true, [apiKey({ lastActivity: { operation: 'update_page', outcome: 'succeeded', errorCode: null, at: new Date().toISOString() } })]),
    );
    const container = await renderTab();
    const row = container.querySelector('li');

    expect(row?.textContent).toContain('settings.apiKeys.support_writerDescription');
    expect(row?.textContent).toContain('settings.mcpActivity.updatedPage');
    const details = row?.querySelector('details');
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe('settings.apiKeys.technicalDetails');
    // Scopes, the last four and the raw tool name only live inside the disclosure.
    for (const raw of ['pages:write', 'abcd', 'update_page']) {
      const holder = Array.from(row?.querySelectorAll('code, [data-slot="badge"], span') ?? []).find((element) => element.textContent === raw);
      expect(holder?.closest('details')).toBe(details);
    }

    await act(async () => details?.querySelector('summary')?.click());
    expect(details?.open).toBe(true);
    expect(details?.textContent).toContain('pages:write');
  });

  it('describes a blocked attempt as a plain amber sentence, not a red failure', async () => {
    hooks.useApiKeys.mockReturnValue(
      response(true, [
        apiKey({
          lastActivity: { operation: 'publish_changes', outcome: 'failed', errorCode: 'mcp:scope_required', at: new Date().toISOString() },
        }),
      ]),
    );
    const container = await renderTab();
    const line = container.querySelector('[data-tone]');

    expect(line?.getAttribute('data-tone')).toBe('attention');
    expect(line?.textContent).toContain('settings.mcpActivity.keyCantPublish');
    expect(line?.querySelector('.text-warning')).not.toBeNull();
    expect(line?.querySelector('.text-destructive')).toBeNull();
    expect(line?.textContent).not.toContain('publish_changes');
    expect(container.querySelector('li details')?.textContent).toContain('mcp:scope_required');
  });

  it('describes a revision conflict in plain words', async () => {
    hooks.useApiKeys.mockReturnValue(
      response(true, [
        apiKey({ lastActivity: { operation: 'update_page', outcome: 'failed', errorCode: 'mcp:revision_conflict', at: new Date().toISOString() } }),
      ]),
    );
    const container = await renderTab();
    expect(container.querySelector('[data-tone]')?.textContent).toContain('settings.mcpActivity.revisionConflict');
  });

  it('uses a plain sentence for custom keys', async () => {
    hooks.useApiKeys.mockReturnValue(response(true, [apiKey({ preset: 'custom' })]));
    const container = await renderTab();
    expect(container.querySelector('li')?.textContent).toContain('settings.apiKeys.customDescription');
  });
});

describe('API-key actions', () => {
  it('offers member presets and gates full admin', async () => {
    hooks.useApiKeys.mockReturnValue(response());
    const container = await renderTab();
    const radios = container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect(radios[1]?.checked).toBe(true);
    expect(radios[2]?.disabled).toBe(true);
    expect((await renderTab('admin')).querySelectorAll<HTMLInputElement>('input[type="radio"]')[2]?.disabled).toBe(false);
  });

  it('explains disabled instances and disables creation', async () => {
    hooks.useApiKeys.mockReturnValue(response(false));
    const container = await renderTab();
    expect(container.textContent).toContain('settings.apiKeys.disabled');
    expect(button(container, 'settings.apiKeys.create')?.disabled).toBe(true);
  });

  it('shows setup once, includes endpoint and hides the secret on dismissal', async () => {
    hooks.useApiKeys.mockReturnValue(response());
    hooks.create.mutate.mockImplementation((_body, options) => options.onSuccess({ id: 'new-key', secret: 'test-once-secret' }));
    const container = await renderTab();
    await act(async () => button(container, 'settings.apiKeys.create')?.click());
    expect(container.textContent).toContain('test-once-secret');
    expect(container.querySelector('pre')?.textContent).toContain('https://docs.example/api/mcp');
    await act(async () => button(container, 'settings.apiKeys.dismissSecret')?.click());
    expect(container.textContent).not.toContain('test-once-secret');
  });

  it.each(['missing', 'rejected', 'copied'])('reports clipboard outcome: %s', async (outcome) => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn();
    if (outcome === 'rejected') writeText.mockRejectedValue(new Error('Clipboard denied'));
    else writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: outcome === 'missing' ? undefined : { writeText } });
    try {
      hooks.useApiKeys.mockReturnValue(response());
      hooks.create.mutate.mockImplementation((_body, options) => options.onSuccess({ id: 'new-key', secret: 'test-once-secret' }));
      const container = await renderTab();
      await act(async () => button(container, 'settings.apiKeys.create')?.click());
      expect([...container.querySelectorAll('code')].find((code) => code.textContent === 'test-once-secret')?.classList.contains('select-all')).toBe(
        true,
      );
      toasts.error.mockClear();
      toasts.success.mockClear();
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="settings.apiKeys.copy"]')?.click());
      if (outcome === 'copied') {
        expect(writeText).toHaveBeenCalledWith('test-once-secret');
        expect(toasts.success).toHaveBeenCalledWith('settings.apiKeys.copied');
        expect(toasts.error).not.toHaveBeenCalled();
      } else {
        expect(toasts.error).toHaveBeenCalledWith('settings.apiKeys.copyFailed');
        expect(toasts.error).not.toHaveBeenCalledWith('settings.apiKeys.createError');
      }
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('disables Create when the role no longer allows the selected preset', async () => {
    hooks.useApiKeys.mockReturnValue(response());
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<ApiKeysTab projectId="project-1" role={ADMIN} />));
    await act(async () => container.querySelectorAll<HTMLInputElement>('input[type="radio"]')[2]?.click());
    expect(button(container, 'settings.apiKeys.create')?.disabled).toBe(false);
    // The person is downgraded while the form is open.
    await act(async () => root.render(<ApiKeysTab projectId="project-1" role={MEMBER} />));
    expect(button(container, 'settings.apiKeys.create')?.disabled).toBe(true);
  });

  it('drops a connection result that arrives after the key was replaced', async () => {
    hooks.useApiKeys.mockReturnValue(response());
    let created = 0;
    hooks.create.mutate.mockImplementation((_body, options) => options.onSuccess({ id: `key-${++created}`, secret: `secret-${created}` }));
    let finishFirstTest: (value: { tools: number; usedUntil: number }) => void = () => undefined;
    hooks.testConnection.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirstTest = resolve;
        }),
    );
    const container = await renderTab();
    await act(async () => button(container, 'settings.apiKeys.create')?.click());
    await act(async () => button(container, 'settings.apiKeys.test')?.click());
    expect(hooks.testConnection).toHaveBeenCalledWith('secret-1');
    // A second key replaces the first while its test is still running.
    await act(async () => button(container, 'settings.apiKeys.create')?.click());
    expect(container.textContent).toContain('secret-2');
    await act(async () => finishFirstTest({ tools: 26, usedUntil: Date.now() }));
    expect(container.textContent).not.toContain('settings.apiKeys.testSuccess');
    expect(button(container, 'settings.apiKeys.test')?.getAttribute('aria-busy')).not.toBe('true');
  });

  it('stops watching for the AI app after ten minutes and starts again on Test connection', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    try {
      hooks.useApiKeys.mockReturnValue(response());
      hooks.create.mutate.mockImplementation((_body, options) => options.onSuccess({ id: 'new-key', secret: 'test-once-secret' }));
      hooks.testConnection.mockResolvedValue({ tools: 26, usedUntil: Date.now() });
      const container = await renderTab();
      await act(async () => button(container, 'settings.apiKeys.create')?.click());
      expect(container.textContent).toContain('settings.apiKeys.waiting');
      await act(async () => vi.advanceTimersByTime(10 * 60_000));
      expect(container.textContent).toContain('settings.apiKeys.waitingStopped');
      // The hook stops polling once the watch has ended.
      const waiting = hooks.useApiKeys.mock.calls.at(-1)?.[1] as { until: number };
      expect(waiting.until).toBeLessThanOrEqual(Date.now());
      await act(async () => button(container, 'settings.apiKeys.test')?.click());
      expect(container.textContent).not.toContain('settings.apiKeys.waitingStopped');
      expect(container.textContent).toContain('settings.apiKeys.waiting');
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks Create key as loading while the key is being created', async () => {
    hooks.useApiKeys.mockReturnValue(response());
    hooks.create.isPending = true;
    const container = await renderTab();
    const create = button(container, 'settings.apiKeys.create');
    expect(create?.getAttribute('aria-busy')).toBe('true');
    expect(create?.hasAttribute('data-loading')).toBe(true);
    expect(create?.disabled).toBe(true);
  });

  it('locks the key form while the key is being created, so the reset on success cannot wipe newer edits', async () => {
    hooks.useApiKeys.mockReturnValue(response());
    hooks.create.isPending = true;
    const container = await renderTab();
    expect(container.querySelector<HTMLInputElement>('#api-key-name')?.disabled).toBe(true);
    const presets = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(presets.length).toBeGreaterThan(0);
    expect(presets.every((radio) => radio.disabled)).toBe(true);
    expect([...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((box) => box.disabled)).toBe(true);
  });

  it('marks only the rotating key as loading', async () => {
    hooks.useApiKeys.mockReturnValue(response(true, [apiKey({ ownedByViewer: true }), apiKey({ id: 'key-2', ownedByViewer: true })]));
    hooks.rotate.isPending = true;
    hooks.rotate.variables = { id: 'key-2' };
    const container = await renderTab();
    const [first, second] = Array.from(container.querySelectorAll('li')).map((row) => button(row, 'settings.apiKeys.rotate'));
    expect(second?.getAttribute('aria-busy')).toBe('true');
    expect(first?.hasAttribute('aria-busy')).toBe(false);
    expect(first?.disabled).toBe(true);
  });

  it('requires confirmation before revoke and shows the confirm button loading', async () => {
    hooks.useApiKeys.mockReturnValue(response(true, [apiKey({ scopes: ['mcp:connect'] })]));
    const container = await renderTab();
    await act(async () => button(container, 'settings.apiKeys.revoke')?.click());
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(hooks.revoke.mutate).not.toHaveBeenCalled();

    await act(async () => button(dialog as ParentNode, 'settings.apiKeys.revoke')?.click());
    expect(hooks.revoke.mutate).toHaveBeenCalledWith('key-1', expect.any(Object));
    expect(hooks.revoke.mutate.mock.calls[0]?.[1]).not.toHaveProperty('onError');

    hooks.revoke.isPending = true;
    await act(async () => roots[0]?.render(<ApiKeysTab projectId="project-1" role={MEMBER} />));
    const confirm = button(document.querySelector('[role="alertdialog"]') as ParentNode, 'settings.apiKeys.revoke');
    expect(confirm?.getAttribute('aria-busy')).toBe('true');
  });
});

describe('API-key creation form', () => {
  const nameInput = (container: ParentNode) => container.querySelector<HTMLInputElement>('#api-key-name');
  const typeName = async (container: ParentNode, value: string) => {
    const input = nameInput(container);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  it('submits with Enter from the name field', async () => {
    hooks.useApiKeys.mockReturnValue(response());
    const container = await renderTab();
    await typeName(container, 'Docs bot');
    const form = nameInput(container)?.form;
    // Enter in a text field clicks the form's first submit button: Create.
    const defaultButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(defaultButton?.textContent).toContain('settings.apiKeys.create');
    expect(defaultButton?.disabled).toBe(false);
    await act(async () => form?.requestSubmit());
    expect(hooks.create.mutate).toHaveBeenCalledExactlyOnceWith(
      { name: 'Docs bot', preset: 'support_writer', expiresInDays: 90 },
      expect.any(Object),
    );
  });

  it('explains an empty name inline instead of creating a key', async () => {
    hooks.useApiKeys.mockReturnValue(response());
    const container = await renderTab();
    await typeName(container, '   ');
    await act(async () => button(container, 'settings.apiKeys.create')?.click());

    expect(hooks.create.mutate).not.toHaveBeenCalled();
    expect(container.querySelector('#api-key-name-error')?.textContent).toBe('validation.required');
    expect(nameInput(container)?.getAttribute('aria-invalid')).toBe('true');
    expect(nameInput(container)?.getAttribute('aria-describedby')).toBe('api-key-name-error');
  });

  it('keeps the draft when creating fails and resets it after a success', async () => {
    hooks.useApiKeys.mockReturnValue(response());
    hooks.create.mutate.mockImplementationOnce((_body, options) => options.onError?.(new Error('nope')));
    const container = await renderTab();
    await typeName(container, 'Release notes bot');
    await act(async () => button(container, 'settings.apiKeys.create')?.click());
    expect(hooks.create.mutate).toHaveBeenCalledOnce();
    expect(nameInput(container)?.value).toBe('Release notes bot');
    expect(container.textContent).not.toContain('settings.apiKeys.created.title');

    hooks.create.mutate.mockImplementationOnce((_body, options) => options.onSuccess({ id: 'new-key', secret: 'test-once-secret' }));
    await act(async () => button(container, 'settings.apiKeys.create')?.click());
    expect(container.textContent).toContain('test-once-secret');
    expect(nameInput(container)?.value).toBe('settings.apiKeys.defaultName');
  });
});

describe('API-key rotation confirmation', () => {
  it('does not rotate before confirmation or after cancellation', async () => {
    hooks.useApiKeys.mockReturnValue(response(true, [apiKey({ ownedByViewer: true })]));
    let decide: (value: boolean) => void = () => undefined;
    hooks.confirm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          decide = resolve;
        }),
    );
    const container = await renderTab();
    await act(async () => button(container, 'settings.apiKeys.rotate')?.click());
    expect(hooks.rotate.mutate).not.toHaveBeenCalled();
    expect(hooks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'settings.apiKeys.rotateConfirm.description', destructive: true }),
    );
    await act(async () => decide(false));
    expect(hooks.rotate.mutate).not.toHaveBeenCalled();
  });

  it('rotates the chosen key only after approval', async () => {
    hooks.useApiKeys.mockReturnValue(response(true, [apiKey({ ownedByViewer: true })]));
    hooks.confirm.mockResolvedValue(true);
    const container = await renderTab();
    await act(async () => button(container, 'settings.apiKeys.rotate')?.click());
    expect(hooks.rotate.mutate).toHaveBeenCalledOnce();
    expect(hooks.rotate.mutate).toHaveBeenCalledWith(expect.objectContaining({ id: 'key-1' }), expect.any(Object));
  });
});

it.each([
  { expiresAt: new Date(0).toISOString(), message: 'settings.apiKeys.rotateConfirm.expiredDescription' },
  { expiresAt: null, message: 'settings.apiKeys.rotateConfirm.legacyDescription' },
  { expiresAt: new Date(Date.now() + 86_400_000).toISOString(), message: 'settings.apiKeys.rotateConfirm.description' },
])('explains the replacement lifetime for expiry $expiresAt', async ({ expiresAt, message }) => {
  hooks.useApiKeys.mockReturnValue(response(true, [apiKey({ ownedByViewer: true, expiresAt })]));
  hooks.confirm.mockResolvedValue(true);
  const host = await renderTab();
  await act(async () => button(host, 'settings.apiKeys.rotate')?.click());
  expect(hooks.confirm).toHaveBeenCalledWith(expect.objectContaining({ description: message }));
  expect(hooks.rotate.mutate).toHaveBeenCalledWith(
    expect.objectContaining({ body: expect.objectContaining({ expiresInDays: 90 }) }),
    expect.any(Object),
  );
});
