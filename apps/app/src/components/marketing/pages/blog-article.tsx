import { notFound } from '@tanstack/react-router';
import { ArticlePage, articleMdxComponents } from '@/components/marketing/blog';
import { type MarketingLoadInput, useMarketingData, useMarketingParams } from '@/components/marketing/page-data';
import { blogComponent } from '@/lib/blog-components';

export const load = async ({ params }: MarketingLoadInput) => {
  const [{ blogEntry }, { articleHead }, { getGithubStarsFn }] = await Promise.all([
    import('@/lib/blog'),
    import('@/lib/blog-seo'),
    import('@/lib/marketing-seo'),
  ]);
  const entry = blogEntry(params.slug ?? '');
  if (!entry) {
    throw notFound();
  }
  const translation = entry.translationOf ? blogEntry(entry.translationOf) : undefined;
  return { entry, translation, language: entry.language ?? 'en', stars: await getGithubStarsFn(), head: articleHead(entry, translation) };
};

export const Page = ArticleRoute;

function ArticleRoute() {
  const { slug } = useMarketingParams();
  const { entry, stars } = useMarketingData<typeof load>();
  const Body = blogComponent(slug ?? '');
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
