// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({
  subscribe: vi.fn(),
  navigate: vi.fn(),
  preloadRoute: vi.fn(async (_options: { href: string }): Promise<unknown> => []),
  state: { matches: [] as Array<{ status: string; error?: unknown }> },
}));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => router }));
vi.mock('@/lib/site-paths', () => ({ isCustomDomainSite: () => false }));

import { ApiResponseError } from '@/hooks/api/client-helpers';
import { reloadOnceOnChunkLoadFailure } from './chunk-reload';
import { claimDocumentRecovery } from './document-recovery';
import { PageTransportError } from './page-load-error';
import { isPublicReaderSite } from './reader-site-access';
import { useSiteLinkNavigation } from './site-link-navigation';
import { constrainedNetwork, createLinkPreloader, PRELOAD_FRESH_MS, PRELOAD_MEMORY, preloadKey } from './site-link-prefetch';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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
    await flush();
    advance(PRELOAD_FRESH_MS);
    expect(preload('/a', 'hover')).toBe(true);
    await flush();
    expect(loads).toEqual(['/a', '/a']);
  });

  it('treats a fragment or a tracking parameter as the same page, and a language as another', async () => {
    const { preload, release } = setup();
    expect(preload('/a#install', 'hover')).toBe(true);
    release();
    await flush();
    expect(preload('/a', 'hover')).toBe(false);
    expect(preload('/a?utm_source=mail#faq', 'hover')).toBe(false);
    expect(preload('/a?lang=fr', 'hover')).toBe(true);
    expect(preloadKey('/a?ref=x&lang=fr#top')).toBe('/a?lang=fr');
  });

  it('remembers a bounded number of links', async () => {
    const preload = createLinkPreloader({ preload: async () => undefined, constrained: () => false });
    for (let index = 0; index < PRELOAD_MEMORY + 50; index++) {
      expect(preload(`/page-${index}`, 'hover')).toBe(true);
      await flush();
    }
    expect(preload.size()).toBe(PRELOAD_MEMORY);
  });

  it('keeps at most two preloads in flight', async () => {
    const { preload, release } = setup();
    expect(preload('/a', 'hover')).toBe(true);
    expect(preload('/b', 'hover')).toBe(true);
    expect(preload('/c', 'hover')).toBe(false);
    release();
    await flush();
    expect(preload('/c', 'hover')).toBe(true);
  });

  it('forgets a failed preload, so the next intent tries again', async () => {
    let fail = true;
    const preload = createLinkPreloader({ preload: async () => (fail ? Promise.reject(new Error('offline')) : undefined), constrained: () => false });
    expect(preload('/a', 'hover')).toBe(true);
    await flush();
    fail = false;
    expect(preload('/a', 'hover')).toBe(true);
  });

  it('starts nothing once cancelled, until resumed', () => {
    const { preload } = setup();
    preload.cancel();
    expect(preload('/a', 'focus')).toBe(false);
    preload.resume();
    expect(preload('/a', 'focus')).toBe(true);
  });

  it('skips hover, touch and idle preloads on a constrained network, but not keyboard focus', () => {
    const { preload } = setup(true);
    expect(preload('/a', 'hover')).toBe(false);
    expect(preload('/b', 'idle')).toBe(false);
    expect(preload('/d', 'touch')).toBe(false);
    expect(preload('/c', 'focus')).toBe(true);
  });

  it('reads data saver and 2g-class connections as constrained', () => {
    expect(constrainedNetwork({ saveData: true })).toBe(true);
    expect(constrainedNetwork({ effectiveType: '2g' })).toBe(true);
    expect(constrainedNetwork({ effectiveType: 'slow-2g' })).toBe(true);
    expect(constrainedNetwork({ effectiveType: '4g' })).toBe(false);
    expect(constrainedNetwork(undefined)).toBe(false);
  });
});

