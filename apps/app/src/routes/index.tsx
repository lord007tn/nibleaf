import { createFileRoute } from '@tanstack/react-router';
import { LandingPage } from '@/components/marketing/landing/landing-page';

export const Route = createFileRoute('/')({
  // The head and the SEO helpers load with this page, not with every page's route tree.
  loader: async () => {
    const [{ getGithubStarsFn }, { landingHead }] = await Promise.all([import('@/lib/marketing-seo'), import('@/components/marketing/copy/landing-head')]);
    return { stars: await getGithubStarsFn(), head: landingHead('en') };
  },
  head: ({ loaderData }) => loaderData?.head ?? {},
  component: Landing,
});

function Landing() {
  const { stars } = Route.useLoaderData();
  return <LandingPage stars={stars} />;
}
