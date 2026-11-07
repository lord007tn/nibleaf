import {
  marketing_arabiclanding_description,
  marketing_arabiclanding_imagealt,
  marketing_arabiclanding_title,
  marketing_arabicplatforms_breadcrumb,
  marketing_arabicplatforms_description,
  marketing_arabicplatforms_imagealt,
  marketing_arabicplatforms_title,
} from '@nibleaf/i18n/messages';

// The Arabic marketing pages' head copy. Their route loaders import this module
// lazily: a route's `head` is part of the router's eager chunk, which every
// published docs page loads, so the long Arabic titles and descriptions stay out
// of it. Loader data is serialized into the page, so SSR and hydration are unchanged.
const ar = { locale: 'ar' } as const;

export interface ArabicLandingCopy {
  title: string;
  description: string;
  imageAlt: string;
}

export interface ArabicPlatformsCopy extends ArabicLandingCopy {
  breadcrumb: string;
}

export const arabicLandingCopy = (): ArabicLandingCopy => ({
  title: marketing_arabiclanding_title({}, ar),
  description: marketing_arabiclanding_description({}, ar),
  imageAlt: marketing_arabiclanding_imagealt({}, ar),
});

export const arabicPlatformsCopy = (): ArabicPlatformsCopy => ({
  title: marketing_arabicplatforms_title({}, ar),
  description: marketing_arabicplatforms_description({}, ar),
  imageAlt: marketing_arabicplatforms_imagealt({}, ar),
  breadcrumb: marketing_arabicplatforms_breadcrumb({}, ar),
});
