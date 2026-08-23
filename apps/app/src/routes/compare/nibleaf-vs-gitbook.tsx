import { createFileRoute } from '@tanstack/react-router';
import { ComparePage } from '@/components/marketing/comparison-page';
import type { Comparison } from '@/lib/comparison-data';
import { loadComparisonData } from '@/lib/comparison-loader';
import { breadcrumbLd, canonicalHref, faqLd, getGithubStarsFn, pageMeta } from '@/lib/marketing-seo';

export const Route = createFileRoute('/compare/nibleaf-vs-gitbook')({
  loader: async () => ({ data: (await loadComparisonData('nibleafVsGitbook')) as Comparison, stars: await getGithubStarsFn() }),
  head: ({ loaderData }) => ({
    meta: loaderData ? pageMeta({ title: loaderData.data.metaTitle, description: loaderData.data.metaDescription, path: loaderData.data.path }) : [],
    links: loaderData ? [{ rel: 'canonical', href: canonicalHref(loaderData.data.path) }] : [],
    scripts: [
      ...(loaderData ? [faqLd(loaderData.data.faqs)] : []),
      breadcrumbLd([{ name: 'Home', path: '/' }, ...(loaderData ? [{ name: loaderData.data.breadcrumbName, path: loaderData.data.path }] : [])]),
    ],
  }),
  component: NibleafVsGitbookRoute,
});

function NibleafVsGitbookRoute() {
  const { data, stars } = Route.useLoaderData();
  return <ComparePage data={data} stars={stars} />;
}
