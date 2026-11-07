import { createFileRoute, notFound } from '@tanstack/react-router';
import { ArticlePage, articleMdxComponents } from '@/components/marketing/blog';
import { blogComponent } from '@/lib/blog-components';

export const Route = createFileRoute('/blog/$slug')({
  // The article's SEO helpers load with this page, not with every page's route tree (BUNDLE_BUDGET.md).
  loader: async ({ params }) => {
    const [{ blogEntry }, { articleHead }, { getGithubStarsFn }] = await Promise.all([
      import('@/lib/blog'),
      import('@/lib/blog-seo'),
      import('@/lib/marketing-seo'),
    ]);
    const entry = blogEntry(params.slug);
    if (!entry) {
      throw notFound();
    }
    const translation = entry.translationOf ? blogEntry(entry.translationOf) : undefined;
    return { entry, translation, language: entry.language ?? 'en', stars: await getGithubStarsFn(), head: articleHead(entry, translation) };
  },
  head: ({ loaderData }) => loaderData?.head ?? {},
  component: ArticleRoute,
});

function ArticleRoute() {
  const { slug } = Route.useParams();
  const { entry, stars } = Route.useLoaderData();
  const Body = blogComponent(slug);
  if (!entry || !Body) {
    // loader already threw notFound() for unknown slugs; this guards HMR edge cases.
    return null;
  }
  return (
    <ArticlePage entry={entry} stars={stars}>
      <Body components={articleMdxComponents} />
    </ArticlePage>
  );
}
