import { createFileRoute, notFound } from '@tanstack/react-router';
import { ArabicUseCasePage } from '@/components/marketing/use-cases/arabic-use-case-page';

export const Route = createFileRoute('/ar/use-cases/$slug')({
  // The head is built in a lazily imported module, not in every page's route tree (BUNDLE_BUDGET.md).
  loader: async ({ params }) => {
    const { loadUseCasePage } = await import('@/components/marketing/copy/use-case-head');
    const page = await loadUseCasePage('ar', params.slug);
    if (!page) throw notFound();
    return page;
  },
  head: ({ loaderData }) => loaderData?.head ?? {},
  component: ArabicUseCaseRoute,
});

function ArabicUseCaseRoute() {
  const { slug, stars } = Route.useLoaderData();
  return <ArabicUseCasePage slug={slug} stars={stars} />;
}
