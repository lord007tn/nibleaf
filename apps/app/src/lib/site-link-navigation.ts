import { useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { claimDocumentRecovery, setNavigationPending } from '@/lib/document-recovery';
import { navigationRecoveryDelay } from '@/lib/page-load-error';
import { setReaderSiteAccess } from '@/lib/reader-site-access';
import { isAppOwnedPath, isDocumentPath } from '@/lib/request-negotiation';
import { createLinkPreloader, HOVER_DWELL_MS, TAP_SLOP_PX } from '@/lib/site-link-prefetch';
import { isCustomDomainSite } from '@/lib/site-paths';

type ReaderLocation = Pick<Location, 'href' | 'origin' | 'pathname' | 'search'>;

/** How long a navigation recovery for one URL blocks another for it. */
const NAVIGATION_RECOVERY_TTL_MS = 60_000;

/**
 * The router href for a click on a link to another page of this published
 * site, or null when the browser should handle the click itself: modified or
 * non-primary clicks, plus everything `siteLinkTarget` leaves to the browser.
 */
export function siteNavigationHref(event: MouseEvent, projectId: string, location: ReaderLocation): string | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  return siteLinkTarget(event.target instanceof Element ? event.target : null, projectId, location);
}

/**
 * The router href of the link at `element` when it leads to another page of
 * this published site, or null when it doesn't: `target`/`download` links,
 * other origins, non-document paths (files such as `.md` or `sitemap.xml`,
 * exactly as the server classifies them; page slugs never contain a dot), and
 * in-page `#fragment` jumps. Clicks and prefetches share it, so a prefetched
 * link is always one a click would route.
 */
