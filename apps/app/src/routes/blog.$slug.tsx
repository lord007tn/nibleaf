import { createFileRoute, notFound } from '@tanstack/react-router';
import { ArticlePage, articleMdxComponents } from '@/components/marketing/blog';
import { blogComponent } from '@/lib/blog-components';
import { articleHead } from '@/lib/blog-seo';
import { getGithubStarsFn } from '@/lib/marketing-seo';

export const Route = createFileRoute('/blog/$slug')({
  loader: async ({ params }) => {
    const { blogEntry } = await import('@/lib/blog');
    const entry = blogEntry(params.slug);
    if (!entry) {
      throw notFound();
    }
    const translation = entry.translationOf ? blogEntry(entry.translationOf) : undefined;
    return { entry, translation, language: entry.language ?? 'en', stars: await getGithubStarsFn() };
  },
  head: ({ loaderData }) => (loaderData?.entry ? articleHead(loaderData.entry, loaderData.translation) : {}),
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
