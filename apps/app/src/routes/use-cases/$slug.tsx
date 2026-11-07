import { createFileRoute, notFound } from '@tanstack/react-router';
import { UseCasePage } from '@/components/marketing/use-cases/use-case-page';
import { getGithubStarsFn } from '@/lib/marketing-seo';
import { buildUseCaseHead } from '@/lib/use-case-head';

export const Route = createFileRoute('/use-cases/$slug')({
  // Head copy loads with this page, not with every page's route tree (BUNDLE_BUDGET.md).
  loader: async ({ params }) => {
    const { USE_CASE_HOME, findUseCaseMeta } = await import('@/components/marketing/copy/use-case-meta');
    const meta = findUseCaseMeta('en', params.slug);
    if (!meta) throw notFound();
    return { meta, home: USE_CASE_HOME.en, stars: await getGithubStarsFn() };
  },
  head: ({ loaderData }) => (loaderData ? buildUseCaseHead('en', loaderData) : {}),
  component: UseCaseRoute,
});

function UseCaseRoute() {
  const { meta, stars } = Route.useLoaderData();
  return <UseCasePage slug={meta.slug} stars={stars} />;
}
