import { createFileRoute } from '@tanstack/react-router';
import { LandingPage } from '@/components/cloud-marketing';
import { canonicalHref, getGithubStars, marketingLd, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/')({
  loader: async () => ({ stars: await getGithubStars() }),
  head: () => ({
    meta: pageMeta({
      title: 'Nibleaf — the open-source Mintlify alternative',
      description:
        'The open-source Mintlify alternative: a self-hostable docs platform with a Notion-style Markdown editor, built-in search, Arabic/RTL and a free cloud beta.',
      path: '/',
    }),
    links: [{ rel: 'canonical', href: canonicalHref('/') }],
    scripts: [marketingLd()],
  }),
  component: Landing,
});

function Landing() {
  const { stars } = Route.useLoaderData();
  return <LandingPage stars={stars} />;
}
