const NIBLEAF_WORDMARK_TO_MARK = new Map([
  ['https://nibleaf.com/brand/raster/logo/nibleaf-logo-horizontal-ltr.png', 'https://nibleaf.com/brand/nibleaf-icon.svg'],
  ['https://nibleaf.com/brand/raster/logo/nibleaf-logo-horizontal-ltr-reverse.png', 'https://nibleaf.com/brand/nibleaf-icon-reverse.svg'],
  ['/brand/raster/logo/nibleaf-logo-horizontal-ltr.png', '/brand/nibleaf-icon.svg'],
  ['/brand/raster/logo/nibleaf-logo-horizontal-ltr-reverse.png', '/brand/nibleaf-icon-reverse.svg'],
]);

export interface PublishedSiteLogo {
  src: string;
  /** The official docs use a standalone mark. Customer logos retain the
   * existing logo + site-name treatment. */
  markOnly: boolean;
}

/** Keep the official Nibleaf documentation header compact. Other projects keep
 * the exact uploaded logo URL; the renderer never guesses at customer assets. */
export function publishedSiteLogo(src: string | null, theme: 'light' | 'dark'): PublishedSiteLogo | null {
  if (!src) {
    return null;
  }

  const compact = NIBLEAF_WORDMARK_TO_MARK.get(src);
  if (compact) {
    return { src: compact, markOnly: true };
  }

  // If the light wordmark is reused in dark mode, select the legible mark.
  if (theme === 'dark' && src.endsWith('/brand/raster/logo/nibleaf-logo-horizontal-ltr.png')) {
    return {
      src: src.replace('/brand/raster/logo/nibleaf-logo-horizontal-ltr.png', '/brand/nibleaf-icon-reverse.svg'),
      markOnly: true,
    };
  }

  return { src, markOnly: false };
}
