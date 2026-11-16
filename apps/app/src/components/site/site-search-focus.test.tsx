// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

// Where keyboard focus lands after search opens a page: the real dialog and the
// real reader navigation hook, with a router that emits what the real one does
// (onBeforeNavigate while the dialog still has focus, then the new page renders).
const router = vi.hoisted(() => {
  type Location = { href: string; pathname: string; searchStr: string; hash: string };
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const toLocation = (href: string): Location => {
    const url = new URL(href, 'http://app.test');
    return { href: `${url.pathname}${url.search}${url.hash}`, pathname: url.pathname, searchStr: url.search, hash: url.hash.slice(1) };
  };
  const emit = (name: string, event: unknown) => {
    for (const listener of listeners.get(name) ?? []) listener(event);
  };
  const state = {
    location: toLocation('/sites/docs/start'),
    pages: {} as Record<string, string>,
    reset: (href: string) => {
      state.location = toLocation(href);
    },
    toLocation,
    subscribe: (name: string, listener: (event: unknown) => void) => {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return () => set.delete(listener);
    },
    navigate: vi.fn(async ({ href }: { href: string }) => {
      const fromLocation = state.location;
      const next = toLocation(href);
      emit('onBeforeNavigate', { fromLocation, toLocation: next });
      state.location = next;
      // The loader runs; the destination renders after the dialog has started closing.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const page = document.getElementById('page');
      if (page && next.pathname !== fromLocation.pathname) page.innerHTML = state.pages[next.pathname.replace(/\/ar(?=\/|$)/, '')] ?? '';
      emit('onResolved', { fromLocation, toLocation: next });
      emit('onRendered', { fromLocation, toLocation: next });
    }),
    preloadRoute: vi.fn(async () => []),
    state: { matches: [] as Array<{ status: string }> },
  };
  return state;
});
const results = vi.hoisted(() => ({ data: [] as unknown[] }));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => router }));
vi.mock('@/hooks/api/site-search', () => ({ useSiteSearch: () => ({ data: results.data, isFetching: false, error: null }) }));
vi.mock('@/providers/site-analytics-provider', () => ({ useSiteAnalytics: () => ({ track: vi.fn() }) }));
vi.mock('@tanstack/react-pacer', () => ({ useDebouncedValue: (value: string) => [value] }));

import { useSiteLinkNavigation } from '@/lib/site-link-navigation';
import { openSiteSearch, SiteSearch } from './site-search';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const page = { id: 'setup', path: 'setup', title: 'Setup guide', description: '', snippet: 'Configure the project.', language: 'en', icon: null };
const section = { ...page, id: 'billing', path: 'billing', title: 'Billing', section: { id: 'refunds', title: 'Refunds' }, snippet: 'We refund it.' };

beforeAll(async () => {
  await import('./site-search-dialog');
});

let root: ReturnType<typeof createRoot> | undefined;
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
  router.pages = {
    '/sites/docs/start': '<h1>Start</h1>',
    '/sites/docs/setup': '<h1>Setup guide</h1><p>Steps</p>',
    '/sites/docs/billing': '<h1>Billing</h1><p>Plans</p><h2 id="refunds">Refunds</h2>',
  };
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
  vi.clearAllMocks();
});

function Reader({ lang }: { lang: string }) {
  const [open, setOpen] = useState(false);
  const announcement = useSiteLinkNavigation('docs');
  return (
    <>
      <button type="button" data-trigger="" onClick={() => openSiteSearch(() => setOpen(true))}>
        Search
      </button>
      <main id="site-content" tabIndex={-1}>
        <div id="page" />
      </main>
      <output>{announcement}</output>
      <SiteSearch projectId="docs" open={open} onOpenChange={setOpen} lang={lang} defaultLanguage="en" direction={lang === 'ar' ? 'rtl' : 'ltr'} />
    </>
  );
}

/** Mounts the reader on `href` and opens search from its trigger, like a keyboard reader would. */
async function openSearchOn(href: string, lang = 'en') {
  window.history.replaceState(null, '', href);
  router.reset(href);
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<Reader lang={lang} />));
  const content = document.getElementById('page');
  if (content) content.innerHTML = router.pages[router.location.pathname] ?? '';
  const trigger = document.querySelector<HTMLButtonElement>('[data-trigger]');
  if (!trigger) throw new Error('Missing trigger');
  await act(async () => trigger.focus());
  await act(async () => trigger.click());
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  return trigger;
}

