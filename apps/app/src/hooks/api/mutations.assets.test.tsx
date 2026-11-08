// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeleteAsset, useUploadAsset } from './mutations';

const mocks = vi.hoisted(() => ({ presign: vi.fn(), confirm: vi.fn(), list: vi.fn(), put: vi.fn(), remove: vi.fn() }));
vi.mock('@/services/api', () => ({
  api: {
    app: {
      projects: {
        ':projectId': {
          assets: { presign: { $post: mocks.presign }, confirm: { $post: mocks.confirm }, $get: mocks.list, ':assetId': { $delete: mocks.remove } },
        },
      },
    },
  },
}));
vi.mock('@/lib/upload-asset-put', () => ({ putAsset: mocks.put }));
const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const asset = {
  id: 'asset-1',
  key: 'projects/project-a/assets/identity-1',
  url: '/api/public/assets/projects/project-a/assets/identity-1',
  contentType: 'image/png',
  size: 5,
  createdAt: '2026-01-01',
};
let root: Root;
let host: HTMLElement;
let hook: ReturnType<typeof useUploadAsset>;
let removeHook: ReturnType<typeof useDeleteAsset>;
let client: QueryClient;
function Probe() {
  hook = useUploadAsset('project-a');
  removeHook = useDeleteAsset('project-a');
  return null;
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  mocks.presign.mockImplementation(() => response(200, { data: { key: asset.key, uploadUrl: '/storage/signed', contentType: 'image/png' } }));
  mocks.put.mockResolvedValue(undefined);
  mocks.list.mockResolvedValue(response(200, { data: [] }));
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Probe))));
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  host.remove();
  vi.unstubAllGlobals();
});
describe('asset identity across editor Retry (4)', () => {
  it('keeps the successful PUT identity even when a later caller retries after a completed confirmation', async () => {
    mocks.confirm
      .mockResolvedValueOnce(response(201, { data: asset }))
      .mockResolvedValueOnce(response(500, { error: { code: 'http:internal', message: 'Internal server error' } }));
    mocks.list.mockResolvedValue(response(200, { data: [asset] }));
    const file = new File(['image'], 'one.png', { type: 'image/png' });
    await act(async () => {
      await expect(hook.mutateAsync(file)).resolves.toMatchObject(asset);
    });
    await act(async () => {
      await expect(hook.mutateAsync(file)).resolves.toMatchObject(asset);
    });
    expect(mocks.presign).toHaveBeenCalledOnce();
    expect(mocks.put).toHaveBeenCalledOnce();
    expect(mocks.confirm.mock.calls.map(([body]) => body.json.key)).toEqual([asset.key, asset.key]);
  });
  it('retries only confirm with the same key after a lost confirmation, and recovers the already-created asset', async () => {
    mocks.confirm
      .mockRejectedValueOnce(new Error('Lost confirmation response'))
      .mockResolvedValueOnce(response(500, { error: { code: 'http:internal', message: 'Internal server error' } }));
    mocks.list.mockRejectedValueOnce(new Error('List temporarily offline')).mockResolvedValueOnce(response(200, { data: [asset] }));
    const file = new File(['image'], 'one.png', { type: 'image/png' });
    const finishing = vi.fn();
    await act(async () => {
      await expect(hook.mutateAsync({ file, onFinishing: finishing })).rejects.toThrow('Lost confirmation response');
    });
    // A real hook render must not lose the previous attempt's storage identity.
    await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Probe))));
    await act(async () => {
      await expect(hook.mutateAsync({ file, onFinishing: finishing })).resolves.toMatchObject(asset);
    });
    expect(mocks.presign).toHaveBeenCalledOnce();
    expect(mocks.put).toHaveBeenCalledOnce();
    expect(mocks.confirm).toHaveBeenCalledTimes(2);
    expect(mocks.confirm.mock.calls.map(([body]) => body.json.key)).toEqual([asset.key, asset.key]);
    expect(finishing).toHaveBeenCalledTimes(2);
  });
  it('does not treat an unrecognizable 500 as success without the exact asset key', async () => {
    mocks.confirm.mockResolvedValue(response(500, { error: { code: 'http:internal', message: 'Internal server error' } }));
    mocks.list.mockResolvedValue(response(200, { data: [{ ...asset, key: 'projects/project-a/assets/unrelated' }] }));
    await act(async () => {
      await expect(hook.mutateAsync(new File(['image'], 'one.png', { type: 'image/png' }))).rejects.toMatchObject({
        status: 500,
        code: 'http:internal',
      });
    });
    expect(mocks.list).toHaveBeenCalledOnce();
    expect(mocks.put).toHaveBeenCalledOnce();
  });
  it('repeats a failed PUT using its original identity before attempting confirm', async () => {
    mocks.put.mockRejectedValueOnce(new Error('PUT failed')).mockResolvedValueOnce(undefined);
    mocks.confirm.mockResolvedValue(response(201, { data: asset }));
    const file = new File(['image'], 'one.png', { type: 'image/png' });
    await act(async () => {
      await expect(hook.mutateAsync(file)).rejects.toThrow('PUT failed');
    });
    expect(mocks.confirm).not.toHaveBeenCalled();
    await act(async () => {
      await expect(hook.mutateAsync(file)).resolves.toMatchObject(asset);
    });
    expect(mocks.presign).toHaveBeenCalledOnce();
    expect(mocks.put).toHaveBeenCalledTimes(2);
    expect(mocks.confirm).toHaveBeenCalledOnce();
  });
});
describe('signed upload media type', () => {
  it('uses the normalized signed media type for both the storage PUT and confirmation', async () => {
    mocks.confirm.mockResolvedValue(response(201, { data: asset }));
    const file = new File(['image'], 'one.png', { type: 'image/x-png' });
    await act(async () => {
      await expect(hook.mutateAsync(file)).resolves.toMatchObject(asset);
    });
    expect(mocks.presign.mock.calls[0]?.[0].json.contentType).toBe('image/x-png');
    expect(mocks.put).toHaveBeenCalledExactlyOnceWith('/storage/signed', file, 'image/png', undefined, undefined);
    expect(mocks.confirm.mock.calls[0]?.[0].json).toEqual({ key: asset.key, contentType: 'image/png', size: file.size });
  });
});
describe('deleting an unplaced upload', () => {
  it('deletes that one asset of the project', async () => {
    mocks.remove.mockResolvedValue(response(200, { data: { id: asset.id } }));
    await act(async () => {
      await expect(removeHook.mutateAsync(asset.id)).resolves.toEqual({ id: asset.id });
    });
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({ param: { projectId: 'project-a', assetId: asset.id } });
  });
  it('rejects when the server keeps a file that saved content uses', async () => {
    mocks.remove.mockResolvedValue(response(409, { error: { code: 'asset:in_use', message: 'kept' } }));
    await act(async () => {
      await expect(removeHook.mutateAsync(asset.id)).rejects.toBeDefined();
    });
  });
});
