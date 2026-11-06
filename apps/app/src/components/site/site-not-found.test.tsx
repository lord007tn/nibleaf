// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiteNotFound } from './site-not-found';
import { SiteReaderContext, type SiteReaderContextValue } from './site-reader-context';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function renderNotFound(value: SiteReaderContextValue) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      <SiteReaderContext.Provider value={value}>
        <SiteNotFound />
      </SiteReaderContext.Provider>,
    ),
  );
  return container;
}

describe('SiteNotFound', () => {
  it('speaks the site language and links to the docs home, not the platform', async () => {
    const container = await renderNotFound({ lang: 'ar', homeHref: '/sites/docs/v2?lang=ar' });
    expect(container.querySelector('h1')?.textContent).toBe('لم نعثر على هذه الصفحة');
    const home = container.querySelector<HTMLAnchorElement>('a[href]');
    expect(home?.getAttribute('href')).toBe('/sites/docs/v2?lang=ar');
    expect(home?.textContent).toBe('الذهاب إلى الصفحة الرئيسية للوثائق');
    // No search on this site, so no search button.
    expect(container.querySelector('button')).toBeNull();
  });

  it('opens the reader search from its button', async () => {
    const openSearch = vi.fn();
    const container = await renderNotFound({ lang: 'en', homeHref: '/sites/docs', openSearch });
    const button = container.querySelector('button');
    expect(button?.textContent).toBe('Search the docs');
    expect(button?.className).toContain('min-h-11');
    await act(async () => button?.click());
    expect(openSearch).toHaveBeenCalledOnce();
  });
});
