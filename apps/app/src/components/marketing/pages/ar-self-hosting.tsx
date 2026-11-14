import { bilingualPageHead } from '@/components/marketing/bilingual-head';
import { selfHostingAr } from '@/components/marketing/copy/self-hosting.ar';
import { shellAr } from '@/components/marketing/copy/shell.ar';
import { useMarketingData } from '@/components/marketing/page-data';
import { SelfHostingView } from '@/components/marketing/self-hosting-view';
import { MarketingSiteShell } from '@/components/marketing/site/marketing-site-shell';

export const load = async () => {
  const seo = await import('@/lib/marketing-seo');
  const head = bilingualPageHead(seo, { lang: 'ar', enPath: '/self-hosting', meta: selfHostingAr.meta });
  return { stars: await seo.getGithubStarsFn(), head };
};

export const Page = ArabicSelfHostingPage;

/** `/ar/self-hosting`: the self-hosting view with the Arabic copy; the language switch opens `/self-hosting`. */
function ArabicSelfHostingPage() {
  const { stars } = useMarketingData<typeof load>();
  return (
    <MarketingSiteShell lang="ar" copy={shellAr} alternateHref="/self-hosting" stars={stars}>
      <SelfHostingView copy={selfHostingAr} lang="ar" />
    </MarketingSiteShell>
  );
}
