import type { MarketingLang, UseCaseSlug } from '../copy/types';
import { getUseCaseHref, USE_CASE_META, USE_CASE_SLUGS } from '../copy/use-case-meta';

export interface UseCaseCard {
  slug: UseCaseSlug;
  label: string;
  summary: string;
  href: string;
}

/**
 * Cards for the landing-page teaser, built from the small `use-case-meta`
 * module (`navLabel`, `cardSummary`) so the landing page never loads the full
 * use-case copy.
 */
export function getUseCaseCards(lang: MarketingLang): UseCaseCard[] {
  return USE_CASE_SLUGS.map((slug) => {
    const meta = USE_CASE_META[lang][slug];
    return { slug, label: meta.navLabel, summary: meta.cardSummary, href: getUseCaseHref(lang, slug) };
  });
}
