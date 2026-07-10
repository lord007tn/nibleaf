import { createFileRoute } from '@tanstack/react-router';
import { ComparePage } from '@/components/marketing/comparison-page';
import { nibleafVsMintlify as data } from '@/lib/comparison-data';
import { breadcrumbLd, canonicalHref, faqLd, getGithubStars, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/compare/nibleaf-vs-mintlify')({
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
  component: NibleafVsMintlifyRoute,
});

function NibleafVsMintlifyRoute() {
  const { stars } = Route.useLoaderData();
  return <ComparePage data={data} stars={stars} />;
}
