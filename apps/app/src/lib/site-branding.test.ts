import { describe, expect, it } from 'vitest';
import { publishedSiteLogo } from './site-branding';

describe('publishedSiteLogo', () => {
  it('uses the mark-only asset for the official Nibleaf documentation wordmark', () => {
    expect(publishedSiteLogo('https://nibleaf.com/brand/raster/logo/nibleaf-logo-horizontal-ltr.png', 'light')).toEqual({
      src: 'https://nibleaf.com/brand/nibleaf-icon.svg',
      markOnly: true,
    });
    expect(publishedSiteLogo('https://nibleaf.com/brand/raster/logo/nibleaf-logo-horizontal-ltr-reverse.png', 'dark')).toEqual({
      src: 'https://nibleaf.com/brand/nibleaf-icon-reverse.svg',
      markOnly: true,
    });
  });

  it('keeps customer logos and their adjacent site name unchanged', () => {
    expect(publishedSiteLogo('https://assets.example.com/logo.svg', 'light')).toEqual({
      src: 'https://assets.example.com/logo.svg',
      markOnly: false,
    });
  });

  it('keeps the empty branding fallback available', () => {
    expect(publishedSiteLogo(null, 'light')).toBeNull();
  });
});
