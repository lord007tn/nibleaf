// @vitest-environment jsdom

import { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { toast } from 'sonner';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppProviders } from './app-providers';
import { LocalizedProductProviders } from './localized-product-providers';

// The geometry (toasts clear of Save and Discard on phones, desktop unchanged) is
// checked in a real browser: .github/assets/dashboard-mobile-toast-placement.
// jsdom does no layout, so these tests pin the DOM and the rules that geometry rests on.

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

async function hydrate(page: React.ReactNode) {
  container = document.createElement('div');
  container.innerHTML = renderToString(page);
  document.body.append(container);
  const errors: unknown[] = [];
  await act(async () => {
    root = hydrateRoot(container as HTMLDivElement, page, { onRecoverableError: (error) => errors.push(error) });
  });
  return errors;
}

/** Every style rule on the page that reaches for the dashboard scope, with the media query it sits in (Sonner adds its own sheet). */
const dashboardRules = () =>
  [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .flatMap((rule) =>
      rule instanceof CSSMediaRule ? [...rule.cssRules].map((inner) => ({ media: rule.media.mediaText, rule: inner })) : [{ media: null, rule }],
    )
    .filter(({ rule }) => rule instanceof CSSStyleRule && rule.selectorText.includes('data-dashboard-toasts'))
    .map(({ media, rule }) => ({ media, rule: rule as CSSStyleRule }));

it('hydrates the dashboard toast scope from the server render without a mismatch', async () => {
  const errors = await hydrate(
    <AppProviders>
      <p>Dashboard</p>
    </AppProviders>,
  );
  expect(errors).toEqual([]);
  expect(container?.querySelector('[data-dashboard-toasts] > style')).not.toBeNull();
});

it('mounts one toast host, inside the dashboard scope, and leaves toasts in its live region', async () => {
  await hydrate(
    <AppProviders>
      <p>Dashboard</p>
    </AppProviders>,
  );
  await act(async () => {
    toast.error('Could not save');
  });
  await vi.waitFor(() => expect(container?.querySelector('[data-sonner-toast]')).not.toBeNull());
  expect(container?.querySelectorAll('section[aria-live]')).toHaveLength(1);
  const host = container?.querySelector('[data-sonner-toaster]');
  expect(host?.closest('[data-dashboard-toasts]')).not.toBeNull();
  expect(host?.closest('section')?.getAttribute('aria-live')).toBe('polite');
  expect(host?.textContent).toContain('Could not save');
});

it('moves only bottom-anchored toasts, only at Sonner’s phone width, only inside the dashboard scope, and never hides them', async () => {
  await hydrate(
    <AppProviders>
      <p>Dashboard</p>
    </AppProviders>,
  );
  const rules = dashboardRules();
  expect(rules.map(({ media }) => media)).toEqual(['(max-width: 600px)', '(max-width: 600px)']);
  expect(rules.map(({ rule }) => rule.selectorText)).toEqual([
    '[data-dashboard-toasts] [data-sonner-toaster][data-y-position="bottom"]',
    '[data-dashboard-toasts] [data-sonner-toast][data-y-position="bottom"]',
  ]);
  // Position and stacking direction only: nothing that hides a toast or lets taps through it.
  expect(rules.flatMap(({ rule }) => [...rule.style]).sort()).toEqual(['--lift', 'bottom', 'bottom', 'top', 'top']);
  expect(rules[0]?.rule.style.top).toContain('env(safe-area-inset-top');
});

it('leaves nothing behind when the dashboard unmounts', async () => {
  await hydrate(
    <AppProviders>
      <p>Dashboard</p>
    </AppProviders>,
  );
  await act(async () => root?.unmount());
  root = undefined;
  expect(document.querySelector('[data-dashboard-toasts]')).toBeNull();
  expect(dashboardRules()).toEqual([]);
  expect(document.documentElement.getAttribute('style')).toBeNull();
});

it('keeps the auth surfaces’ toast host outside the dashboard scope', async () => {
  // AuthProviders renders LocalizedProductProviders directly, without AppProviders.
  await hydrate(
    <LocalizedProductProviders>
      <p>Sign in</p>
    </LocalizedProductProviders>,
  );
  await act(async () => {
    toast('Code sent');
  });
  await vi.waitFor(() => expect(container?.querySelector('[data-sonner-toaster]')).not.toBeNull());
  expect(container?.querySelector('[data-dashboard-toasts]')).toBeNull();
  expect(dashboardRules()).toEqual([]);
});
