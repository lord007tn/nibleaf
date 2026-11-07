import { shellEn } from '../copy/shell.en';
import type { UseCaseSlug } from '../copy/types';
import { useCasesEn } from '../copy/use-cases.en';
import { MarketingSiteShell } from '../site/marketing-site-shell';
import { UseCaseView } from './use-case-view';

/**
 * English use-case page. It wraps the view in the site shell directly rather
 * than `MarketingShell`, whose language switch always points at `/ar`: here it
 * points at the same page in Arabic. Kept apart from the Arabic page so each
 * language's route chunk loads only its own copy.
 */
export function UseCasePage({ slug, stars = 0 }: { slug: UseCaseSlug; stars?: number }) {
  return (
    <MarketingSiteShell lang="en" copy={shellEn} alternateHref={`/ar/use-cases/${slug}`} stars={stars}>
      <UseCaseView lang="en" copy={useCasesEn[slug]} stars={stars} />
    </MarketingSiteShell>
  );
}
