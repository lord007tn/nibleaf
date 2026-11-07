import {
  marketing_arabicplatforms_breadcrumb,
  marketing_arabicplatforms_description,
  marketing_arabicplatforms_imagealt,
  marketing_arabicplatforms_title,
} from '@nibleaf/i18n/messages';

// The Arabic platform comparison's head copy. Its route loader imports this module
// lazily: a route's `head` is part of the router's eager chunk, which every
// published docs page loads, so the long Arabic titles and descriptions stay out
// of it. Loader data is serialized into the page, so SSR and hydration are unchanged.
const ar = { locale: 'ar' } as const;

export interface ArabicPlatformsCopy {
  title: string;
  description: string;
  imageAlt: string;
  breadcrumb: string;
}

export const arabicPlatformsCopy = (): ArabicPlatformsCopy => ({
  title: marketing_arabicplatforms_title({}, ar),
  description: marketing_arabicplatforms_description({}, ar),
  imageAlt: marketing_arabicplatforms_imagealt({}, ar),
  breadcrumb: marketing_arabicplatforms_breadcrumb({}, ar),
});
