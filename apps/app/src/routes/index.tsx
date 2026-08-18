import { createFileRoute } from '@tanstack/react-router';
import { LandingPage } from '@/components/cloud-marketing';
import { canonicalHref, getGithubStars, marketingLd, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/')({
  loader: async () => ({ stars: await getGithubStars() }),
  head: () => ({
    meta: pageMeta({
      title: 'Nibleaf: visual Markdown docs with Arabic and RTL',
      description:
        'A documentation platform with a Notion-style Markdown editor, built-in search, versioned publishing, Arabic and RTL support, and a free cloud beta.',
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
