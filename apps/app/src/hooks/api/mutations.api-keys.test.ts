// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRevokeConnectedApp } from './mcp-oauth';
import { useRevokeApiKey } from './mutations';
import { queryKeys } from './query-keys';
import { apiKeysQueryOptions, connectedAppsQueryOptions } from './query-options';
import type { ApiKey, ApiKeyList, ConnectedApp } from './types';

const mocks = vi.hoisted(() => ({ revokeKey: vi.fn(), revokeApp: vi.fn(), listKeys: vi.fn(), listApps: vi.fn() }));

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@/services/api', () => ({
  api: {
    app: {
      projects: {
        ':projectId': {
          'api-keys': { $get: mocks.listKeys, ':id': { $delete: mocks.revokeKey } },
          'connected-apps': { $get: mocks.listApps, ':id': { $delete: mocks.revokeApp } },
        },
      },
    },
  },
}));

const projectId = 'project-a';
const key: ApiKey = {
  id: 'key-1',
  name: 'Support',
  lastFour: 'abcd',
  scopes: ['mcp:connect'],
  createdAt: '2026-11-01T00:00:00.000Z',
  lastUsedAt: null,
  expiresAt: '2027-01-01T00:00:00.000Z',
  revokedAt: null,
  rotatedFromId: null,
  legacy: false,
  state: 'active',
  preset: 'read_only',
  createdBy: null,
  lastActivity: null,
};
const keyList: ApiKeyList = { data: [key], meta: { mcpEnabled: true, mcpEndpoint: 'https://docs.example/api/mcp' } };
const app: ConnectedApp = {
  id: 'grant-1',
  name: 'ChatGPT',
  uri: null,
  preset: 'read_only',
  scopes: ['mcp:connect'],
  createdAt: '2026-11-01T00:00:00.000Z',
  lastUsedAt: null,
  connectedBy: { id: 'user-1', name: 'Ada', email: 'ada@example.com' },
  ownedByViewer: true,
  lastActivity: null,
};

const failure = () => new Response(JSON.stringify({ error: { code: 'http:internal', message: 'boom' } }), { status: 500 });
const deferred = () => {
  let resolve: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('optimistic revoke of MCP credentials', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let queryClient: QueryClient;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  const mount = async <T>(useHook: () => T) => {
    const ref: { current: T | null } = { current: null };
    function Probe() {
      ref.current = useHook();
      return null;
    }
    await act(async () => root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(Probe))));
    return ref;
  };

  it('marks a key revoked at once, then puts it back and keeps the plain error when the call fails', async () => {
    queryClient.setQueryData(queryKeys.apiKeys.all(projectId), keyList);
    const response = deferred();
    mocks.revokeKey.mockReturnValue(response.promise);
    const revoke = await mount(() => useRevokeApiKey(projectId));

    let settled: Promise<unknown> = Promise.resolve();
    await act(async () => {
      settled = revoke.current?.mutateAsync(key.id).catch((error: unknown) => error) ?? settled;
    });
    expect(queryClient.getQueryData<ApiKeyList>(queryKeys.apiKeys.all(projectId))?.data[0]).toMatchObject({ state: 'revoked' });
    expect(queryClient.getQueryData<ApiKeyList>(queryKeys.apiKeys.all(projectId))?.data[0]?.revokedAt).toEqual(expect.any(String));

    await act(async () => {
      response.resolve(failure());
      await settled;
    });
    expect(queryClient.getQueryData<ApiKeyList>(queryKeys.apiKeys.all(projectId))).toEqual(keyList);
    expect(queryClient.getMutationCache().getAll()[0]?.meta?.errorMessage).toBe('settings.apiKeys.revokeError');
  });

  it('invalidates the key list through queryKeys once a revoke settles', async () => {
    queryClient.setQueryData(queryKeys.apiKeys.all(projectId), keyList);
    mocks.revokeKey.mockResolvedValue(new Response(JSON.stringify({ data: { ...key, state: 'revoked' } }), { status: 200 }));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const revoke = await mount(() => useRevokeApiKey(projectId));
    await act(async () => {
      await revoke.current?.mutateAsync(key.id);
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.apiKeys.all(projectId) });
  });

  it('removes a disconnected app at once and restores it when the call fails', async () => {
    queryClient.setQueryData(queryKeys.connectedApps.all(projectId), [app]);
    const response = deferred();
    mocks.revokeApp.mockReturnValue(response.promise);
    const revoke = await mount(() => useRevokeConnectedApp(projectId));

    let settled: Promise<unknown> = Promise.resolve();
    await act(async () => {
      settled = revoke.current?.mutateAsync(app.id).catch((error: unknown) => error) ?? settled;
    });
    expect(queryClient.getQueryData(queryKeys.connectedApps.all(projectId))).toEqual([]);

    await act(async () => {
      response.resolve(failure());
      await settled;
    });
    expect(queryClient.getQueryData(queryKeys.connectedApps.all(projectId))).toEqual([app]);
    expect(queryClient.getMutationCache().getAll()[0]?.meta?.errorMessage).toBe('settings.connectedApps.disconnectError');
  });
});

describe('MCP credential query factories', () => {
  it('key the lists with queryKeys and skip fetching without a project', () => {
    expect(apiKeysQueryOptions(projectId).queryKey).toEqual(queryKeys.apiKeys.all(projectId));
    expect(connectedAppsQueryOptions(projectId).queryKey).toEqual(queryKeys.connectedApps.all(projectId));
    expect(typeof apiKeysQueryOptions(undefined).queryFn).not.toBe('function');
    expect(typeof connectedAppsQueryOptions(undefined).queryFn).not.toBe('function');
  });

  it('keeps the list meta alongside the keys', async () => {
    mocks.listKeys.mockResolvedValue(new Response(JSON.stringify(keyList), { status: 200 }));
    const client = new QueryClient();
    await expect(client.fetchQuery(apiKeysQueryOptions(projectId))).resolves.toEqual(keyList);
    expect(mocks.listKeys).toHaveBeenCalledWith({ param: { projectId } });
  });
});
