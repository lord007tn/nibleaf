// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteSignOut } from './site-sign-out';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('site sign-out', () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });

  const click = async (onSignedOut: () => void) => {
    await act(async () => root.render(<SiteSignOut onSignedOut={onSignedOut} projectId="site-1" />));
    await act(async () => container.querySelector('button')?.click());
  };

  it('reloads only after the server ended the session', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const onSignedOut = vi.fn();
    await click(onSignedOut);
    expect(fetchMock).toHaveBeenCalledWith('/api/public/reader-access/logout/site-1', { method: 'POST', credentials: 'same-origin' });
    expect(onSignedOut).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it.each([
    ['a server error', () => Promise.resolve(new Response('{}', { status: 500 }))],
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('says sign-out failed after %s and lets the reader retry', async (_label, failure) => {
    fetchMock.mockImplementationOnce(failure);
    const onSignedOut = vi.fn();
    await click(onSignedOut);
    expect(onSignedOut).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Couldn't sign out");
    expect(container.querySelector('button')?.disabled).toBe(false);
  });
});
