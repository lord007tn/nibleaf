import { createFileRoute } from '@tanstack/react-router';
import { AlternativesPage } from '@/components/marketing/comparison-page';
import { mintlifyAlternatives as data } from '@/lib/comparison-data';
import { breadcrumbLd, canonicalHref, faqLd, getGithubStars, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/alternatives/mintlify')({
  loader: async () => ({ stars: await getGithubStars() }),
  head: () => ({
    meta: pageMeta({ title: data.metaTitle, description: data.metaDescription, path: data.path }),
    links: [{ rel: 'canonical', href: canonicalHref(data.path) }],
    scripts: [
      faqLd(data.faqs),
      breadcrumbLd([
        { name: 'Home', path: '/' },
        { name: data.breadcrumbName, path: data.path },
      ]),
    ],
  }),
  component: MintlifyAlternativesRoute,
});

function MintlifyAlternativesRoute() {
  const { stars } = Route.useLoaderData();
  return <AlternativesPage data={data} stars={stars} />;
}
