// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { MobileNav } from './mobile-nav';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const roots: Array<ReturnType<typeof createRoot>> = [];

// Transform the drawer's code up front so a cold import can't outlast `act`.
beforeAll(async () => {
  await Promise.all([import('./mobile-nav-drawer'), import('./mobile-nav-settings')]);
});

beforeEach(() => {
  Element.prototype.getAnimations = vi.fn(() => []);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
});

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
});

it.each([false, true])(
  'keeps configured reader destinations and the CTA available in the mobile drawer (RTL: %s)',
  async (isRtl) => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () =>
      root.render(
        <MobileNav
          nodes={[]}
          projectId="docs"
          currentPath="start"
          label={isRtl ? 'القائمة' : 'Menu'}
          closeLabel={isRtl ? 'إغلاق' : undefined}
          toggleLabel="Toggle subpages"
          isRtl={isRtl}
          links={[{ label: 'Changelog', href: '#changes', active: false, external: false }]}
          anchors={[{ label: 'Community', href: 'https://community.example.com', active: false, external: true }]}
          cta={{ label: 'Contact us', href: 'https://example.com/contact' }}
        />,
      ),
    );
    // The drawer loads on the first click (or on hover or focus), replaces the
    // static button with its own trigger, and opens.
    await act(async () => container.querySelector<HTMLButtonElement>('[data-slot="sheet-trigger"]')?.click());
    await vi.waitFor(async () => {
      await act(async () => {
        await vi.dynamicImportSettled();
      });
      expect(document.querySelector('[data-slot="sheet-content"]')).not.toBeNull();
    }, 10_000);
    const trigger = container.querySelector<HTMLButtonElement>('[data-slot="sheet-trigger"]');
    let drawer = document.querySelector('[data-slot="sheet-content"]');
    expect(drawer?.getAttribute('dir')).toBe(isRtl ? 'rtl' : 'ltr');
    expect(drawer?.getAttribute('data-side')).toBe(isRtl ? 'right' : 'left');
    const close = drawer?.querySelector<HTMLButtonElement>('[data-slot="sheet-close"]');
    expect(close?.textContent).toBe(isRtl ? 'إغلاق' : 'Close');
    expect(drawer?.hasAttribute('closelabel')).toBe(false);
    await act(async () => close?.click());
    expect(document.querySelector('[data-slot="sheet-content"][data-open]')).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
    await act(async () => trigger?.click());
    drawer = document.querySelector('[data-slot="sheet-content"]');
    // The page tree comes first; links and the call to action follow it (PUB-011).
    const nav = drawer?.querySelector('nav[data-site-nav]');
    const footer = drawer?.querySelector('[data-mobile-nav-footer]');
    expect(nav).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(nav && footer ? nav.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING : 0).toBeTruthy();
    expect(footer?.querySelector('a[data-analytics-cta]')).not.toBeNull();
    const community = drawer?.querySelector<HTMLAnchorElement>('a[href="https://community.example.com"]');
    expect(community?.textContent).toContain('Community');
    expect(community?.target).toBe('_blank');
    expect(community?.rel).toBe('noreferrer');
    const cta = drawer?.querySelector<HTMLAnchorElement>('a[data-analytics-cta]');
    expect(cta?.textContent).toContain('Contact us');
    expect(cta?.href).toBe('https://example.com/contact');
    expect(cta?.dataset.analyticsPlacement).toBe('mobile-navbar');
    await act(async () => cta?.click());
    expect(document.querySelector('[data-slot="sheet-content"][data-open]')).toBeNull();

    await act(async () => trigger?.click());
    const hashLink = document.querySelector<HTMLAnchorElement>('a[href="#changes"]');
    await act(async () => hashLink?.click());
    // Same-page links do not change currentPath, so clicks must close the drawer.
    expect(document.querySelector('[data-slot="sheet-content"][data-open]')).toBeNull();
  },
  20_000,
);

it('offers language and version as labelled drawer settings showing the current value', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const changeLanguage = vi.fn();
  const changeVersion = vi.fn();
  await act(async () =>
    root.render(
      <MobileNav
        nodes={[]}
        projectId="docs"
        currentPath="start"
        label="Menu"
        triggerLabel="Open menu"
        navLabel="Documentation pages"
        toggleLabel="Toggle subpages"
        choices={[
          {
            id: 'language',
            label: 'Language',
            value: 'en',
            options: [
              { value: 'en', label: 'English', lang: 'en', dir: 'ltr' },
              { value: 'ar', label: 'العربية', lang: 'ar', dir: 'rtl' },
            ],
            onChange: changeLanguage,
          },
          { id: 'version', label: 'Version', value: 'main', options: [{ value: 'main', label: 'main' }], onChange: changeVersion },
        ]}
      />,
    ),
  );
  const trigger = container.querySelector<HTMLButtonElement>('[data-slot="sheet-trigger"]');
  expect(trigger?.getAttribute('aria-label')).toBe('Open menu');
  expect(trigger?.className).toContain('size-11');
  await act(async () => trigger?.click());
  // The drawer, then its language and version choices, load on demand.
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  const drawer = document.querySelector('[data-slot="sheet-content"]');
  expect(drawer?.querySelector('nav[data-site-nav]')?.getAttribute('aria-label')).toBe('Documentation pages');

  const settings = drawer?.querySelector('[data-mobile-nav-settings]');
  // A single version is not a choice, so only the language setting renders.
  expect(
    [...(settings?.querySelectorAll('[data-mobile-nav-setting]') ?? [])].map((setting) => setting.getAttribute('data-mobile-nav-setting')),
  ).toEqual(['language']);
  const select = settings?.querySelector<HTMLElement>('[data-slot="select-trigger"]');
  expect(select?.getAttribute('aria-label')).toBe('Language');
  expect(select?.className).toContain('min-h-11');
  expect(select?.textContent).toContain('English');

  await act(async () => select?.click());
  const arabic = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent === 'العربية');
  expect(arabic?.querySelector('[dir="rtl"]')?.getAttribute('lang')).toBe('ar');
  await act(async () => arabic?.click());
  expect(changeLanguage).toHaveBeenCalledWith('ar');
  expect(document.querySelector('[data-slot="sheet-content"][data-open]')).toBeNull();
});
