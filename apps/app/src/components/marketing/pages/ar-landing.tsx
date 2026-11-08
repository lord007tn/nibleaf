import { ArabicLandingPage } from '@/components/marketing/landing/arabic-landing-page';
import { useMarketingData } from '@/components/marketing/page-data';

export const load = async () => {
  const [{ getGithubStarsFn }, { landingHead }] = await Promise.all([
    import('@/lib/marketing-seo'),
    import('@/components/marketing/copy/landing-head'),
  ]);
  return { stars: await getGithubStarsFn(), head: landingHead('ar') };
};

export const Page = ArabicLanding;

function ArabicLanding() {
  const { stars } = useMarketingData<typeof load>();
  return <ArabicLandingPage stars={stars} />;
}