describe('useSiteLinkNavigation prefetch and fallback', () => {
  let root: Root | undefined;
  const subscribed: Record<string, Array<(event: unknown) => void>> = {};
  const emit = (name: string, event: unknown) => {
    for (const callback of subscribed[name] ?? []) callback(event);
  };

  const render = async (publicSite: boolean) => {
    const host = document.createElement('div');
    document.body.append(host);
    function Reader() {
      useSiteLinkNavigation('p1', { publicSite });
      return null;
    }
    root = createRoot(host);
    await act(async () => root?.render(createElement(Reader)));
  };

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    for (const key of Object.keys(subscribed)) delete subscribed[key];
    router.subscribe.mockImplementation((name: string, callback: (event: unknown) => void) => {
      subscribed[name] = [...(subscribed[name] ?? []), callback];
      return () => {
        subscribed[name] = (subscribed[name] ?? []).filter((listener) => listener !== callback);
      };
    });
    router.preloadRoute.mockReset();
    router.preloadRoute.mockImplementation(async () => []);
    router.state.matches = [];
    sessionStorage.clear();
    window.history.replaceState(null, '', '/sites/p1/guide');
    document.body.innerHTML =
      '<main><a id="setup" href="/sites/p1/setup">Setup</a><a id="other" href="/sites/p2/x">Other site</a><a id="here" href="/sites/p1/guide#top">Top</a><a id="next" rel="next" href="/sites/p1/next-page">Next</a></main>';
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const link = (id: string) => document.getElementById(id) as HTMLAnchorElement;
  const preloaded = () => router.preloadRoute.mock.calls.map(([options]) => options.href);
  const hover = (id: string, type: 'pointerover' | 'pointerout' = 'pointerover') =>
    link(id).dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'mouse' }));
  const touchEvent = (id: string, type: string, point?: { x: number; y: number }) => {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, 'touches', { value: point ? [{ clientX: point.x, clientY: point.y }] : [] });
    link(id).dispatchEvent(event);
  };

  it('preloads a page link after a short hover, not when the pointer merely crosses it', async () => {
    await render(true);
    hover('setup');
    hover('setup', 'pointerout');
    await act(async () => vi.advanceTimersByTime(200));
    expect(preloaded()).not.toContain('/sites/p1/setup');
    hover('setup');
    await act(async () => vi.advanceTimersByTime(100));
    expect(preloaded()).toContain('/sites/p1/setup');
  });

  it('preloads on keyboard focus and never other sites or the open page', async () => {
    await render(true);
    await act(async () => link('setup').dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    await act(async () => link('other').dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    await act(async () => link('here').dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    expect(preloaded()).toContain('/sites/p1/setup');
    expect(preloaded()).not.toContain('/sites/p2/x');
    expect(preloaded().some((href) => href.startsWith('/sites/p1/guide'))).toBe(false);
  });

  it('preloads on a tap, but not on a touch that scrolls across the link', async () => {
    await render(true);
    touchEvent('setup', 'touchstart', { x: 10, y: 10 });
    touchEvent('setup', 'touchmove', { x: 10, y: 40 });
    touchEvent('setup', 'touchend');
    expect(preloaded()).toEqual([]);
    touchEvent('setup', 'touchstart', { x: 10, y: 10 });
    expect(preloaded()).toEqual([]);
    touchEvent('setup', 'touchmove', { x: 14, y: 13 });
    touchEvent('setup', 'touchend');
    expect(preloaded()).toEqual(['/sites/p1/setup']);
  });

  it('preloads the next page once idle, and cancels pending intent when a navigation starts', async () => {
    await render(true);
    await act(async () => vi.advanceTimersByTime(2000));
    expect(preloaded()).toEqual(['/sites/p1/next-page']);
    hover('setup');
    emit('onBeforeNavigate', { fromLocation: { href: '/sites/p1/guide' }, toLocation: { href: '/sites/p1/other' } });
    await act(async () => vi.advanceTimersByTime(200));
    await act(async () => link('setup').dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    expect(preloaded()).toEqual(['/sites/p1/next-page']);
  });

  it('never prefetches a private site, or a site whose access is unknown', async () => {
    await render(false);
    expect(isPublicReaderSite('p1')).toBe(false);
    hover('setup');
    await act(async () => vi.advanceTimersByTime(2500));
    await act(async () => link('setup').dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    touchEvent('setup', 'touchstart', { x: 1, y: 1 });
    touchEvent('setup', 'touchend');
    expect(router.preloadRoute).not.toHaveBeenCalled();
  });

  it('never reloads the page being read when an idle preload fails to load a chunk', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, href: 'http://localhost/sites/p1/guide', pathname: '/sites/p1/guide', search: '', reload });
    reloadOnceOnChunkLoadFailure();
    router.preloadRoute.mockImplementation(async () => {
      const failure = Object.assign(new Event('vite:preloadError', { cancelable: true }), {
        payload: new TypeError('Failed to fetch dynamically imported module: /assets/next-OLD.js'),
      });
      window.dispatchEvent(failure);
      if (!failure.defaultPrevented) throw failure.payload;
      return [];
    });
    await render(true);
    await act(async () => vi.advanceTimersByTime(2000));
    expect(router.preloadRoute).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });

  describe('when a navigation fails to load its page', () => {
    const navigation = { fromLocation: { href: '/sites/p1/guide' }, toLocation: { href: '/sites/p1/setup' } };
    let assign: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      assign = vi.fn();
      // A new object per test: each test is a new document for the recovery guard.
      vi.stubGlobal('location', { ...window.location, href: 'http://localhost/sites/p1/setup', assign, pathname: '/sites/p1/setup', search: '' });
    });

    const fail = async (error: unknown) => {
      router.state.matches = [{ status: 'success' }, { status: 'error', error }];
      emit('onBeforeNavigate', navigation);
      emit('onResolved', navigation);
      await act(async () => vi.advanceTimersByTime(0));
    };

    it('loads the page as a document once after a dropped request, and keeps the error page if that fails too', async () => {
      await render(false);
      await fail(new PageTransportError(0));
      await fail(new PageTransportError(0));
      expect(assign).toHaveBeenCalledOnce();
      expect(assign).toHaveBeenCalledWith('http://localhost/sites/p1/setup');
    });

    it('recovers from a gateway 502, 503 or 504', async () => {
      await render(true);
      await fail(new PageTransportError(502));
      expect(assign).toHaveBeenCalledOnce();
    });

    it('never retries a refusal or a server error', async () => {
      await render(true);
      for (const status of [400, 401, 403, 404, 429, 500]) await fail(new ApiResponseError('no', status));
      await fail(new Error('render failed'));
      router.state.matches = [{ status: 'success' }, { status: 'notFound' }];
      emit('onResolved', navigation);
      await act(async () => vi.advanceTimersByTime(0));
      expect(assign).not.toHaveBeenCalled();
    });

    it('waits out a short Retry-After, and not a long one', async () => {
      await render(true);
      await fail(new PageTransportError(503, '60'));
      await act(async () => vi.advanceTimersByTime(61_000));
      expect(assign).not.toHaveBeenCalled();
      await fail(new PageTransportError(503, '3'));
      await act(async () => vi.advanceTimersByTime(2900));
      expect(assign).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTime(100));
      expect(assign).toHaveBeenCalledOnce();
    });

    it('shares one recovery with a chunk reload in the same document', async () => {
      await render(true);
      expect(claimDocumentRecovery('chunk:/assets/setup-OLD.js')).toBe(true);
      await fail(new PageTransportError(503));
      expect(assign).not.toHaveBeenCalled();
    });
  });
});