function siteLinkTarget(element: Element | null, projectId: string, location: ReaderLocation): string | null {
  const anchor = element?.closest('a[href]') ?? null;
  if (!(anchor instanceof HTMLAnchorElement) || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return null;

  let url: URL;
  try {
    url = new URL(anchor.href, location.href);
  } catch {
    return null;
  }
  if (url.origin !== location.origin || !isDocumentPath(url.pathname)) return null;
  if (url.hash && url.pathname === location.pathname && url.search === location.search) return null;

  const sitePrefix = `/sites/${projectId}`;
  const inSite = isCustomDomainSite(projectId)
    ? !isAppOwnedPath(url.pathname)
    : url.pathname === sitePrefix || url.pathname.startsWith(`${sitePrefix}/`);
  return inSite ? `${url.pathname}${url.search}${url.hash}` : null;
}

/** Route clicks on links between pages of a published site through the client
 * router instead of a full document load. Links stay plain `<a href>` so they
 * work without JavaScript and in server-rendered HTML.
 *
 * `publicSite` (a public site with no reader session) also enables prefetching
 * and the 30 s page cache; anything else fails closed (lib/reader-site-access.ts). */
export function useSiteLinkNavigation(projectId: string, { publicSite = false }: { publicSite?: boolean } = {}): string {
  const router = useRouter();
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    let frame = 0;
    let focusOwner: Element | null = null;
    let dialogOwnedFocus = false;
    let focusDialog: Element | null = null;
    let announcementObserver: MutationObserver | undefined;
    let restoreTabIndex: (() => void) | undefined;
    const beforeNavigate = router.subscribe('onBeforeNavigate', ({ fromLocation, toLocation }) => {
      if (fromLocation?.href === toLocation.href) return;
      cancelAnimationFrame(frame);
      restoreTabIndex?.();
      announcementObserver?.disconnect();
      setAnnouncement('');
      focusOwner = document.activeElement;
      focusDialog = focusOwner?.closest('[role="dialog"], [role="alertdialog"], dialog') ?? null;
      dialogOwnedFocus = !!focusDialog;
    });
    const rendered = router.subscribe('onRendered', ({ fromLocation, toLocation }) => {
      if (!fromLocation || (fromLocation.pathname === toLocation.pathname && fromLocation.searchStr === toLocation.searchStr)) return;
      frame = requestAnimationFrame(() => {
        const main = document.querySelector<HTMLElement>('main');
        const heading = main?.querySelector<HTMLElement>('h1');
        // Closing a dialog restores its trigger; the live region announces the destination.
        if (dialogOwnedFocus) {
          const title = heading?.textContent || document.title;
          const announce = () => {
            if (focusDialog?.isConnected) return;
            announcementObserver?.disconnect();
            frame = requestAnimationFrame(() => setAnnouncement(title));
          };
          announcementObserver = new MutationObserver(announce);
          announcementObserver.observe(document.body, { childList: true, subtree: true });
          announce();
          return;
        }
        const active = document.activeElement;
        if (active !== document.body && active !== focusOwner && active?.isConnected) {
          setAnnouncement(heading?.textContent || document.title);
          return;
        }
        let target = heading ?? main;
        if (toLocation.hash) {
          try {
            target = document.getElementById(decodeURIComponent(toLocation.hash)) ?? target;
          } catch {
            // Malformed fragments still announce the destination page.
          }
        }
        if (!target) return;
        if (!target.hasAttribute('tabindex')) {
          target.tabIndex = -1;
          const temporaryTarget = target;
          const restore = () => {
            temporaryTarget.removeAttribute('tabindex');
            temporaryTarget.removeEventListener('blur', restore);
          };
          restoreTabIndex = restore;
          target.addEventListener('blur', restore, { once: true });
        }
        target.focus({ preventScroll: true });
      });
    });
    const onClick = (event: MouseEvent) => {
      const href = siteNavigationHref(event, projectId, window.location);
      if (!href) return;
      event.preventDefault();
      void router.navigate({ href });
    };
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('click', onClick);
      beforeNavigate();
      rendered();
      cancelAnimationFrame(frame);
      restoreTabIndex?.();
      announcementObserver?.disconnect();
    };
  }, [router, projectId]);

  // Which loads are the reader's own (lib/document-recovery.ts), and a
  // server-rendered fallback when a client navigation couldn't load its page.
  useEffect(() => {
    let recovery = 0;
    const beforeNavigate = router.subscribe('onBeforeNavigate', ({ fromLocation, toLocation }) => {
      if (fromLocation?.href === toLocation.href) return;
      window.clearTimeout(recovery);
      setNavigationPending(true);
    });
    // Only a transport failure (the network, or a gateway's bare 502/503/504)
    // loads the destination as a document, after any short Retry-After: the
    // server-rendered page may get through where the data request didn't. A
    // refusal (any 4xx), a 500 or a chunk failure (lib/chunk-reload.ts owns
    // those) keeps the error page. The recovery budget is shared with
    // chunk-reload, so one failure never recovers twice and nothing loops.
    const resolved = router.subscribe('onResolved', ({ fromLocation, toLocation }) => {
      setNavigationPending(false);
      if (!fromLocation || fromLocation.href === toLocation.href) return;
      const failed = router.state.matches.find((match) => match.status === 'error');
      if (!failed) return;
      const delay = navigationRecoveryDelay(failed.error);
      if (delay === null) return;
      const href = window.location.href;
      recovery = window.setTimeout(() => {
        if (window.location.href !== href) return;
        if (claimDocumentRecovery(`nav:${href}`, { ttlMs: NAVIGATION_RECOVERY_TTL_MS })) window.location.assign(href);
      }, delay);
    });
    return () => {
      beforeNavigate();
      resolved();
      window.clearTimeout(recovery);
      setNavigationPending(false);
    };
  }, [router]);

  // Prefetch on intent, and the pager's next page when idle: public sites only.
  useEffect(() => {
    setReaderSiteAccess(projectId, publicSite);
    if (!publicSite) return;
    // preloadRoute resolves `href` exactly like navigate does (both build the
    // location from it, custom-domain rewrite included); its type just doesn't say so.
    const preload = createLinkPreloader({ preload: (href) => router.preloadRoute({ href } as Parameters<typeof router.navigate>[0]) });
    const targetOf = (element: EventTarget | null) => {
      const href = siteLinkTarget(element instanceof Element ? element : null, projectId, window.location);
      // The page already open needs nothing.
      if (!href || href.split('#')[0] === `${window.location.pathname}${window.location.search}`) return null;
      return href;
    };
    let dwell = 0;
    const onPointerOver = (event: PointerEvent) => {
      // Touch has its own signal: a tap (touchend without movement).
      if (event.pointerType === 'touch') return;
      window.clearTimeout(dwell);
      const href = targetOf(event.target);
      if (href) dwell = window.setTimeout(() => preload(href, 'hover'), HOVER_DWELL_MS);
    };
    const onPointerOut = (event: PointerEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(event.relatedTarget instanceof Node && anchor?.contains(event.relatedTarget))) window.clearTimeout(dwell);
    };
    const onFocusIn = (event: FocusEvent) => {
      const href = targetOf(event.target);
      if (href) preload(href, 'focus');
    };
    // A finger that lands on a link and lifts without scrolling is a tap: the
    // click follows, and preloading now gets the request out first. A touch
    // that moves is a scroll across the links, which is not intent.
    let touch: { x: number; y: number; href: string } | null = null;
    const onTouchStart = (event: TouchEvent) => {
      const point = event.touches[0];
      const href = event.touches.length === 1 && point ? targetOf(event.target) : null;
      touch = href && point ? { x: point.clientX, y: point.clientY, href } : null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const point = event.touches[0];
      if (touch && (!point || Math.hypot(point.clientX - touch.x, point.clientY - touch.y) > TAP_SLOP_PX)) touch = null;
    };
    const onTouchEnd = () => {
      if (touch) preload(touch.href, 'touch');
      touch = null;
    };
    const onTouchCancel = () => {
      touch = null;
    };
    document.addEventListener('pointerover', onPointerOver, { passive: true });
    document.addEventListener('pointerout', onPointerOut, { passive: true });
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('touchcancel', onTouchCancel, { passive: true });

    // Sequential reading: once the browser is idle after a page shows, load the
    // pager's next page, and only that one.
    let idle = 0;
    let idleTimer = 0;
    const preloadNextPage = () => {
      const run = () => {
        const href = targetOf(document.querySelector('main a[rel~="next"]'));
        if (href) preload(href, 'idle');
      };
      if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(run, { timeout: 4000 });
      else idleTimer = window.setTimeout(run, 2000);
    };
    const cancelNextPage = () => {
      if (idle) window.cancelIdleCallback?.(idle);
      window.clearTimeout(idleTimer);
      idle = 0;
    };
    const onLoad = () => preloadNextPage();
    if (document.readyState === 'complete') preloadNextPage();
    else window.addEventListener('load', onLoad, { once: true });
    // While the reader's own navigation loads, nothing speculative starts or waits to.
    const beforeNavigate = router.subscribe('onBeforeNavigate', ({ fromLocation, toLocation }) => {
      if (fromLocation?.href === toLocation.href) return;
      window.clearTimeout(dwell);
      touch = null;
      cancelNextPage();
      preload.cancel();
    });
    const resolved = router.subscribe('onResolved', () => preload.resume());
    const rendered = router.subscribe('onRendered', ({ fromLocation, toLocation }) => {
      if (!fromLocation || fromLocation.href === toLocation.href) return;
      cancelNextPage();
      preloadNextPage();
    });

    return () => {
      preload.cancel();
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('pointerout', onPointerOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchCancel);
      window.removeEventListener('load', onLoad);
      window.clearTimeout(dwell);
      cancelNextPage();
      beforeNavigate();
      resolved();
      rendered();
    };
  }, [router, projectId, publicSite]);
  return announcement;
}
