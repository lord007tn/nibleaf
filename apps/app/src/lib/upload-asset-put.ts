import { ApiResponseError } from '@/hooks/api/client-helpers';

/** Optional byte progress for editor uploads; existing asset callers keep the fetch path. */
export async function putAsset(url: string, file: File, contentType: string, onProgress?: (percent: number) => void): Promise<void> {
  if (!onProgress) {
    const response = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': contentType } });
    if (!response.ok) throw new ApiResponseError('Upload failed.', response.status);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader('Content-Type', contentType);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300 ? resolve() : reject(new ApiResponseError('Upload failed.', request.status));
    request.onerror = () => reject(new Error('Upload failed.'));
    request.onabort = () => reject(new Error('Upload cancelled.'));
    request.send(file);
  });
}
