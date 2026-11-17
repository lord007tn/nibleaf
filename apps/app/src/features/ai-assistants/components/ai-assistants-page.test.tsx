/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => {
  const mutation = () => ({ isPending: false, variables: undefined as unknown, mutate: vi.fn() });
  return {
    useApiKeys: vi.fn(),
    useApps: vi.fn(),
    create: mutation(),
    rotate: mutation(),
    revoke: mutation(),
    disconnect: mutation(),
    testConnection: vi.fn(),
    confirm: vi.fn(),
  };
});

vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => hooks.confirm }));
const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));
vi.mock('@nibleaf/i18n/react', () => ({
  useLocale: () => ({
    locale: 'en',
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}(${Object.values(params).join('|')})` : key),
  }),
  useT: () => (key: string) => key,
}));
vi.mock('@/hooks/api', () => ({
  useApiKeys: hooks.useApiKeys,
  useCreateApiKey: () => hooks.create,
  useRevokeApiKey: () => hooks.revoke,
  useRotateApiKey: () => hooks.rotate,
  useRevokeConnectedApp: () => hooks.disconnect,
}));
vi.mock('../api/hooks', () => ({ useConnectedAppsWatch: hooks.useApps }));
vi.mock('../api/test-connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/test-connection')>()),
  testAssistantConnection: hooks.testConnection,
}));

import { AiAssistantsPage } from './ai-assistants-page';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });

const ENDPOINT = 'https://docs.example/api/mcp';
const roots: Array<ReturnType<typeof createRoot>> = [];
const query = (data: unknown, overrides: object = {}) => ({
  data,
  isPending: data === undefined,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
  ...overrides,
});
const keys = (data: object[] = [], meta: object = {}) =>
  query({ data, meta: { mcpEnabled: true, mcpEndpoint: ENDPOINT, mcpOAuthEnabled: true, ...meta } });
const person = (id: string, name: string) => ({ id, name, email: `${id}@example.com` });
const apiKey = (overrides: object = {}) => ({
  id: 'key-1',
  name: 'Laptop',
  preset: 'support_writer',
  createdAt: new Date(Date.now() - 86_400_000).toISOString(),
  expiresAt: new Date(Date.now() + 60 * 86_400_000).toISOString(),
  lastUsedAt: null,
  scopes: ['mcp:connect', 'pages:write'],
  state: 'active',
  lastFour: 'abcd',
  revokedAt: null,
  rotatedFromId: null,
  legacy: false,
  lastActivity: null,
  createdBy: person('u1', 'Ada'),
  ownedByViewer: true,
  ...overrides,
});
const app = (overrides: object = {}) => ({
  id: 'grant-1',
  name: 'ChatGPT',
  uri: null,
  preset: 'read_only',
  scopes: ['mcp:connect', 'pages:read'],
  createdAt: new Date().toISOString(),
  lastUsedAt: null,
  connectedBy: person('u2', 'Sara'),
  ownedByViewer: true,
  lastActivity: null,
  ...overrides,
});

beforeEach(() => {
  hooks.confirm.mockReset().mockResolvedValue(false);
  hooks.testConnection.mockReset();
  hooks.useApiKeys.mockReset().mockReturnValue(keys());
  hooks.useApps.mockReset().mockReturnValue(query([]));
  toasts.error.mockClear();
  toasts.success.mockClear();
  for (const mutation of [hooks.create, hooks.rotate, hooks.revoke, hooks.disconnect]) {
    mutation.isPending = false;
    mutation.variables = undefined;
    mutation.mutate.mockReset();
  }
});

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
});

async function renderPage(role = 'member') {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const render = () => root.render(<AiAssistantsPage projectId="project-1" role={role} siteName="Docs" />);
  await act(async () => render());
  return { container, rerender: () => act(async () => render()) };
}
const buttons = () => Array.from(document.body.querySelectorAll('button'));
const button = (label: string) =>
  buttons().find((element) => element.getAttribute('aria-label') === label || (element.textContent?.trim() ?? '').startsWith(label));
const click = (element: Element | undefined) =>
  act(async () => {
    if (!element) throw new Error('missing element');
    (element as HTMLElement).click();
  });
const text = () => document.body.textContent ?? '';

describe('AI assistants page states', () => {
  it('shows skeletons with one status while loading', async () => {
    hooks.useApiKeys.mockReturnValue(query(undefined));
    const { container } = await renderPage();
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(text()).not.toContain(ENDPOINT);
  });

  it('offers a retry when the first load fails', async () => {
    const refetch = vi.fn();
    hooks.useApiKeys.mockReturnValue(query(undefined, { isPending: false, isError: true, refetch }));
    await renderPage();
    expect(text()).toContain('settings.aiAssistants.connectionsLoadError');
  });

  it('when MCP is off, explains it without an operator, with no address or connect steps, and a reason on Create', async () => {
    hooks.useApiKeys.mockReturnValue(keys([], { mcpEnabled: false }));
    const { container } = await renderPage('admin');
    expect(text()).toContain('settings.aiAssistants.off.title');
    expect(text()).not.toContain(ENDPOINT);
    expect(text()).not.toContain('settings.aiAssistants.connectTitle');
    expect(text()).not.toMatch(/operator/i);
    expect(container.querySelector('a[href="https://docs.nibleaf.com/self-hosting/mcp"]')).not.toBeNull();
    const create = button('settings.aiAssistants.useKey');
    expect(create?.getAttribute('aria-disabled')).toBe('true');
    expect(text()).toContain('settings.aiAssistants.off.reason');
  });

  it('tells a role without MCP access what to ask for', async () => {
    await renderPage('viewer');
    expect(text()).toContain('settings.aiAssistants.noAccess');
    expect(text()).not.toContain('settings.aiAssistants.connectTitle');
  });
});

describe('Connect an assistant', () => {
  it('starts on ChatGPT with numbered steps, the menu path as its own LTR line and Copy on the address step', async () => {
    const { container } = await renderPage();
    expect(button('ChatGPT')?.getAttribute('aria-pressed')).toBe('true');
    const steps = container.querySelectorAll('ol > li');
    expect(steps).toHaveLength(3);
    const menu = steps[0]?.querySelector('[dir="ltr"]');
    expect(menu?.textContent).toContain('Settings');
    expect(menu?.textContent).toContain('Apps & Connectors');
    expect(steps[1]?.textContent).toContain(ENDPOINT);
    expect(steps[1]?.querySelector('button[aria-label="settings.aiAssistants.copyAddress"]')).not.toBeNull();
    expect(steps[2]?.textContent).toContain('settings.aiAssistants.step.signIn(ChatGPT|Docs)');
  });

  it('switches to the command for Claude Code', async () => {
    await renderPage();
    await click(button('Claude Code'));
    expect(text()).toContain(`claude mcp add --transport http nibleaf "${ENDPOINT}"`);
  });

  it('without sign-in, says why ChatGPT is unavailable and routes key apps to a personal key', async () => {
    hooks.useApiKeys.mockReturnValue(keys([], { mcpOAuthEnabled: false }));
    await renderPage();
    expect(button('Claude Code')?.getAttribute('aria-pressed')).toBe('true');
    expect(text()).toContain('settings.aiAssistants.step.useKey(Claude Code|Docs)');
    await click(button('ChatGPT'));
    expect(text()).toContain('settings.aiAssistants.needsHttps(ChatGPT)');
  });

  it('after a copy, waits, then says allowed for a new grant, then working once it called; earlier grants never count', async () => {
    const existing = app({ id: 'old', lastActivity: { operation: 'get_page', outcome: 'succeeded', at: new Date().toISOString() } });
    hooks.useApps.mockReturnValue(query([existing]));
    const page = await renderPage();
    await click(button('settings.aiAssistants.copyAddress'));
    expect(text()).toContain('settings.aiAssistants.watch.waiting(ChatGPT)');
    expect(hooks.useApps).toHaveBeenLastCalledWith('project-1', expect.objectContaining({ client: 'chatgpt', baseline: ['old'] }));
    hooks.useApps.mockReturnValue(query([existing, app({ id: 'new', name: 'ChatGPT' })]));
    await page.rerender();
    expect(text()).toContain('settings.aiAssistants.watch.authorized(ChatGPT)');
    hooks.useApps.mockReturnValue(
      query([
        existing,
        app({ id: 'new', name: 'ChatGPT', lastActivity: { operation: 'get_capabilities', outcome: 'succeeded', at: new Date().toISOString() } }),
      ]),
    );
    await page.rerender();
    expect(text()).toContain('settings.aiAssistants.watch.working(ChatGPT)');
  });

  it('does not call a grant working while its only call has merely started', async () => {
    const page = await renderPage();
    await click(button('settings.aiAssistants.copyAddress'));
    hooks.useApps.mockReturnValue(
      query([app({ id: 'new', lastActivity: { operation: 'create_page_draft', outcome: 'started', at: new Date().toISOString() } })]),
    );
    await page.rerender();
    expect(text()).toContain('settings.aiAssistants.watch.authorized(ChatGPT)');
    expect(text()).not.toContain('settings.aiAssistants.watch.working');
  });

  it('copied while the app list was loading: takes the baseline once it loads, so an old grant never reads as new', async () => {
    hooks.useApps.mockReturnValue(query(undefined));
    const page = await renderPage();
    await click(button('settings.aiAssistants.copyAddress'));
    expect(hooks.useApps).toHaveBeenLastCalledWith('project-1', expect.objectContaining({ baseline: null }));
    const old = app({ id: 'old', lastActivity: { operation: 'get_page', outcome: 'succeeded', at: new Date().toISOString() } });
    hooks.useApps.mockReturnValue(query([old]));
    await page.rerender();
    await page.rerender();
    expect(hooks.useApps).toHaveBeenLastCalledWith('project-1', expect.objectContaining({ baseline: ['old'] }));
    expect(text()).toContain('settings.aiAssistants.watch.waiting(ChatGPT)');
  });

  it('flags a new grant whose name is not the chosen app', async () => {
    const page = await renderPage();
    await click(button('settings.aiAssistants.copyAddress'));
    hooks.useApps.mockReturnValue(query([app({ id: 'odd', name: 'Mystery agent' })]));
    await page.rerender();
    expect(text()).toContain('settings.aiAssistants.watch.unexpected(Mystery agent|ChatGPT)');
  });

  it('re-renders by itself at the deadline: "not connected yet" appears without any other update', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      await renderPage();
      await click(button('settings.aiAssistants.copyAddress'));
      expect(text()).toContain('settings.aiAssistants.watch.waiting(ChatGPT)');
      await act(async () => {
        vi.advanceTimersByTime(10 * 60_000 + 100);
      });
      expect(text()).toContain('settings.aiAssistants.watch.timedOut(ChatGPT)');
      expect(button('settings.aiAssistants.watch.again')).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('at the deadline, says an allowed app never called and offers to watch again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const page = await renderPage();
      await click(button('settings.aiAssistants.copyAddress'));
      hooks.useApps.mockReturnValue(query([app({ id: 'new' })]));
      await page.rerender();
      expect(text()).toContain('settings.aiAssistants.watch.authorized(ChatGPT)');
      await act(async () => {
        vi.advanceTimersByTime(10 * 60_000 + 100);
      });
      expect(text()).toContain('settings.aiAssistants.watch.stalled(ChatGPT|ChatGPT)');
      await click(button('settings.aiAssistants.watch.again'));
      expect(text()).toContain('settings.aiAssistants.watch.authorized(ChatGPT)');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Try asking', () => {
  it('lists the examples, read-only ones first, each with the permission it needs and a copy button', async () => {
    await renderPage();
    const prompts = Array.from(document.body.querySelectorAll('li')).filter((item) => item.textContent?.includes('settings.aiAssistants.prompt.'));
    expect(prompts.map((item) => item.querySelector('p')?.textContent?.replace('settings.aiAssistants.prompt.', ''))).toEqual([
      'healthReport',
      'aiGaps',
      'failedSearches',
      'draftPage',
    ]);
    expect(prompts[0]?.textContent).toContain('settings.aiAssistants.needs(settings.apiKeys.read_only)');
    expect(prompts[2]?.textContent).toContain('settings.aiAssistants.needs(settings.apiKeys.support_writer)');
    expect(prompts[0]?.querySelector('button[aria-label="settings.aiAssistants.copyPrompt"]')).not.toBeNull();
  });
});

describe('Connections', () => {
  it('lists apps and keys together, shows owners to admins, and keeps inactive keys collapsed', async () => {
    hooks.useApiKeys.mockReturnValue(keys([apiKey(), apiKey({ id: 'dead', name: 'Old', state: 'revoked', revokedAt: new Date().toISOString() })]));
    hooks.useApps.mockReturnValue(query([app()]));
    await renderPage('admin');
    expect(text()).toContain('settings.aiAssistants.signedIn');
    expect(text()).toContain('settings.aiAssistants.personalKey');
    expect(text()).toContain('Sara');
    const inactive = document.body.querySelector('[data-slot="inactive-connections"]');
    expect(inactive?.hasAttribute('open')).toBe(false);
    expect(inactive?.textContent).toContain('Old');
    expect(button('settings.aiAssistants.everyone')).toBeDefined();
  });

  it('warns about a key that expires within a week', async () => {
    hooks.useApiKeys.mockReturnValue(keys([apiKey({ expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString() })]));
    await renderPage();
    expect(text()).toContain('settings.aiAssistants.expiresSoon(in 3 days)');
  });

  it('keeps the plain sentence and raw details, and describes a blocked attempt in amber', async () => {
    hooks.useApiKeys.mockReturnValue(
      keys([
        apiKey({ lastActivity: { operation: 'publish_changes', outcome: 'failed', errorCode: 'mcp:scope_required', at: new Date().toISOString() } }),
      ]),
    );
    const { container } = await renderPage();
    expect(text()).toContain('settings.apiKeys.support_writerDescription');
    expect(container.querySelector('[data-tone="attention"]')?.textContent).toContain('settings.mcpActivity.keyCantPublish');
    expect(
      Array.from(container.querySelectorAll('details')).find((item) => item.textContent?.includes('settings.apiKeys.technicalDetails'))?.textContent,
    ).toContain('pages:write');
  });

  it('rotates only after approval, then shows the new secret once', async () => {
    hooks.useApiKeys.mockReturnValue(keys([apiKey()]));
    await renderPage();
    await click(button('settings.apiKeys.rotate'));
    expect(hooks.rotate.mutate).not.toHaveBeenCalled();
    hooks.confirm.mockResolvedValue(true);
    await click(button('settings.apiKeys.rotate'));
    expect(hooks.rotate.mutate).toHaveBeenCalledWith(
      { id: 'key-1', body: { scopes: ['mcp:connect', 'pages:write'], expiresInDays: 90 }, deliver: expect.any(Function) },
      expect.any(Object),
    );
    await act(async () => hooks.rotate.mutate.mock.calls[0]?.[0].deliver({ id: 'key-2', secret: 'plm_live_rotated' }));
    expect(text()).toContain('plm_live_rotated');
    expect(text()).toContain('settings.aiAssistants.keyDialog.done');
  });

  it('confirms before revoking or disconnecting, with the confirm button loading', async () => {
    hooks.useApiKeys.mockReturnValue(keys([apiKey()]));
    hooks.useApps.mockReturnValue(query([app()]));
    const page = await renderPage();
    await click(button('settings.connectedApps.disconnect'));
    expect(text()).toContain('settings.connectedApps.confirmTitle(ChatGPT)');
    const confirmButton = () => Array.from(document.body.querySelectorAll('[role="alertdialog"] button')).at(-1);
    await click(confirmButton());
    expect(hooks.disconnect.mutate).toHaveBeenCalledWith('grant-1', expect.any(Object));
    hooks.disconnect.isPending = true;
    await page.rerender();
    expect(confirmButton()?.getAttribute('aria-busy')).toBe('true');
  });

  it('keeps the keys and their actions when signed-in apps fail to load, with a notice and a retry for the apps', async () => {
    const refetch = vi.fn();
    hooks.useApiKeys.mockReturnValue(keys([apiKey()], { mcpEnabled: false }));
    hooks.useApps.mockReturnValue(query(undefined, { isPending: false, isError: true, refetch }));
    await renderPage('admin');
    expect(text()).toContain('Laptop');
    expect(button('settings.apiKeys.revoke')).toBeDefined();
    expect(text()).toContain('settings.aiAssistants.appsLoadError');
    expect(text()).not.toContain('settings.aiAssistants.connectionsLoadError');
    await click(button('error.tryAgain'));
    expect(refetch).toHaveBeenCalled();
  });

  it('keeps rows and offers a retry when a background refresh fails', async () => {
    hooks.useApiKeys.mockReturnValue({ ...keys([apiKey()]), isError: true });
    await renderPage();
    expect(text()).toContain('Laptop');
    expect(text()).toContain('settings.credentials.refreshFailed');
  });
});

describe('Personal key dialog', () => {
  async function openDialog(role = 'member') {
    await renderPage(role);
    await click(button('settings.aiAssistants.useKey'));
    return document.body.querySelector('[role="dialog"]');
  }

  it('gates Full admin for members with a reason, and creates the chosen key', async () => {
    const dialog = await openDialog();
    expect(dialog?.textContent).toContain('settings.aiAssistants.keyDialog.title');
    expect(dialog?.textContent).toContain('settings.apiKeys.adminOnly');
    await click(button('settings.apiKeys.create'));
    expect(hooks.create.mutate).toHaveBeenCalledWith(
      { body: { name: 'settings.apiKeys.defaultName', preset: 'support_writer', expiresInDays: 90 }, deliver: expect.any(Function) },
      expect.any(Object),
    );
  });

  const pressEscape = () =>
    act(async () => {
      (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

  it('closes on Escape while idle, but nothing closes it while a key is being created, and the secret still arrives', async () => {
    await openDialog();
    await pressEscape();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();

    for (const root of roots.splice(0)) await act(async () => root.unmount());
    const page = await renderPage();
    await click(button('settings.aiAssistants.useKey'));
    await click(button('settings.apiKeys.create'));
    hooks.create.isPending = true;
    await page.rerender();
    expect(document.body.querySelector('[data-slot="dialog-close"]')).toBeNull();
    await pressEscape();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    hooks.create.isPending = false;
    await act(async () => hooks.create.mutate.mock.calls.at(-1)?.[0].deliver({ id: 'key-9', secret: 'plm_live_pending' }));
    expect(text()).toContain('plm_live_pending');
  });

  it('fits a phone: the dialog is capped to the viewport, scrolls, and keeps its footer in view', async () => {
    const dialog = await openDialog();
    expect(dialog?.className).toMatch(/max-h-\[calc\(100dvh-2rem\)\]/);
    expect(dialog?.className).toContain('overflow-y-auto');
    expect(dialog?.querySelector('[data-slot="dialog-footer"]')?.className).toContain('sticky');
  });

  it('explains an empty name inline instead of creating a key', async () => {
    const dialog = await openDialog();
    const input = dialog?.querySelector<HTMLInputElement>('#api-key-name');
    await act(async () => {
      if (!input) throw new Error('missing name');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button('settings.apiKeys.create'));
    expect(hooks.create.mutate).not.toHaveBeenCalled();
    expect(input?.getAttribute('aria-invalid')).toBe('true');
  });

  it('shows the secret with setup for the chosen app, cannot be dismissed by Escape, and closes on "I saved my key"', async () => {
    await openDialog();
    await click(button('settings.apiKeys.create'));
    await act(async () => hooks.create.mutate.mock.calls[0]?.[0].deliver({ id: 'key-9', secret: 'plm_live_secret' }));
    expect(text()).toContain('plm_live_secret');
    // The form that held focus is gone: focus lands on the secret's Copy button, not the page.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(document.activeElement?.getAttribute('aria-label')).toBe('settings.apiKeys.copy');
    expect(text()).toContain(`claude mcp add --transport http nibleaf "${ENDPOINT}" --header "Authorization: Bearer plm_live_secret"`);
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(text()).toContain('plm_live_secret');
    await click(button('settings.aiAssistants.keyDialog.done'));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(text()).not.toContain('plm_live_secret');
  });

  it('runs the connection test with the new key and reports the tools it can use', async () => {
    let finish: (value: { tools: number; usedUntil: number }) => void = () => undefined;
    hooks.testConnection.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await openDialog();
    await click(button('settings.apiKeys.create'));
    await act(async () => hooks.create.mutate.mock.calls[0]?.[0].deliver({ id: 'key-9', secret: 'plm_live_one' }));
    await click(button('settings.apiKeys.test'));
    expect(hooks.testConnection).toHaveBeenCalledWith('plm_live_one');
    await act(async () => finish({ tools: 22, usedUntil: Date.now() }));
    expect(text()).toContain('settings.apiKeys.testSuccess(22)');
  });
});
