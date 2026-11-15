import { MarketingShell } from '@/components/cloud-marketing';
import { bilingualPageHead } from '@/components/marketing/bilingual-head';
import { selfHostingEn } from '@/components/marketing/copy/self-hosting.en';
import { useMarketingData } from '@/components/marketing/page-data';
import { SelfHostingView } from '@/components/marketing/self-hosting-view';

export const load = async () => {
  const seo = await import('@/lib/marketing-seo');
  const head = bilingualPageHead(seo, { lang: 'en', enPath: '/self-hosting', meta: selfHostingEn.meta });
  return { stars: await seo.getGithubStarsFn(), head };
};

export const Page = SelfHostingPage;

function SelfHostingPage() {
  const { stars } = useMarketingData<typeof load>();
  return (
    <MarketingShell stars={stars}>
      <SelfHostingView copy={selfHostingEn} lang="en" />
    </MarketingShell>
  );
}
