// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({
  subscribe: vi.fn(),
  navigate: vi.fn(),
  preloadRoute: vi.fn(async (_options: { href: string }) => []),
  state: { matches: [] as Array<{ status: string }> },
}));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => router }));
vi.mock('@/lib/site-paths', () => ({ isCustomDomainSite: () => false }));

import { useSiteLinkNavigation } from './site-link-navigation';
import { claimNavigationFallback, constrainedNetwork, createLinkPreloader, FALLBACK_TTL_MS, PRELOAD_FRESH_MS } from './site-link-prefetch';

describe('createLinkPreloader', () => {
  const setup = (constrained = false) => {
    let time = 1000;
    const loads: string[] = [];
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    const preload = createLinkPreloader({
      preload: async (href) => {
        loads.push(href);
        await pending;
      },
      now: () => time,
      constrained: () => constrained,
    });
    const advance = (ms: number) => {
      time += ms;
    };
    return { preload, loads, release, advance };
  };

  it('preloads a link once while it is fresh, then again once it is stale', async () => {
    const { preload, loads, release, advance } = setup();
    expect(preload('/a', 'hover')).toBe(true);
    expect(preload('/a', 'focus')).toBe(false);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    advance(PRELOAD_FRESH_MS);
    expect(preload('/a', 'hover')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loads).toEqual(['/a', '/a']);
  });

  it('keeps at most two preloads in flight', async () => {
    const { preload, release } = setup();
    expect(preload('/a', 'hover')).toBe(true);
    expect(preload('/b', 'hover')).toBe(true);
    expect(preload('/c', 'hover')).toBe(false);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(preload('/c', 'hover')).toBe(true);
  });

  it('skips hover and idle preloads on a constrained network, but not focus or touch', () => {
    const { preload } = setup(true);
    expect(preload('/a', 'hover')).toBe(false);
    expect(preload('/b', 'idle')).toBe(false);
    expect(preload('/c', 'focus')).toBe(true);
    expect(preload('/d', 'touch')).toBe(true);
  });

  it('reads data saver and 2g-class connections as constrained', () => {
    expect(constrainedNetwork({ saveData: true })).toBe(true);
    expect(constrainedNetwork({ effectiveType: '2g' })).toBe(true);
    expect(constrainedNetwork({ effectiveType: 'slow-2g' })).toBe(true);
    expect(constrainedNetwork({ effectiveType: '4g' })).toBe(false);
    expect(constrainedNetwork(undefined)).toBe(false);
  });
});

describe('claimNavigationFallback', () => {
  beforeEach(() => sessionStorage.clear());

  it('allows one full-page fallback per URL within the TTL, so a failing page never reload-loops', () => {
    expect(claimNavigationFallback('https://docs.test/a', 1000)).toBe(true);
    expect(claimNavigationFallback('https://docs.test/a', 2000)).toBe(false);
    expect(claimNavigationFallback('https://docs.test/b', 2000)).toBe(true);
    expect(claimNavigationFallback('https://docs.test/a', 1000 + FALLBACK_TTL_MS)).toBe(true);
  });

  it('never falls back without session storage to record it', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(claimNavigationFallback('https://docs.test/a', 1000)).toBe(false);
    vi.restoreAllMocks();
  });
});

describe('useSiteLinkNavigation prefetch and fallback', () => {
  let root: Root | undefined;
  let host: HTMLElement;
  const subscribed: Record<string, Array<(event: unknown) => void>> = {};
  const emit = (name: string, event: unknown) => {
    for (const callback of subscribed[name] ?? []) callback(event);
  };

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    for (const key of Object.keys(subscribed)) delete subscribed[key];
    router.subscribe.mockImplementation((name: string, callback: (event: unknown) => void) => {
      subscribed[name] = [...(subscribed[name] ?? []), callback];
      return vi.fn();
    });
    router.preloadRoute.mockClear();
    router.state.matches = [];
    sessionStorage.clear();
    window.history.replaceState(null, '', '/sites/p1/guide');
    document.body.innerHTML =
      '<main><a id="setup" href="/sites/p1/setup">Setup</a><a id="other" href="/sites/p2/x">Other site</a><a id="here" href="/sites/p1/guide#top">Top</a><a id="next" rel="next" href="/sites/p1/next-page">Next</a></main>';
    host = document.createElement('div');
    document.body.append(host);
    function Reader() {
      useSiteLinkNavigation('p1');
      return null;
    }
    root = createRoot(host);
    await act(async () => root?.render(createElement(Reader)));
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const link = (id: string) => document.getElementById(id) as HTMLAnchorElement;
  const preloaded = () => router.preloadRoute.mock.calls.map(([options]) => options.href);

  it('preloads a page link after a short hover, not when the pointer merely crosses it', async () => {
    link('setup').dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    link('setup').dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' }));
    await act(async () => vi.advanceTimersByTime(200));
    expect(preloaded()).not.toContain('/sites/p1/setup');
    link('setup').dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    await act(async () => vi.advanceTimersByTime(100));
    expect(preloaded()).toContain('/sites/p1/setup');
  });

  it('preloads on keyboard focus and on touch, and never other sites or the open page', async () => {
    await act(async () => link('setup').dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    await act(async () => link('next').dispatchEvent(new Event('touchstart', { bubbles: true })));
    await act(async () => link('other').dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    await act(async () => link('here').dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    expect(preloaded()).toEqual(expect.arrayContaining(['/sites/p1/setup', '/sites/p1/next-page']));
    expect(preloaded()).not.toContain('/sites/p2/x');
    expect(preloaded().some((href) => href.startsWith('/sites/p1/guide'))).toBe(false);
  });

  it('reloads a failed client navigation once, and shows the error page if it fails again', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, href: 'http://localhost/sites/p1/setup', assign, pathname: '/sites/p1/setup', search: '' });
    router.state.matches = [{ status: 'error' }];
    const navigation = { fromLocation: { href: '/sites/p1/guide' }, toLocation: { href: '/sites/p1/setup' } };
    emit('onResolved', navigation);
    emit('onResolved', navigation);
    expect(assign).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith('http://localhost/sites/p1/setup');
    // A page that loads (or a not-found) never reloads.
    router.state.matches = [{ status: 'success' }, { status: 'notFound' }];
    emit('onResolved', { fromLocation: { href: '/sites/p1/setup' }, toLocation: { href: '/sites/p1/missing' } });
    expect(assign).toHaveBeenCalledOnce();
  });
});
