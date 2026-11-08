import { createFileRoute } from '@tanstack/react-router';
import { ArabicLandingPage } from '@/components/marketing/landing/arabic-landing-page';

export const Route = createFileRoute('/ar/')({
  // The head and the SEO helpers load with this page, not with every page's route tree.
  loader: async () => {
    const [{ getGithubStarsFn }, { landingHead }] = await Promise.all([
      import('@/lib/marketing-seo'),
      import('@/components/marketing/copy/landing-head'),
    ]);
    return { stars: await getGithubStarsFn(), head: landingHead('ar') };
  },
  head: ({ loaderData }) => loaderData?.head ?? {},
  component: ArabicLanding,
});

function ArabicLanding() {
  const { stars } = Route.useLoaderData();
  return <ArabicLandingPage stars={stars} />;
}
