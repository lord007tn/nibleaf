// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { useAiDraft } from './mutations';

const mocks = vi.hoisted(() => ({ draft: vi.fn(), toast: vi.fn() }));
vi.mock('@/services/api', () => ({ api: { app: { projects: { ':projectId': { ai: { $post: mocks.draft } } } } } }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('sonner', () => ({ toast: { error: mocks.toast } }));

describe('AI draft failure messages', () => {
  const client = createQueryClient();
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    client.clear();
    vi.restoreAllMocks();
  });
  it.each([
    [503, 'usage:unavailable', 'editor.ai.unavailable'],
    [429, 'http:rate_limited', 'editor.ai.rateLimited'],
    [503, 'ai:not_configured', 'editor.ai.notConfigured'],
    [403, 'ai:disabled', 'editor.ai.disabled'],
    [403, 'auth:insufficient_role', 'error.noPermission'],
    [502, 'ai:provider_response', 'editor.ai.draftError'],
  ] as const)('shows the action-specific message for HTTP %s / %s', async (status, code, message) => {
    mocks.draft.mockResolvedValue(new Response(JSON.stringify({ error: { code, message: 'Internal provider detail' } }), { status }));
    let draft: ReturnType<typeof useAiDraft> | undefined;
    function Probe() {
      draft = useAiDraft('project');
      return null;
    }
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Probe))));
    await act(async () => {
      await draft?.mutateAsync({ mode: 'outline', content: 'Synthetic introduction' }).catch(() => undefined);
    });
    await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(message));
    expect(mocks.toast).toHaveBeenCalledTimes(1);
  });
});
