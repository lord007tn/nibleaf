// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { useCreateProjectSearchReindex } from './project-search';
import { queryKeys } from './query-keys';
import { useSaveWorkspaceAiConnection, useSelectWorkspaceAi, useWorkspaceAiModels } from './workspace-ai';

const mocks = vi.hoisted(() => ({
  models: vi.fn(),
  connection: vi.fn(),
  select: vi.fn(),
  reindex: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/services/api', () => ({
  api: {
    app: {
      projects: {
        ':projectId': {
          settings: {
            ai: { $patch: mocks.select, models: { $post: mocks.models }, connection: { $put: mocks.connection } },
            search: { reindex: { $post: mocks.reindex } },
          },
        },
      },
    },
  },
}));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: vi.fn() } }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));

/** What the API answers on failure: an English, technical message the person must never see. */
const failure = (status: number, code?: string) =>
  Response.json({ error: { code, message: `Upstream said: sk-or-v1-secret rejected (${status})` } }, { status });

let root: ReturnType<typeof createRoot>;
let client: ReturnType<typeof createQueryClient>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  client = createQueryClient();
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  client.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

/** Render a hook inside the app's real QueryClient (with its shared error toasts) and return its latest value. */
async function mountHook<T>(useHook: () => T): Promise<{ current: T }> {
  const result = {} as { current: T };
  function Probe() {
    result.current = useHook();
    return null;
  }
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Probe))));
  return result;
}
/** Run a mutation to completion and let the lazily imported toast land. */
const settle = async (run: () => Promise<unknown>) => {
  await act(async () => {
    await run().catch(() => undefined);
  });
  await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
};

describe('Smart AI requests report failures once, in plain words', () => {
  it('says a key was refused, never what the provider answered', async () => {
    mocks.models.mockResolvedValue(failure(400, 'integration:credentials_invalid'));
    const models = await mountHook(() => useWorkspaceAiModels('project'));
    await settle(() => models.current.mutateAsync({ providerId: 'openrouter', apiKey: 'sk-or-v1-secret' }));
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('settings.smartAi.invalidKey');
  });

  it('says the settings changed elsewhere on a conflict, and words other failures generally', async () => {
    mocks.select.mockResolvedValue(failure(409));
    const select = await mountHook(() => useSelectWorkspaceAi('project'));
    await settle(() => select.current.mutateAsync({ providerId: 'openrouter', answersEnabled: true }));
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('settings.smartAi.conflict');

    mocks.toastError.mockClear();
    mocks.connection.mockResolvedValue(failure(500));
    const save = await mountHook(() => useSaveWorkspaceAiConnection('project'));
    await settle(() => save.current.mutateAsync({ providerId: 'openrouter', answerModel: 'model', expectedRevision: 1 }));
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('settings.smartAi.error');
  });
});

describe('reindexing', () => {
  it.each([
    [409, 'settings.search.diagnostics.reindexActive'],
    [404, 'settings.smartAi.indexUnpublished'],
    [503, 'settings.search.diagnostics.reindexError'],
  ])('explains a %s failure once', async (status, message) => {
    mocks.reindex.mockResolvedValue(failure(status));
    const reindex = await mountHook(() => useCreateProjectSearchReindex('project'));
    await settle(() => reindex.current.mutateAsync());
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(message);
  });

  it('refreshes the index status in both Search and Smart AI', async () => {
    mocks.reindex.mockResolvedValue(Response.json({ data: { id: 'run' } }));
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const reindex = await mountHook(() => useCreateProjectSearchReindex('project'));
    await act(async () => {
      await reindex.current.mutateAsync();
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.projectSearch.allIndex('project') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.workspaceAi.detail('project') });
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});
