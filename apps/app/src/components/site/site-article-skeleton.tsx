import { Skeleton, SkeletonText } from '@nibleaf/design-system/components/ui/skeleton';
import { siteT } from '@nibleaf/i18n/site';
import { DocumentationPageLayout } from '@/components/site/documentation-theme-provider';
import { useSiteReader } from '@/components/site/site-reader-context';

/**
 * Shown while the reader opens another page (the router's pending state). It
 * sits inside the reader chrome and the active theme's page layout, shaped like
 * an article (title, summary, details, paragraphs, a code block) and its
 * outline, so the real page replaces it without the layout jumping. Logical
 * properties keep it mirrored in right-to-left languages, and the blocks take
 * the theme's foreground colour, so they suit every theme, light or dark.
 */
export function SiteArticleSkeleton() {
  const t = siteT(useSiteReader()?.lang);
  const article = (
    <div aria-busy="true" className="mx-auto w-full min-w-0 max-w-[46rem]" data-site-article-skeleton data-theme-region="article">
      <p className="sr-only" role="status">
        {t('loading')}
      </p>
      <div aria-hidden>
        <Skeleton className="h-9 w-3/5 md:h-10" />
        <Skeleton className="mt-4 h-5 w-4/5" />
        <div className="mt-5 flex gap-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-28" />
        </div>
        <SkeletonText className="mt-10" lines={4} />
        <Skeleton className="mt-10 h-6 w-2/5" />
        <SkeletonText className="mt-4" lines={3} />
        <Skeleton className="mt-6 h-28 w-full rounded-lg" />
        <SkeletonText className="mt-6" lines={3} />
      </div>
    </div>
  );
  const outline = (
    <div aria-hidden className="flex flex-col gap-3">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
  return <DocumentationPageLayout article={article} tableOfContents={outline} />;
}
