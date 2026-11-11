import { useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { isAppOwnedPath, isDocumentPath } from '@/lib/request-negotiation';
import { claimNavigationFallback, createLinkPreloader, HOVER_DWELL_MS } from '@/lib/site-link-prefetch';
import { isCustomDomainSite } from '@/lib/site-paths';

type ReaderLocation = Pick<Location, 'href' | 'origin' | 'pathname' | 'search'>;

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
 * work without JavaScript and in server-rendered HTML. */
export function useSiteLinkNavigation(projectId: string): string {
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

  // Prefetch on intent, the pager's next page when idle, and a server-rendered
  // fallback when a client navigation fails.
  useEffect(() => {
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
      // Touch has its own, earlier signal (touchstart).
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
    const onTouchStart = (event: TouchEvent) => {
      const href = targetOf(event.target);
      if (href) preload(href, 'touch');
    };
    document.addEventListener('pointerover', onPointerOver, { passive: true });
    document.addEventListener('pointerout', onPointerOut, { passive: true });
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('touchstart', onTouchStart, { passive: true });

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
    const rendered = router.subscribe('onRendered', ({ fromLocation, toLocation }) => {
      if (!fromLocation || fromLocation.href === toLocation.href) return;
      cancelNextPage();
      preloadNextPage();
    });

    // A client navigation whose loader failed (a network or server error; a
    // missing page is a not-found, not an error) reloads that URL once, so the
    // reader gets the server-rendered page instead of an error screen. Recorded
    // in session storage: if that page fails too, the error page stays.
    const resolved = router.subscribe('onResolved', ({ fromLocation, toLocation }) => {
      if (!fromLocation || fromLocation.href === toLocation.href) return;
      if (!router.state.matches.some((match) => match.status === 'error')) return;
      const href = window.location.href;
      if (claimNavigationFallback(href)) window.location.assign(href);
    });

    return () => {
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('pointerout', onPointerOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('load', onLoad);
      window.clearTimeout(dwell);
      cancelNextPage();
      rendered();
      resolved();
    };
  }, [router, projectId]);
  return announcement;
}
