import { createFileRoute } from '@tanstack/react-router';
import { AlternativesPage } from '@/components/marketing/comparison-page';
import type { AlternativesRoundup } from '@/lib/comparison-data';
import { loadComparisonData } from '@/lib/comparison-loader';
import { breadcrumbLd, canonicalHref, faqLd, getGithubStarsFn, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/alternatives/gitbook')({
  loader: async () => ({ data: (await loadComparisonData('gitbookAlternatives')) as AlternativesRoundup, stars: await getGithubStarsFn() }),
  head: ({ loaderData }) => ({
    meta: loaderData ? pageMeta({ title: loaderData.data.metaTitle, description: loaderData.data.metaDescription, path: loaderData.data.path }) : [],
    links: loaderData ? [{ rel: 'canonical', href: canonicalHref(loaderData.data.path) }] : [],
    scripts: [
      ...(loaderData ? [faqLd(loaderData.data.faqs)] : []),
      breadcrumbLd([{ name: 'Home', path: '/' }, ...(loaderData ? [{ name: loaderData.data.breadcrumbName, path: loaderData.data.path }] : [])]),
    ],
  }),
  component: GitbookAlternativesRoute,
});

function GitbookAlternativesRoute() {
  const { data, stars } = Route.useLoaderData();
  return <AlternativesPage data={data} stars={stars} />;
}
