import { createFileRoute } from '@tanstack/react-router';
import { ArabicLandingPage } from '@/components/marketing/landing/arabic-landing-page';
import { getGithubStarsFn } from '@/lib/marketing-seo';

export const Route = createFileRoute('/ar/')({
  // The head is built in a lazily imported module, not in every page's route tree.
  loader: async () => {
    const [stars, { landingHead }] = await Promise.all([getGithubStarsFn(), import('@/components/marketing/copy/landing-head')]);
    return { stars, head: landingHead('ar') };
  },
  head: ({ loaderData }) => loaderData?.head ?? {},
  component: ArabicLanding,
});

function ArabicLanding() {
  const { stars } = Route.useLoaderData();
  return <ArabicLandingPage stars={stars} />;
}
