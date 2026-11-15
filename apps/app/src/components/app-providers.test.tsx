// @vitest-environment jsdom

import { cookieName } from '@nibleaf/i18n/runtime';
import { act, type ReactNode } from 'react';
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
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom fixture cleanup; no browser account cookies are accessed.
  document.cookie = `${cookieName}=; Max-Age=0; path=/`;
  for (const name of ['lang', 'dir', 'data-locale']) document.documentElement.removeAttribute(name);
  vi.unstubAllGlobals();
});

async function hydrate(page: ReactNode) {
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
const dashboardRules = () => {
  const found: { media: string | null; rule: CSSStyleRule }[] = [];
  const visit = (rules: CSSRuleList, media: string | null) => {
    for (const rule of rules) {
      if (rule instanceof CSSMediaRule) visit(rule.cssRules, rule.media.mediaText);
      else if (rule instanceof CSSStyleRule && rule.selectorText.includes('data-dashboard-toasts')) found.push({ media, rule });
    }
  };
  for (const sheet of document.styleSheets) visit(sheet.cssRules, null);
  return found;
};

/** Renders the dashboard in `locale` the way src/server.ts serves it, raises a real error toast, and returns Sonner's own host and toast. */
async function renderDashboardToast(locale: 'en' | 'ar') {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  // biome-ignore lint/suspicious/noDocumentCookie: exercise the real Paraglide cookie resolver in isolated jsdom.
  document.cookie = `${cookieName}=${locale}; path=/`;
  document.documentElement.setAttribute('lang', locale);
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('data-locale', locale);
  await hydrate(
    <AppProviders>
      <p>Dashboard</p>
    </AppProviders>,
  );
  await act(async () => {
    toast.error('Could not save');
  });
  await vi.waitFor(() => expect(container?.querySelector('[data-sonner-toast]')).not.toBeNull());
  const scope = container?.querySelector('[data-dashboard-toasts]');
  const host = scope?.querySelector<HTMLElement>('[data-sonner-toaster]');
  const item = host?.querySelector<HTMLElement>('[data-sonner-toast]');
  if (!scope || !host || !item) throw new Error(`Sonner's host or toast is not inside the dashboard scope: ${container?.innerHTML}`);
  return { dir, host, item };
}

const compact = (text: string) => text.replaceAll(' ', '');

/**
 * What Sonner's own stylesheet declares for `element` only because it is
 * top-anchored, at top level or inside `media`. Read from a shallow copy of the
 * rendered element with only `data-y-position` changed, so a renamed attribute
 * or value in a Sonner upgrade shows up here as an empty result.
 */
function sonnerTopOnly(element: Element, media: string | null) {
  const asTop = element.cloneNode(false) as Element;
  asTop.setAttribute('data-y-position', 'top');
  const asIs = element.cloneNode(false) as Element;
  const declared: Record<string, string> = {};
  const visit = (rules: CSSRuleList, within: string | null) => {
    for (const rule of rules) {
      if (rule instanceof CSSMediaRule) visit(rule.cssRules, rule.media.mediaText);
      else if (
        rule instanceof CSSStyleRule &&
        !rule.selectorText.includes('data-dashboard-toasts') &&
        (within === null ? media === null : media !== null && compact(within) === compact(media)) &&
        asTop.matches(rule.selectorText) &&
        !asIs.matches(rule.selectorText)
      )
        for (const property of rule.style) declared[property] = rule.style.getPropertyValue(property).trim();
    }
  };
  for (const sheet of document.styleSheets) visit(sheet.cssRules, null);
  return declared;
}

/** The media query of Sonner's full-width phone layout: the media rule in its sheet that gives a top host a different `top`. */
function sonnerPhoneMedia(host: Element) {
  const asTop = host.cloneNode(false) as Element;
  asTop.setAttribute('data-y-position', 'top');
  for (const sheet of document.styleSheets)
    for (const rule of sheet.cssRules)
      if (
        rule instanceof CSSMediaRule &&
        [...rule.cssRules].some(
          (inner) =>
            inner instanceof CSSStyleRule &&
            !inner.selectorText.includes('data-dashboard-toasts') &&
            asTop.matches(inner.selectorText) &&
            inner.style.getPropertyValue('top') !== '',
        )
      )
        return rule.media.mediaText;
  return null;
}

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

it('moves only bottom-anchored toasts, only on phones, only inside the dashboard scope, and never hides them', async () => {
  await hydrate(
    <AppProviders>
      <p>Dashboard</p>
    </AppProviders>,
  );
  const phones = '(max-width: 600px), (pointer: coarse) and (max-height: 500px)';
  const toaster = '[data-dashboard-toasts] [data-sonner-toaster][data-y-position="bottom"]';
  const rules = dashboardRules();
  expect(rules.map(({ media, rule }) => [media, rule.selectorText])).toEqual([
    [phones, toaster],
    [phones, '[data-dashboard-toasts] [data-sonner-toast][data-y-position="bottom"]'],
    // In Sonner's full-width phone layout, its phone offset.
    ['(max-width: 600px)', toaster],
  ]);
  // Position and stacking direction only: nothing that hides a toast or lets taps through it.
  expect(rules.flatMap(({ rule }) => [...rule.style]).sort()).toEqual(['--lift', 'bottom', 'bottom', 'top', 'top', 'top']);
  expect(rules[0]?.rule.style.top).toBe('calc(var(--offset-top) + env(safe-area-inset-top, 0px))');
  expect(rules[2]?.rule.style.top).toBe('calc(var(--mobile-offset-top) + env(safe-area-inset-top, 0px))');
});

// The tests below read Sonner's rendered DOM and its own stylesheet instead of
// restating them, so a Sonner upgrade that renames an attribute, a position
// value or an offset variable fails here, with what Sonner renders now.

it.each([
  ['en', 'right'],
  ['ar', 'left'],
] as const)('renders one real Sonner host and toast in the dashboard scope, still bottom-anchored, on the %s side', async (locale, side) => {
  const { dir, host, item } = await renderDashboardToast(locale);
  // #715 moves toasts on phones with CSS only. Sonner keeps reporting its bottom anchor, which is what those rules select on.
  expect({ host: [host.dataset.yPosition, host.dataset.xPosition], toast: [item.dataset.yPosition, item.dataset.xPosition] }).toEqual({
    host: ['bottom', side],
    toast: ['bottom', side],
  });
  expect(host.getAttribute('dir')).toBe(dir);
  expect(document.querySelectorAll('[data-sonner-toaster]')).toHaveLength(1);
});

it.each(['en', 'ar'] as const)('selects the rendered host and toast and reads offsets the host supplies (%s)', async (locale) => {
  const { host, item } = await renderDashboardToast(locale);
  const rules = dashboardRules();
  const selects = (element: Element) => rules.filter(({ rule }) => element.matches(rule.selectorText)).length;
  expect(
    rules.filter(({ rule }) => !host.matches(rule.selectorText) && !item.matches(rule.selectorText)).map(({ rule }) => rule.selectorText),
    `phone rules that select neither of Sonner's rendered elements: host ${host.cloneNode(false).outerHTML}`,
  ).toEqual([]);
  expect([selects(host), selects(item)].map(Boolean)).toEqual([true, true]);

  const consumed = [
    ...new Set(
      rules.flatMap(({ rule }) =>
        [...rule.style].flatMap((property) => [...rule.style.getPropertyValue(property).matchAll(/var\((--[\w-]+)/g)].map((match) => match[1])),
      ),
    ),
  ].sort();
  expect(consumed).toEqual(['--mobile-offset-top', '--offset-top']);
  for (const name of consumed)
    expect(host.style.getPropertyValue(name ?? '').trim(), `${name} on Sonner's host: style="${host.getAttribute('style')}"`).toMatch(
      /^(\d+(\.\d+)?(px|r?em)|calc\(.+\))$/,
    );
});

it('anchors the host and toast the way Sonner’s own top position does, at Sonner’s phone breakpoint', async () => {
  const { host, item } = await renderDashboardToast('en');
  const phoneMedia = sonnerPhoneMedia(host);
  if (!phoneMedia) throw new Error('No media rule in Sonner’s sheet re-anchors a top host: its phone layout changed');
  const rules = dashboardRules();
  for (const { media, rule } of rules) {
    expect(media?.split(',').map(compact), `${rule.selectorText} applies at Sonner's phone layout`).toContain(compact(phoneMedia));
    const element = host.matches(rule.selectorText) ? host : item;
    // Inside Sonner's own phone media query, its phone rules win over its top-level ones.
    const sonner = {
      ...sonnerTopOnly(element, null),
      ...(compact(media ?? '') === compact(phoneMedia) ? sonnerTopOnly(element, phoneMedia) : {}),
    };
    for (const property of rule.style) {
      const ours = rule.style.getPropertyValue(property).trim();
      // Releases Sonner's bottom anchor.
      if (property === 'bottom') expect(ours).toBe('auto');
      else {
        // Sonner's value as is, or its offset variable with the safe-area inset added.
        const theirs = sonner[property];
        const mirrors = ours === theirs || (theirs?.startsWith('var(') && ours.includes(theirs));
        expect(mirrors, `${property}: ${ours} in ${rule.selectorText}; Sonner's top position: ${JSON.stringify(sonner)}`).toBe(true);
      }
    }
  }
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
