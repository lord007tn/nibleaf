// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { putAsset } from './upload-asset-put';

afterEach(() => vi.unstubAllGlobals());
describe('asset PUT progress', () => {
  it('preserves the existing fetch upload path and HTTP error status', async () => {
    const file = new File(['bytes'], 'a.png', { type: 'image/png' });
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetcher);
    await putAsset('https://storage.example/signed', file, file.type);
    expect(fetcher).toHaveBeenCalledWith('https://storage.example/signed', { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
    fetcher.mockResolvedValueOnce({ ok: false, status: 413 });
    await expect(putAsset('https://storage.example/signed', file, file.type)).rejects.toMatchObject({ status: 413 });
  });
  it('reports actual XHR uploaded bytes and rejects storage failures', async () => {
    const requests: FakeRequest[] = [];
    class FakeRequest {
      upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
      status = 200;
      onload?: () => void;
      onerror?: () => void;
      onabort?: () => void;
      open = vi.fn();
      setRequestHeader = vi.fn();
      send = vi.fn();
      constructor() {
        requests.push(this);
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeRequest);
    const progress = vi.fn();
    const file = new File(['bytes'], 'a.png', { type: 'image/png' });
    const upload = putAsset('https://storage.example/signed', file, file.type, progress);
    const request = requests[0];
    if (!request) throw new Error('Expected a storage request');
    expect(request.open).toHaveBeenCalledWith('PUT', 'https://storage.example/signed');
    expect(request.setRequestHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(request.send).toHaveBeenCalledWith(file);
    request.upload.onprogress?.({ lengthComputable: false, loaded: 2, total: 0 });
    expect(progress).not.toHaveBeenCalled();
    request.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 5 });
    expect(progress).toHaveBeenCalledWith(40);
    request.onload?.();
    await upload;
    const failed = putAsset('https://storage.example/signed', file, file.type, progress);
    const denied = requests[1];
    if (!denied) throw new Error('Expected another storage request');
    denied.status = 403;
    denied.onload?.();
    await expect(failed).rejects.toMatchObject({ status: 403 });
  });
});
