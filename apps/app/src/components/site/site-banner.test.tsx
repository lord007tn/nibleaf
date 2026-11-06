// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bannerDismissedScript, SiteBanner } from './site-banner';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('SiteBanner storage recovery', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    window.localStorage.clear();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('does not access storage when no announcement is configured', async () => {
    const denied = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError');
    });
    await act(async () => root.render(<SiteBanner banner={undefined} projectId="docs" />));

    expect(container.textContent).toBe('');
    expect(denied).not.toHaveBeenCalled();
  });

  it('keeps a configured announcement usable and dismissible when storage getters throw', async () => {
    for (const storage of ['localStorage', 'sessionStorage'] as const) {
      vi.spyOn(window, storage, 'get').mockImplementation(() => {
        throw new DOMException('Storage access denied', 'SecurityError');
      });
    }
    await act(async () => root.render(<SiteBanner banner={{ enabled: true, message: 'Service notice' }} lang="en" projectId="docs" />));

    expect(container.textContent).toContain('Service notice');
    await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
    expect(container.textContent).toBe('');
  });

  it('continues honoring a persisted dismissal when storage works', async () => {
    window.localStorage.setItem('nibleaf.banner.docs.Service notice', '1');
    await act(async () => root.render(<SiteBanner banner={{ enabled: true, message: 'Service notice' }} projectId="docs" />));

    expect(container.textContent).toBe('');
  });
});

describe('SiteBanner without a dismissal flash', () => {
  const banner = { enabled: true, message: 'Service </script> notice' };
  const key = 'nibleaf.banner.docs.Service </script> notice';

  afterEach(() => {
    window.localStorage.clear();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('hides an already-dismissed banner before paint, from the server HTML alone', () => {
    window.localStorage.setItem(key, '1');
    const host = document.createElement('div');
    host.innerHTML = renderToString(<SiteBanner banner={banner} projectId="docs" nonce="abc" />);
    document.body.append(host);
    const script = host.querySelector('script');
    expect(script?.getAttribute('nonce')).toBe('abc');
    // The message can never close the inline script early.
    expect(script?.textContent).not.toContain('</script>');
    vi.spyOn(document, 'currentScript', 'get').mockReturnValue(script);
    new Function(script?.textContent ?? '')();
    expect(host.querySelector('[data-theme-region="banner"]')?.hasAttribute('hidden')).toBe(true);
  });

  it('keeps a banner that was never dismissed visible', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToString(<SiteBanner banner={banner} projectId="docs" />);
    document.body.append(host);
    const script = host.querySelector('script');
    vi.spyOn(document, 'currentScript', 'get').mockReturnValue(script);
    new Function(bannerDismissedScript(key))();
    expect(host.querySelector('[data-theme-region="banner"]')?.hasAttribute('hidden')).toBe(false);
  });

  it('hydrates over the pre-hidden banner without errors, then removes it', async () => {
    window.localStorage.setItem(key, '1');
    const host = document.createElement('div');
    host.innerHTML = renderToString(<SiteBanner banner={banner} projectId="docs" />);
    host.querySelector('[data-theme-region="banner"]')?.setAttribute('hidden', '');
    document.body.append(host);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let root: Root | undefined;
    await act(async () => {
      root = hydrateRoot(host, <SiteBanner banner={banner} projectId="docs" />);
    });
    expect(errors).not.toHaveBeenCalled();
    expect(host.querySelector('[data-theme-region="banner"]')).toBeNull();
    await act(async () => root?.unmount());
  });

  it('gives the dismiss control a 44px target', async () => {
    const host = document.createElement('div');
    host.innerHTML = renderToString(<SiteBanner banner={banner} projectId="docs" />);
    expect(host.querySelector('button')?.className).toContain('size-11');
  });
});
