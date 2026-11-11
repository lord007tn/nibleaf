// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn(), list: vi.fn(), detail: vi.fn() }));
vi.mock('@/hooks/api', () => ({ useDeleteProject: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }) }));
vi.mock('@/hooks/api/organization-query-options', () => ({
  organizationProjectsQueryOptions: (organizationId: string) => ({
    queryKey: ['organizations', organizationId, 'projects', 'list'],
    queryFn: mocks.list,
  }),
}));
vi.mock('@/hooks/api/query-options', () => ({
  projectQueryOptions: (projectId: string) => ({ queryKey: ['projects', projectId], queryFn: mocks.detail }),
}));

import { useDeleteWebsite } from './delete-website';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['projects', 'site-1'], { id: 'site-1' });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

async function mount(organizationId: string | undefined) {
  const result = {} as { current: ReturnType<typeof useDeleteWebsite> };
  function Probe() {
    result.current = useDeleteWebsite(organizationId);
    return null;
  }
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Probe))));
  return result;
}
const status = (code: number) => Object.assign(new Error(`HTTP ${code}`), { status: code });

describe('deleting a website when the answer is unclear (council #479)', () => {
  it('counts a lost response as done once the organization no longer lists the website, and forgets it', async () => {
    mocks.mutateAsync.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    mocks.list.mockResolvedValueOnce([{ id: 'site-2' }]);
    const hook = await mount('org-1');
    await expect(hook.current.deleteWebsite('site-1')).resolves.toBeUndefined();
    expect(mocks.list).toHaveBeenCalledOnce();
    expect(client.getQueryData(['projects', 'site-1'])).toBeUndefined();
  });

  it('counts "not found" on a retry as done when the website is gone', async () => {
    mocks.mutateAsync.mockRejectedValueOnce(status(404));
    mocks.list.mockResolvedValueOnce([]);
    const hook = await mount('org-1');
    await expect(hook.current.deleteWebsite('site-1')).resolves.toBeUndefined();
  });

  it('keeps a server error when the website is still listed', async () => {
    const error = status(502);
    mocks.mutateAsync.mockRejectedValueOnce(error);
    mocks.list.mockResolvedValueOnce([{ id: 'site-1' }]);
    const hook = await mount('org-1');
    await expect(hook.current.deleteWebsite('site-1')).rejects.toBe(error);
    expect(client.getQueryData(['projects', 'site-1'])).toEqual({ id: 'site-1' });
  });

  it('keeps the original error when the check itself fails', async () => {
    const error = new TypeError('Failed to fetch');
    mocks.mutateAsync.mockRejectedValueOnce(error);
    mocks.list.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const hook = await mount('org-1');
    await expect(hook.current.deleteWebsite('site-1')).rejects.toBe(error);
  });

  it("doesn't check after a refusal the server decided", async () => {
    const error = status(403);
    mocks.mutateAsync.mockRejectedValueOnce(error);
    const hook = await mount('org-1');
    await expect(hook.current.deleteWebsite('site-1')).rejects.toBe(error);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('asks for the website itself outside an organization', async () => {
    mocks.mutateAsync.mockRejectedValueOnce(status(504));
    mocks.detail.mockRejectedValueOnce(status(404));
    const gone = await mount(undefined);
    await expect(gone.current.deleteWebsite('site-1')).resolves.toBeUndefined();

    const error = status(504);
    mocks.mutateAsync.mockRejectedValueOnce(error);
    mocks.detail.mockResolvedValueOnce({ id: 'site-1' });
    await expect(gone.current.deleteWebsite('site-1')).rejects.toBe(error);
  });
});
