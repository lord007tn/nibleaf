import { type ComponentType, createContext, useContext } from 'react';

/** What reader-chrome pieces rendered inside the outlet (such as the site
 * not-found page) need from the surrounding chrome. */
export interface SiteReaderContextValue {
  /** Active content language code, for localized chrome strings. */
  lang?: string;
  /** The site's languages, so content shown in another language (a fallback
   *  page) can carry that language's direction. */
  languages?: ReadonlyArray<{ code: string; direction: 'LTR' | 'RTL'; label?: string; isDefault?: boolean; pathPrefix?: string }>;
  /** The docs home URL, keeping the active language and version. */
  homeHref: string;
  /** Opens the search dialog; absent when the site turned search off. */
  openSearch?: () => void;
  /** The article-shaped placeholder shown while another page opens. */
  pendingArticle?: ComponentType;
}

export const SiteReaderContext = createContext<SiteReaderContextValue | null>(null);

export const useSiteReader = (): SiteReaderContextValue | null => useContext(SiteReaderContext);

/**
 * The reader routes' pending component. A route's pendingComponent stays in
 * the router's entry chunk, which every page loads, and must render at once
 * (a lazy one can suspend before its chunk arrives). So it imports nothing:
 * it shows the article skeleton the reader chrome hands down, whose module
 * (with the reader's translator and theme layouts) loads with the chrome.
 */
export function SiteReaderPending() {
  const PendingArticle = useSiteReader()?.pendingArticle;
  return PendingArticle ? <PendingArticle /> : null;
}
