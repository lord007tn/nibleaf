// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteBanner } from './site-banner';

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
