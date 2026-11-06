import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiResponseError } from './client-helpers';
import { friendlyErrorMessage } from './errors';

const t = (key: string) => `t:${key}`;

describe('friendlyErrorMessage', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  afterEach(() => consoleError.mockClear());

  it('never shows the raw server message', () => {
    const error = new ApiResponseError('A page can only be moved under a parent in the same branch and language.', 400);
    expect(friendlyErrorMessage(t, error, 'editor.reorderFailed')).toBe('t:editor.reorderFailed');
    // The details stay available for debugging.
    expect(consoleError).toHaveBeenCalledWith(error);
  });

  it('explains common HTTP failures in plain words', () => {
    expect(friendlyErrorMessage(t, new ApiResponseError('Forbidden', 403), 'editor.deleteFailed')).toBe('t:error.noPermission');
    expect(friendlyErrorMessage(t, new ApiResponseError('Unauthorized', 401), 'editor.deleteFailed')).toBe('t:error.signedOut');
    expect(friendlyErrorMessage(t, new ApiResponseError('Not found', 404), 'editor.deleteFailed')).toBe('t:error.notFound');
    expect(friendlyErrorMessage(t, new ApiResponseError('Upload failed.', 413), 'editor.deleteFailed')).toBe('t:error.tooLarge');
    expect(friendlyErrorMessage(t, new ApiResponseError('Slow down', 429), 'editor.deleteFailed')).toBe('t:error.rateLimited');
  });

  it('recognises a request that never reached the server', () => {
    expect(friendlyErrorMessage(t, new TypeError('fetch failed'), 'editor.createFailed')).toBe('t:error.network');
  });

  it('falls back to the action message for anything else', () => {
    expect(friendlyErrorMessage(t, new Error('boom'), 'editor.createFailed')).toBe('t:editor.createFailed');
    expect(friendlyErrorMessage(t, 'weird', 'editor.createFailed')).toBe('t:editor.createFailed');
  });
});
