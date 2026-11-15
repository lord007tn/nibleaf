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

  await vi.waitFor(() => {
    const region = container?.querySelector('section[aria-live="polite"]');
    expect(region?.textContent).toContain('Saved before the host');
    expect(region?.textContent).toContain('Sent while loading');
  });
});
