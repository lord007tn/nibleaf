import { createFileRoute } from '@tanstack/react-router';
import { LandingPage } from '@/components/marketing/landing/landing-page';
import { getGithubStarsFn } from '@/lib/marketing-seo';

export const Route = createFileRoute('/')({
  // The head is built in a lazily imported module, not in every page's route tree.
  loader: async () => {
    const [stars, { landingHead }] = await Promise.all([getGithubStarsFn(), import('@/components/marketing/copy/landing-head')]);
    return { stars, head: landingHead('en') };
  },
  head: ({ loaderData }) => loaderData?.head ?? {},
  component: Landing,
});

function Landing() {
  const { stars } = Route.useLoaderData();
  return <LandingPage stars={stars} />;
}
