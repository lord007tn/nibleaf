import { shellAr } from '../copy/shell.ar';
import type { UseCaseSlug } from '../copy/types';
import { useCasesAr } from '../copy/use-cases.ar';
import { MarketingSiteShell } from '../site/marketing-site-shell';
import { UseCaseView } from './use-case-view';

/**
 * Arabic use-case page. Same shell as `ArabicShell` (`arabic-landing.tsx`),
 * used directly so this chunk doesn't also load the Arabic landing copy; the
 * language switch points at the same page in English.
 */
export function ArabicUseCasePage({ slug, stars = 0 }: { slug: UseCaseSlug; stars?: number }) {
  return (
    <MarketingSiteShell lang="ar" copy={shellAr} alternateHref={`/use-cases/${slug}`} stars={stars}>
      <UseCaseView lang="ar" copy={useCasesAr[slug]} stars={stars} starsLabel={shellAr.github.starsLabel} />
    </MarketingSiteShell>
  );
}
