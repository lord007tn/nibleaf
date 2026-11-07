// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMergeBranch } from './mutations';
import { queryKeys } from './query-keys';
import { branchMergePreviewQueryOptions } from './query-options';

const mocks = vi.hoisted(() => ({ merge: vi.fn(), preview: vi.fn() }));

vi.mock('@/services/api', () => ({
  api: { app: { projects: { ':projectId': { branches: { ':id': { merge: { $post: mocks.merge }, 'merge-preview': { $get: mocks.preview } } } } } } },
}));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const preview = { changedOnMainSinceFork: [], baselineComplete: true };

describe('promoting a version', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  it('loads the merge preview under the branches key', async () => {
    mocks.preview.mockResolvedValue(json({ data: preview }));
    const options = branchMergePreviewQueryOptions('project-a', 'v2');
    expect(options.queryKey).toEqual(queryKeys.branches.mergePreview('project-a', 'v2'));
    expect(options.queryKey.slice(0, 2)).toEqual(queryKeys.branches.all('project-a'));
    await expect(new QueryClient().fetchQuery(options)).resolves.toEqual(preview);
    expect(mocks.preview).toHaveBeenCalledWith({ param: { projectId: 'project-a', id: 'v2' } });
  });

  it('sends the confirmation only when asked and surfaces branch:main_changed', async () => {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    let merge: ReturnType<typeof useMergeBranch> | undefined;
    function Probe() {
      merge = useMergeBranch('project-a');
      return null;
    }
    const root = createRoot(container);
    await act(async () => root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(Probe))));

    mocks.merge.mockResolvedValueOnce(json({ error: { code: 'branch:main_changed', message: 'Pages on main changed.', details: preview } }, 409));
    await act(async () => {
      await expect(merge?.mutateAsync('v2')).rejects.toMatchObject({ status: 409, code: 'branch:main_changed' });
    });
    expect(mocks.merge).toHaveBeenLastCalledWith({ param: { projectId: 'project-a', id: 'v2' }, json: {} });

    mocks.merge.mockResolvedValueOnce(json({ data: { id: 'main' } }));
    await act(async () => {
      await merge?.mutateAsync({ id: 'v2', confirmPreview: 'c'.repeat(64) });
    });
    expect(mocks.merge).toHaveBeenLastCalledWith({ param: { projectId: 'project-a', id: 'v2' }, json: { confirmPreview: 'c'.repeat(64) } });
    act(() => root.unmount());
  });
});
