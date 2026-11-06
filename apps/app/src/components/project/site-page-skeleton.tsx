import { Skeleton, SkeletonListRow, SkeletonStatTile } from '@nibleaf/design-system/components/ui/skeleton';
import { useT } from '@nibleaf/i18n/react';

/**
 * First-load placeholder for a site's pages, shaped like the site shell
 * (sidebar, header bar, page title, stat tiles, list) so nothing jumps when the
 * site arrives. Logical properties keep it mirrored correctly in Arabic.
 */
export function SitePageSkeleton() {
  const t = useT();
  return (
    <div aria-busy="true" className="flex min-h-screen bg-sidebar">
      <p className="sr-only" role="status">
        {t('common.loading')}
      </p>
      <div aria-hidden className="hidden w-72 shrink-0 flex-col gap-2 p-4 md:flex">
        <Skeleton className="mb-4 h-10 w-full rounded-lg" />
        {['overview', 'editor', 'analytics', 'settings'].map((item) => (
          <Skeleton className="h-10 w-full rounded-lg" key={item} />
        ))}
      </div>
      <div aria-hidden className="flex min-w-0 flex-1 flex-col bg-background md:my-2 md:me-2 md:rounded-xl md:shadow-sm">
        <div className="flex h-12 items-center gap-2 border-border border-b px-4">
          <Skeleton className="size-7" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="ms-auto h-8 w-24" />
        </div>
        <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {['a', 'b', 'c', 'd'].map((item) => (
              <SkeletonStatTile key={item} />
            ))}
          </div>
          <div className="rounded-xl border border-border px-4">
            {['a', 'b', 'c', 'd'].map((item) => (
              <SkeletonListRow key={item} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
