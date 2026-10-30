import { useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { isAppOwnedPath, isDocumentPath } from '@/lib/request-negotiation';
import { isCustomDomainSite } from '@/lib/site-paths';

/**
 * The router href for a click on a link to another page of this published
 * site, or null when the browser should handle the click itself: modified or
 * non-primary clicks, `target`/`download` links, other origins, non-document
 * paths (files such as `.md` or `sitemap.xml`, exactly as the server classifies
 * them; page slugs never contain a dot), and in-page `#fragment` jumps.
 */
export function siteNavigationHref(
  event: MouseEvent,
  projectId: string,
  location: Pick<Location, 'href' | 'origin' | 'pathname' | 'search'>,
): string | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
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
    const beforeNavigate = router.subscribe('onBeforeNavigate', () => {
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
          restoreTabIndex = () => {
            temporaryTarget.removeAttribute('tabindex');
            temporaryTarget.removeEventListener('blur', restore);
          };
          const restore = () => restoreTabIndex?.();
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
  return announcement;
}
