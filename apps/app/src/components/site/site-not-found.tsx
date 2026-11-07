import { siteT } from '@nibleaf/i18n/site';
import { FileQuestion, Search } from 'lucide-react';
import { useSiteReader } from '@/components/site/site-reader-context';
import { preloadSiteSearch } from '@/components/site/site-search';

/**
 * A missing page on a published site. It renders inside the reader chrome (so
 * the header, sidebar and search stay available), in the site's active
 * language, and points back into these docs rather than to the platform home.
 */
export function SiteNotFound() {
  const reader = useSiteReader();
  const t = siteT(reader?.lang);
  const openSearch = reader?.openSearch;
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center sm:py-24" data-site-not-found="">
      <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden>
        <FileQuestion className="size-6" />
      </span>
      <h1 tabIndex={-1} className="mt-5 font-semibold text-2xl text-foreground tracking-tight outline-none">
        {t('notFoundTitle')}
      </h1>
      <p className="mt-3 text-muted-foreground">{t('notFoundBody')}</p>
      <div className="mt-8 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
        {openSearch ? (
          <button
            type="button"
            onClick={openSearch}
            onFocus={preloadSiteSearch}
            onPointerEnter={preloadSiteSearch}
            onTouchStart={preloadSiteSearch}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-5 font-medium text-primary-foreground text-sm shadow-sm transition-opacity hover:opacity-90"
          >
            <Search className="size-4" aria-hidden />
            {t('notFoundSearch')}
          </button>
        ) : null}
        <a
          href={reader?.homeHref ?? '/'}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-5 font-medium text-foreground text-sm transition-colors hover:bg-muted"
        >
          {t('notFoundHome')}
        </a>
      </div>
    </div>
  );
}
