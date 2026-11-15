// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { toast } from 'sonner';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DeferredToaster } from './deferred-toaster';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // The toaster reads the colour scheme.
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })),
  );
});

afterEach(async () => {
  toast.dismiss();
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

it('renders nothing on the server, so the toast host never reaches the first load', () => {
  expect(renderToString(<DeferredToaster position="bottom-right" />)).toBe('');
});

it('keeps the page as it is when the toast host cannot load', async () => {
  const loader = await import('./deferred-toaster-loader');
  const spy = vi.spyOn(loader, 'loadDeferredToaster').mockResolvedValueOnce(null);
  container = document.createElement('div');
  container.innerHTML = '<p id="form">form</p>';
  document.body.append(container);
  const host = document.createElement('div');
  container.append(host);
  await act(async () => {
    root = createRoot(host);
    root.render(<DeferredToaster position="bottom-right" />);
  });
  await vi.waitFor(() => expect(spy).toHaveBeenCalled(), { timeout: 5000 });
  await act(async () => Promise.resolve());
  expect(container.querySelector('#form')?.textContent).toBe('form');
  expect(container.querySelector('section[aria-live]')).toBeNull();
  spy.mockRestore();
});

it('shows toasts fired before the lazy toast host resolved, in its live region', async () => {
  // Fired before the host is even rendered (a toast from an early effect)...
  toast.success('Saved before the host');
  container = document.createElement('div');
  document.body.append(container);
  await act(async () => {
    root = createRoot(container as HTMLDivElement);
    root.render(<DeferredToaster position="bottom-right" />);
  });
  // ...and while its chunk is still loading.
  expect(container.querySelector('section[aria-live]')).toBeNull();
  toast('Sent while loading');

  // The host's first import is a real, cold module load: under a parallel test
  // run it can take well over vitest's 1 s default, so give it room.
  await vi.waitFor(
    () => {
      const region = container?.querySelector('section[aria-live="polite"]');
      expect(region?.textContent).toContain('Saved before the host');
      expect(region?.textContent).toContain('Sent while loading');
    },
    { timeout: 10_000 },
  );
}, 15_000);