const field = () => document.querySelector<HTMLInputElement>('[data-slot="command-input"]');
const type = (value: string) =>
  act(async () => {
    const input = field();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
const press = (key: string) =>
  act(async () => {
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
/** Lets the navigation, the dialog's close and the focus frame run. */
const settle = () =>
  act(async () => {
    for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  });

it.each(['en', 'ar'])('lands focus on the opened page’s h1 after Enter on a result (%s)', async (lang) => {
  results.data = [{ ...page, language: lang }];
  const trigger = await openSearchOn(lang === 'ar' ? '/sites/docs/start?lang=ar' : '/sites/docs/start', lang);
  expect(document.activeElement).toBe(field());
  await type('setup');
  await press('Enter');
  await settle();
  expect(router.navigate).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  const heading = document.querySelector('main h1');
  expect(heading?.textContent).toBe('Setup guide');
  expect(router.location.pathname).toBe(lang === 'ar' ? '/sites/docs/ar/setup' : '/sites/docs/setup');
  expect(document.activeElement).toBe(heading);
  expect(document.activeElement).not.toBe(trigger);
  // Focus by script only: the heading drops its temporary tabindex once left.
  (document.activeElement as HTMLElement).blur();
  expect(heading?.hasAttribute('tabindex')).toBe(false);
});

it('lands focus on the section heading for a #section result on another page', async () => {
  results.data = [section];
  await openSearchOn('/sites/docs/start');
  await type('refund');
  // ↓ from the best page onto its section row.
  await press('ArrowDown');
  await press('Enter');
  await settle();
  expect(router.navigate).toHaveBeenCalledExactlyOnceWith({ href: '/sites/docs/billing#refunds' });
  expect(document.activeElement).toBe(document.getElementById('refunds'));
});

it('follows the heading when the article re-renders it just after arriving', async () => {
  results.data = [section];
  await openSearchOn('/sites/docs/start');
  await type('refund');
  await press('ArrowDown');
  await press('Enter');
  await settle();
  const first = document.getElementById('refunds');
  expect(document.activeElement).toBe(first);
  // The article body renders again, with new heading elements.
  await act(async () => {
    const page = document.getElementById('page');
    if (page) page.innerHTML = router.pages['/sites/docs/billing'] ?? '';
  });
  await settle();
  const second = document.getElementById('refunds');
  expect(second).not.toBe(first);
  expect(document.activeElement).toBe(second);
  // Once the reader moves on, a later re-render leaves focus alone.
  const elsewhere = document.querySelector<HTMLButtonElement>('[data-trigger]');
  await act(async () => elsewhere?.focus());
  await act(async () => {
    const page = document.getElementById('page');
    if (page) page.innerHTML = router.pages['/sites/docs/billing'] ?? '';
  });
  await settle();
  expect(document.activeElement).toBe(elsewhere);
});

it('lands focus on the section heading for a #section result on the page already open', async () => {
  results.data = [section];
  await openSearchOn('/sites/docs/billing');
  await type('refund');
  await press('ArrowDown');
  await press('Enter');
  await settle();
  expect(router.navigate).toHaveBeenCalledExactlyOnceWith({ href: '/sites/docs/billing#refunds' });
  expect(document.activeElement).toBe(document.getElementById('refunds'));
});

it('returns focus to the search trigger when search closes without opening a page', async () => {
  results.data = [page];
  const trigger = await openSearchOn('/sites/docs/start');
  await type('setup');
  await press('Escape');
  await settle();
  expect(router.navigate).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  // Opening a page once doesn't stop a later Esc from returning focus.
  await act(async () => trigger.click());
  await settle();
  await type('setup');
  await press('Enter');
  await settle();
  expect(document.activeElement).toBe(document.querySelector('main h1'));
  await act(async () => trigger.focus());
  await act(async () => trigger.click());
  await settle();
  expect(document.activeElement).toBe(field());
  await press('Escape');
  await settle();
  expect(document.activeElement).toBe(trigger);
});
