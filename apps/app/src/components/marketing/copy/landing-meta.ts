import type { MarketingLang } from './types';

/**
 * Head metadata for the landing page in each language: the single source for
 * the page's `<title>`, description and Open Graph card.
 *
 * Route loaders import this module lazily (`import()`), because a route's
 * `head` and `loader` options are part of the router chunk every published docs
 * page loads. Keep it small and free of other imports.
 */
export interface MarketingPageMeta {
  title: string;
  description: string;
  ogImagePath: string;
  ogImageAlt: string;
}

export const LANDING_META: Record<MarketingLang, MarketingPageMeta> = {
  en: {
    title: 'Nibleaf: open-source docs with AI answers, English & Arabic',
    description:
      'Open-source documentation platform and help center: AI answers that cite your docs, search insights, English and Arabic. Free cloud beta or self-host it.',
    ogImagePath: '/brand/raster/social/nibleaf-og-home.png',
    ogImageAlt:
      'Nibleaf, docs that answer your customers: a published docs page, with the Ask AI answer on a phone citing the sections it came from.',
  },
  ar: {
    title: 'Nibleaf | منصة توثيق ومركز مساعدة بالعربية وRTL',
    description:
      'منصة توثيق مفتوحة المصدر ومركز مساعدة لعملائك: توثيق عربي من اليمين إلى اليسار (RTL)، وإجابات ذكية تُحيل إلى صفحاتك. جرّب السحابة مجانًا أو استضفها بنفسك.',
    ogImagePath: '/brand/raster/social/nibleaf-og-home-ar.png',
    ogImageAlt: 'Nibleaf، وثائق تُجيب عملاءك بلغتهم: صفحة وثائق منشورة، وعلى الهاتف إجابة «اسأل المساعد» مع الأقسام التي أُخذت منها.',
  },
};
