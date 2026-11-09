import { ApiResponseError } from '@/hooks/api/client-helpers';

/** Relative API URLs use first-party session cookies in both fetch and XHR.
 * Absolute storage URLs keep the browser's default credential policy. */
export async function putAsset(
  url: string,
  file: File,
  contentType: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!onProgress) {
    const response = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': contentType }, signal });
    if (!response.ok) throw new ApiResponseError('Upload failed.', response.status);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Upload cancelled.', 'AbortError'));
      return;
    }
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    signal?.addEventListener('abort', abort, { once: true });
    request.onloadend = () => signal?.removeEventListener('abort', abort);
    request.open('PUT', url);
    request.setRequestHeader('Content-Type', contentType);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300 ? resolve() : reject(new ApiResponseError('Upload failed.', request.status));
    request.onerror = () => reject(new Error('Upload failed.'));
    request.timeout = 120_000;
    request.ontimeout = () => reject(new Error('Upload timed out.'));
    request.onabort = () => reject(new Error('Upload cancelled.'));
    request.send(file);
  });
}
