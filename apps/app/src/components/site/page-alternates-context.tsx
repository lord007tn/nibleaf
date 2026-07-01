import { createContext, useContext } from 'react';

export interface SiteLanguageAlternate {
  code: string;
  isDefault: boolean;
  path?: string | null;
}

interface SitePageAlternatesContextValue {
  alternates: SiteLanguageAlternate[];
  setAlternates: (alternates: SiteLanguageAlternate[]) => void;
}

export const SitePageAlternatesContext = createContext<SitePageAlternatesContextValue>({
  alternates: [],
  setAlternates: () => undefined,
});

export const useSitePageAlternates = () => useContext(SitePageAlternatesContext);
