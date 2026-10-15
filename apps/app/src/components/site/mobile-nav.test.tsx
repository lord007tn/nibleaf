// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MobileNav } from './mobile-nav';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const roots: Array<ReturnType<typeof createRoot>> = [];

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

it.each([false, true])('keeps configured reader destinations and the CTA available in the mobile drawer (RTL: %s)', async (isRtl) => {
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
        label={isRtl ? 'التوثيق' : 'Docs'}
        isRtl={isRtl}
        links={[{ label: 'Changelog', href: '#changes', active: false, external: false }]}
        anchors={[{ label: 'Community', href: 'https://community.example.com', active: false, external: true }]}
        cta={{ label: 'Contact us', href: 'https://example.com/contact' }}
      />,
    ),
  );
  const trigger = container.querySelector<HTMLButtonElement>('[data-slot="sheet-trigger"]');
  await act(async () => trigger?.click());
  const drawer = document.querySelector('[data-slot="sheet-content"]');
  expect(drawer?.getAttribute('dir')).toBe(isRtl ? 'rtl' : 'ltr');
  expect(drawer?.getAttribute('data-side')).toBe(isRtl ? 'right' : 'left');
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
});
