import { createFileRoute, notFound } from '@tanstack/react-router';
import { UseCasePage } from '@/components/marketing/use-cases/use-case-page';
import { getGithubStarsFn } from '@/lib/marketing-seo';

export const Route = createFileRoute('/use-cases/$slug')({
  // The head is built in a lazily imported module, not in every page's route tree (BUNDLE_BUDGET.md).
  loader: async ({ params }) => {
    const [{ useCaseRouteData }, stars] = await Promise.all([import('@/components/marketing/copy/use-case-head'), getGithubStarsFn()]);
    const page = useCaseRouteData('en', params.slug);
    if (!page) throw notFound();
    return { ...page, stars };
  },
  head: ({ loaderData }) => loaderData?.head ?? {},
  component: UseCaseRoute,
});

function UseCaseRoute() {
  const { slug, stars } = Route.useLoaderData();
  return <UseCasePage slug={slug} stars={stars} />;
}
