import { createFileRoute, notFound } from '@tanstack/react-router';
import { ArticlePage, articleHead, articleMdxComponents } from '@/components/marketing/blog';
import { blogEntry, blogLanguage } from '@/lib/blog';
import { blogComponent } from '@/lib/blog-components';
import { getGithubStars } from '@/lib/marketing-seo';

export const Route = createFileRoute('/blog/$slug')({
  loader: async ({ params }) => {
    const entry = blogEntry(params.slug);
    if (!entry) {
      throw notFound();
    }
    return { language: blogLanguage(entry), stars: await getGithubStars() };
  },
  head: ({ params }) => {
    const entry = blogEntry(params.slug);
    return entry ? articleHead(entry) : {};
  },
  component: ArticleRoute,
});

function ArticleRoute() {
  const { slug } = Route.useParams();
  const { stars } = Route.useLoaderData();
  const entry = blogEntry(slug);
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
