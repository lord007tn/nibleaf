import { LandingPage } from '@/components/marketing/landing/landing-page';
import { useMarketingData } from '@/components/marketing/page-data';

export const load = async () => {
  const [{ getGithubStarsFn }, { landingHead }] = await Promise.all([
    import('@/lib/marketing-seo'),
    import('@/components/marketing/copy/landing-head'),
  ]);
  return { stars: await getGithubStarsFn(), head: landingHead('en') };
};

export const Page = Landing;

function Landing() {
  const { stars } = useMarketingData<typeof load>();
  return <LandingPage stars={stars} />;
}
