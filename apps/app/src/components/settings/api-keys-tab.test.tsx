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
