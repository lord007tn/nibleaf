import { createFileRoute, notFound } from '@tanstack/react-router';
import { ArabicUseCasePage } from '@/components/marketing/use-cases/arabic-use-case-page';
import { getGithubStarsFn } from '@/lib/marketing-seo';
import { buildUseCaseHead } from '@/lib/use-case-head';

export const Route = createFileRoute('/ar/use-cases/$slug')({
  // Head copy loads with this page, not with every page's route tree (BUNDLE_BUDGET.md).
  loader: async ({ params }) => {
    const { USE_CASE_HOME, findUseCaseMeta } = await import('@/components/marketing/copy/use-case-meta');
    const meta = findUseCaseMeta('ar', params.slug);
    if (!meta) throw notFound();
    return { meta, home: USE_CASE_HOME.ar, stars: await getGithubStarsFn() };
  },
  head: ({ loaderData }) => (loaderData ? buildUseCaseHead('ar', loaderData) : {}),
  component: ArabicUseCaseRoute,
});

function ArabicUseCaseRoute() {
  const { meta, stars } = Route.useLoaderData();
  return <ArabicUseCasePage slug={meta.slug} stars={stars} />;
}
