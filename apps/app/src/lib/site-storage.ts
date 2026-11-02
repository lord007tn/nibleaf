type SiteStorage = 'localStorage' | 'sessionStorage';

/** Browser privacy settings can reject even access to the storage property.
 * Reader preferences and analytics must never prevent documentation access. */
export const readSiteStorage = (storage: SiteStorage, key: string): string | null => {
  try {
    return typeof window === 'undefined' ? null : window[storage].getItem(key);
  } catch {
    return null;
  }
};

export const writeSiteStorage = (storage: SiteStorage, key: string, value: string): boolean => {
  try {
    if (typeof window === 'undefined') return false;
    window[storage].setItem(key, value);
    return true;
  } catch {
    return false;
  }
};
