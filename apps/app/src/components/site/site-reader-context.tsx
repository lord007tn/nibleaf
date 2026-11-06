import { createContext, useContext } from 'react';

/** What reader-chrome pieces rendered inside the outlet (such as the site
 * not-found page) need from the surrounding chrome. */
export interface SiteReaderContextValue {
  /** Active content language code, for localized chrome strings. */
  lang?: string;
  /** The docs home URL, keeping the active language and version. */
  homeHref: string;
  /** Opens the search dialog; absent when the site turned search off. */
  openSearch?: () => void;
}

export const SiteReaderContext = createContext<SiteReaderContextValue | null>(null);

export const useSiteReader = (): SiteReaderContextValue | null => useContext(SiteReaderContext);
