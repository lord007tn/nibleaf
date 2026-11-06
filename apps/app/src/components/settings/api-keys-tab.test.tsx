/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  useApiKeys: vi.fn(),
  mutation: { isPending: false, mutate: vi.fn() },
}));

vi.mock('@nibleaf/i18n/react', () => ({ useLocale: () => ({ locale: 'en', t: (key: string) => key }) }));
vi.mock('@/hooks/api', () => ({
  useApiKeys: hooks.useApiKeys,
  useCreateApiKey: () => hooks.mutation,
  useRevokeApiKey: () => hooks.mutation,
  useRotateApiKey: () => hooks.mutation,
}));

import { ApiKeysTab } from './api-keys-tab';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => root.unmount());
  }
  document.body.replaceChildren();
});

describe('API-key settings list state', () => {
  it('renders a localized query failure instead of the empty state', async () => {
    hooks.useApiKeys.mockReturnValue({ data: undefined, error: new Error('sensitive backend detail'), isError: true, isLoading: false });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => root.render(<ApiKeysTab projectId="project-1" />));

    expect(container.querySelector('[role="alert"]')?.textContent).toBe('settings.apiKeys.loadError');
    expect(container.textContent).not.toContain('settings.apiKeys.empty');
    expect(container.textContent).not.toContain('sensitive backend detail');
  });
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
  isLoading: false,
});
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
  expect(Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('settings.apiKeys.create'))?.disabled).toBe(
    true,
  );
});
it('shows setup once, includes endpoint and hides the secret on dismissal', async () => {
  hooks.useApiKeys.mockReturnValue(response());
  hooks.mutation.mutate.mockImplementation((_body, options) => options.onSuccess({ id: 'new-key', secret: 'test-once-secret' }));
  const container = await renderTab();
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('settings.apiKeys.create'))
      ?.click(),
  );
  expect(container.textContent).toContain('test-once-secret');
  expect(container.querySelector('pre')?.textContent).toContain('https://docs.example/api/mcp');
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('settings.apiKeys.dismissSecret'))
      ?.click(),
  );
  expect(container.textContent).not.toContain('test-once-secret');
});
it('requires confirmation before revoke', async () => {
  hooks.mutation.mutate.mockReset();
  hooks.useApiKeys.mockReturnValue(
    response(true, [
      {
        id: 'key-1',
        name: 'Support',
        preset: 'support_writer',
        createdAt: new Date().toISOString(),
        scopes: ['mcp:connect'],
        state: 'active',
        lastFour: 'abcd',
      },
    ]),
  );
  const container = await renderTab();
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('settings.apiKeys.revoke'))
      ?.click(),
  );
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  expect(hooks.mutation.mutate).not.toHaveBeenCalled();
});
