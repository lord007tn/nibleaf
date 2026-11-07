// @vitest-environment jsdom
import { CancelledError, QueryClient, QueryClientProvider, type UseMutationOptions } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { syncDashboardSession, useSessionMutation, useSessionQueryClient } from './session-cache';
import { getSessionGeneration } from './session-generation';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const cacheKey = ['private-list'];
const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
let client: QueryClient;
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  syncDashboardSession(client, 'alice');
  client.setQueryData(cacheKey, ['Alice private data']);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
async function mount(options: (client: QueryClient) => UseMutationOptions<string, Error, void, string[] | undefined>) {
  let mutate: () => Promise<unknown> = () => Promise.reject(new Error('not mounted'));
  function Probe() {
    const scopedClient = useSessionQueryClient();
    const mutation = useSessionMutation(options(scopedClient));
    mutate = () => mutation.mutateAsync();
    return null;
  }
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    ),
  );
  return Object.assign(() => mutate(), {
    rerender: () =>
      act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <Probe />
          </QueryClientProvider>,
        ),
      ),
  });
}
function switchAccount() {
  syncDashboardSession(client, 'bob');
  client.setQueryData(cacheKey, ['Bob private data']);
}

it.each(['success', 'failure'])('ignores delayed mutation %s cache effects after an account change', async (outcome) => {
  const response = deferred<string>();
  const callback = vi.fn();
  const mutate = await mount((scoped) => ({
    mutationFn: () => response.promise,
    onMutate: () => {
      const previous = scoped.getQueryData<string[]>(cacheKey);
      scoped.setQueryData(cacheKey, ['Alice optimistic data']);
      return previous;
    },
    onSuccess: () => {
      callback();
      scoped.setQueryData(cacheKey, ['Alice server data']);
    },
    onError: (_error, _variables, previous) => {
      callback();
      scoped.setQueryData(cacheKey, previous);
    },
    onSettled: () => scoped.invalidateQueries({ queryKey: cacheKey }),
  }));
  let result: Promise<unknown> = Promise.resolve();
  await act(async () => {
    result = mutate().catch((error) => error);
  });
  const oldMutation = client.getMutationCache().getAll()[0];
  const generation = oldMutation?.meta?.sessionGeneration;
  expect(generation).toBe(getSessionGeneration(client));
  switchAccount();
  await mutate.rerender();
  expect(oldMutation?.meta?.sessionGeneration).toBe(generation);
  expect(generation).not.toBe(getSessionGeneration(client));
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  await act(async () => {
    if (outcome === 'success') response.resolve('saved');
    else response.reject(new Error('failed'));
    await result;
  });
  expect(client.getQueryData(cacheKey)).toEqual(['Bob private data']);
  expect(callback).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();
});

it('ignores a rollback that was already awaiting work when the account changed', async () => {
  const rollback = deferred<void>();
  const entered = vi.fn();
  const mutate = await mount((scoped) => ({
    mutationFn: async () => {
      throw new Error('failed');
    },
    onMutate: () => scoped.getQueryData<string[]>(cacheKey),
    onError: async (_error, _variables, previous) => {
      entered();
      await rollback.promise;
      scoped.setQueryData(cacheKey, previous);
    },
  }));
  let result: Promise<unknown> = Promise.resolve();
  await act(async () => {
    result = mutate().catch((error) => error);
  });
  expect(entered).toHaveBeenCalledOnce();
  switchAccount();
  await act(async () => {
    rollback.resolve();
    await result;
  });
  expect(client.getQueryData(cacheKey)).toEqual(['Bob private data']);
});

it('ignores an already-running success callback after its await across an account change', async () => {
  const followUp = deferred<void>();
  const entered = vi.fn();
  const mutate = await mount((scoped) => ({
    mutationFn: async () => 'saved',
    onSuccess: async () => {
      entered();
      await followUp.promise;
      scoped.setQueriesData({ queryKey: cacheKey }, ['Alice server data']);
      await scoped.invalidateQueries({ queryKey: cacheKey });
    },
  }));
  let result: Promise<unknown> = Promise.resolve();
  await act(async () => {
    result = mutate();
  });
  expect(entered).toHaveBeenCalledOnce();
  switchAccount();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  await act(async () => {
    followUp.resolve();
    await result;
  });
  expect(client.getQueryData(cacheKey)).toEqual(['Bob private data']);
  expect(invalidate).not.toHaveBeenCalled();
});

it('prevents an old optimistic step resuming from writing or starting its request', async () => {
  const optimistic = deferred<void>();
  const request = vi.fn(async () => 'saved');
  const mutate = await mount((scoped) => ({
    mutationFn: request,
    onMutate: async () => {
      await optimistic.promise;
      scoped.setQueryData(cacheKey, ['Alice optimistic data']);
      return ['Alice private data'];
    },
  }));
  let result: Promise<unknown> = Promise.resolve();
  await act(async () => {
    result = mutate().catch((error) => error);
  });
  switchAccount();
  await act(async () => {
    optimistic.resolve();
    await result;
  });
  expect(client.getQueryData(cacheKey)).toEqual(['Bob private data']);
  expect(request).not.toHaveBeenCalled();
});

it('still applies current-session mutation results', async () => {
  const mutate = await mount((scoped) => ({
    mutationFn: async () => 'saved',
    onSuccess: (value) => {
      scoped.setQueryData(cacheKey, [value]);
    },
  }));
  await act(async () => {
    await mutate();
  });
  expect(client.getQueryData(cacheKey)).toEqual(['saved']);
  expect(client.getMutationCache().getAll()[0]?.meta?.sessionGeneration).toBe(getSessionGeneration(client));
});

it('rejects a stale hook intent after rerendering without running optimistic work or a request', async () => {
  const request = vi.fn(async () => 'saved');
  const optimistic = vi.fn(() => ['Alice optimistic data']);
  const mutate = await mount(() => ({ mutationFn: request, onMutate: optimistic }));
  switchAccount();
  await mutate.rerender();
  let result: unknown;
  await act(async () => {
    result = await mutate().catch((error) => error);
  });
  expect(result).toBeInstanceOf(CancelledError);
  expect(optimistic).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
  expect(client.getQueryData(cacheKey)).toEqual(['Bob private data']);
});
