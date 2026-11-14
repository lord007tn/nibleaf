import { Button } from '@nibleaf/design-system/components/ui/button';
import { ScrollArea } from '@nibleaf/design-system/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Skeleton, SkeletonText } from '@nibleaf/design-system/components/ui/skeleton';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { displayTitle } from '@nibleaf/shared/page-title';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ChevronDown, Eye } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { publishedVersionSlugFor } from '@/components/editor/docs-version';
import { Markdown } from '@/components/markdown';
import { QueryErrorState } from '@/components/query-error-state';
import { DocumentationProjectPreviewLayout, DocumentationThemeProvider } from '@/components/site/documentation-theme-provider';
import { PageIcon } from '@/components/site/page-icon';
import { PreviewNav } from '@/features/site-preview/components/preview-nav';
import { previewHomeId, previewNavTree } from '@/features/site-preview/model/preview-nav';
import { useBranches, useLanguages, usePage, usePages, useProject, useProjectMembers } from '@/hooks/api';
import { pageQueryOptions } from '@/hooks/api/query-options';
import { defaultScopeId, prefetchScopedPages } from '@/hooks/api/route-prefetch';
import { useProjectAdminStatus } from '@/hooks/use-project-admin-status';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { PublishControl } from '@/layouts/project';
import { projectThemeStyle, projectThemeVariables, resolveProjectTheme } from '@/lib/site-theme';

export const Route = createFileRoute('/app/projects/$projectId/preview')({
  validateSearch: (search) =>
    z
      .object({
        branchId: z.string().min(1).optional().catch(undefined),
        languageId: z.string().min(1).optional().catch(undefined),
        pageId: z.string().min(1).optional().catch(undefined),
      })
      .parse(search),
  loaderDeps: ({ search: { branchId, languageId, pageId } }) => ({ branchId, languageId, pageId }),
  // The parent route prefetches the site, languages and branches; this adds the
  // previewed page list and, for a deep link, the page itself.
  loader: ({ context: { queryClient }, params: { projectId }, deps: { branchId, languageId, pageId } }) => {
    prefetchScopedPages(queryClient, projectId, { branchId, languageId });
    if (pageId) prefetchRouteData(queryClient, pageQueryOptions(projectId, pageId));
  },
  component: ProjectPreview,
});

interface PreviewSearch {
  branchId?: string;
  languageId?: string;
  pageId?: string;
}

function ProjectPreview() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const t = useT();
  const projectQuery = useProject(projectId);
  const { data: project } = projectQuery;
  const membersQuery = useProjectMembers(projectId);
  const { data: members } = membersQuery;
  const { status: previewAccess } = useProjectAdminStatus(projectId);
  const { data: languages } = useLanguages(projectId);
  const { data: branches } = useBranches(projectId);
  const activeLanguageId = search.languageId ?? defaultScopeId(languages);
  const activeLanguage = languages?.find((language) => language.id === activeLanguageId);
  // Content direction follows the previewed language (Arabic → RTL), mirroring
  // the published site so authors preview real layout, not always-LTR.
  const contentDir = activeLanguage?.direction === 'RTL' ? 'rtl' : 'ltr';
  // The preview shows what readers will see: an untitled page reads "Untitled" in its language.
  const shownTitle = (node: { title: string }) => displayTitle({ title: node.title, languageCode: activeLanguage?.code });
  const activeBranchId = search.branchId ?? defaultScopeId(branches);
  const previewEnabled = project ? project.config?.addons?.previewDeployments !== false : false;
  const pagesQuery = usePages(previewEnabled ? projectId : undefined, activeLanguageId, activeBranchId);
  const { data: pages, isPending: pagesPending } = pagesQuery;
  // The same tree readers get once this is published, so the order matches the editor's.
  const nav = useMemo(() => previewNavTree(pages, activeLanguage?.code), [pages, activeLanguage?.code]);
  const selected = useMemo(() => {
    const homeId = previewHomeId(pages, nav);
    return pages?.find((page) => page.id === search.pageId) ?? pages?.find((page) => page.id === homeId);
  }, [nav, pages, search.pageId]);
  // The content column stays mounted between pages; start each page at its top,
  // as the published site does (the router only restores the window's scroll).
  const contentRef = useRef<HTMLDivElement>(null);
  const selectedId = selected?.id;
  useEffect(() => {
    if (selectedId && contentRef.current) contentRef.current.scrollTop = 0;
  }, [selectedId]);
  const pageQuery = usePage(previewEnabled ? projectId : undefined, selected?.id);
  const { data: page, isPending: pagePending } = pageQuery;
  const contentPending = pagesPending || (Boolean(selected) && pagePending);
  // A failed request must not read as "no draft pages": offer a retry of whichever one failed.
  const failedQuery = pagesQuery.isError && !pages ? pagesQuery : selected && pageQuery.isError && !page ? pageQuery : undefined;
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const theme = resolveProjectTheme(project?.config);
  const previewMode = project?.config?.styling?.theme === 'dark' ? 'dark' : 'light';

  const updateSearch = (patch: Partial<PreviewSearch>) => {
    navigate({ search: (prev) => ({ ...prev, ...patch }) });
  };

  // Branch names are code (always LTR); a language's label reads in its own direction.
  const branchOptions = useMemo<ScopeOption[]>(
    () => (branches ?? []).map((branch) => ({ value: branch.id, label: <span dir="ltr">{branch.name}</span> })),
    [branches],
  );
  const languageOptions = useMemo<ScopeOption[]>(
    () =>
      (languages ?? []).map((language) => ({
        value: language.id,
        label: <span dir={language.direction === 'RTL' ? 'rtl' : 'ltr'}>{language.label}</span>,
      })),
    [languages],
  );
  const scopeSelects = (
    <>
      {branchOptions.length > 1 ? (
        <ScopeSelect
          ariaLabel={t('settings.git.productionBranch')}
          onChange={(branchId) => updateSearch({ branchId, pageId: undefined })}
          options={branchOptions}
          value={activeBranchId}
        />
      ) : null}
      {languageOptions.length > 1 ? (
        <ScopeSelect
          ariaLabel={t('editor.addLanguage.languageField')}
          onChange={(languageId) => updateSearch({ languageId, pageId: undefined })}
          options={languageOptions}
          value={activeLanguageId}
        />
      ) : null}
    </>
  );

  if (projectQuery.isPending) {
    return (
      <div aria-busy="true" className="mx-auto w-full max-w-2xl space-y-4 px-8 py-12">
        <p className="sr-only" role="status">
          {t('common.loading')}
        </p>
        <Skeleton aria-hidden className="h-7 w-40" />
        <SkeletonText lines={3} />
      </div>
    );
  }
  if (!project) {
    return (
      <div className="mx-auto max-w-2xl px-8 py-12">
        <QueryErrorState onRetry={() => void projectQuery.refetch()} retrying={projectQuery.isFetching} />
      </div>
    );
  }
  if (!previewEnabled) {
    return (
      <div className="mx-auto max-w-2xl px-8 py-12 outline-none" id="main-content" tabIndex={-1}>
        <div className="mb-3 flex items-center gap-2 font-semibold text-lg">
          <Eye className="size-5 text-muted-foreground" /> {t('preview.title')}
        </div>
        <p className="text-muted-foreground text-sm">{t('preview.disabled')}</p>
        {membersQuery.isError && !members ? (
          <QueryErrorState onRetry={() => void membersQuery.refetch()} retrying={membersQuery.isFetching} />
        ) : previewAccess === 'pending' ? (
          <div aria-busy="true" className="mt-4">
            <Skeleton aria-hidden className="h-11 w-44" />
          </div>
        ) : previewAccess === 'admin' ? (
          <Button
            className="mt-4"
            nativeButton={false}
            render={<Link params={{ projectId }} search={{ section: 'addons' }} to="/app/projects/$projectId/settings" />}
          >
            {t('preview.enablePreviews')}
          </Button>
        ) : (
          <p className="mt-4 text-muted-foreground text-sm">{t('preview.disabledAskAdmin')}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-w-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-border border-b bg-background p-3" data-preview-app-chrome="">
        {/* Back to the page being previewed, not the first page of the site. */}
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link to="/app/projects/$projectId/editor" params={{ projectId }} search={page ? { page: page.id } : {}} />}
        >
          <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
          {t('preview.backToEditor')}
        </Button>
        {project ? (
          <PublishControl
            project={project}
            currentPage={
              page
                ? {
                    path: page.path,
                    title: shownTitle(page),
                    languageCode: activeLanguage?.code,
                    // A non-default version lives under its own prefix (`/v2/…`).
                    versionSlug: publishedVersionSlugFor(branches, page.branchId ?? activeBranchId),
                  }
                : undefined
            }
          />
        ) : null}
      </div>
      <DocumentationThemeProvider
        appearance={previewMode}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        context="project-preview"
        direction={contentDir}
        style={{ ...projectThemeVariables(project?.config, previewMode), ...projectThemeStyle(project?.config) }}
        theme={theme}
      >
        <DocumentationProjectPreviewLayout
          mobileNavigation={
            <div className="border-border border-b bg-card/40 md:hidden" data-theme-region="sidebar">
              <button
                aria-controls="mobile-preview-navigation"
                aria-expanded={mobileNavigationOpen}
                className="flex w-full items-center gap-3 px-4 py-3 text-start"
                onClick={() => setMobileNavigationOpen((open) => !open)}
                type="button"
              >
                <Eye className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-sm">{t('preview.title')}</span>
                  <span className="block truncate text-muted-foreground text-xs">
                    {(selected ? shownTitle(selected) : undefined) ?? (failedQuery ? t('error.title') : t('preview.empty'))}
                  </span>
                </span>
                <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', mobileNavigationOpen && 'rotate-180')} />
              </button>

              {mobileNavigationOpen ? (
                <div className="max-h-[min(55vh,28rem)] overflow-y-auto border-border border-t p-3" id="mobile-preview-navigation">
                  <p className="mb-3 text-muted-foreground text-xs">{t('preview.description')}</p>
                  <div className="mb-3 grid gap-2">{scopeSelects}</div>
                  {pagesPending ? <PageListSkeleton rows={2} /> : null}
                  <PreviewNav
                    nodes={nav}
                    onSelect={(pageId) => {
                      updateSearch({ pageId });
                      setMobileNavigationOpen(false);
                    }}
                    selectedId={selected?.id}
                  />
                </div>
              ) : null}
            </div>
          }
          navigation={
            <>
              <div className="shrink-0 border-border border-b p-4">
                <div className="flex items-center gap-2 font-semibold text-sm">
                  <Eye className="size-4 text-muted-foreground" /> {t('preview.title')}
                </div>
                <p className="mt-1 text-muted-foreground text-xs">{t('preview.description')}</p>
                <div className="mt-4 grid gap-2">{scopeSelects}</div>
              </div>

              <ScrollArea className="min-h-0 flex-1">
                <div className="p-3" data-theme-region="sidebar-content">
                  {pagesPending ? <PageListSkeleton rows={3} /> : null}
                  <PreviewNav nodes={nav} onSelect={(pageId) => updateSearch({ pageId })} selectedId={selected?.id} />
                </div>
              </ScrollArea>
            </>
          }
          content={
            // The site layout already renders the page's <main>; this is the
            // skip target, past the preview's own page list.
            <div
              className="min-h-0 flex-1 overflow-y-auto bg-background outline-none"
              data-theme-region="preview-main"
              id="main-content"
              ref={contentRef}
              tabIndex={-1}
            >
              {/* Same typography variables the published site sets on its chrome, so
            the preview reads exactly like production. */}
              <article
                aria-busy={contentPending || undefined}
                className="mx-auto max-w-4xl px-5 py-7 sm:px-8 md:px-10 md:py-10"
                data-theme-region="article"
                dir={contentDir}
              >
                {contentPending ? (
                  // Shaped like the page header (address, title) and its first paragraphs.
                  <>
                    <p className="sr-only" role="status">
                      {t('common.loading')}
                    </p>
                    <div aria-hidden className="mb-8 flex flex-col gap-3 border-border border-b pb-5">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-9 w-64 max-w-full" />
                    </div>
                    <SkeletonText lines={4} />
                  </>
                ) : page ? (
                  <>
                    <div className="mb-8 border-border border-b pb-5">
                      {/* The page's web address (the title is the heading right below). */}
                      <div className="flex items-center gap-2 text-muted-foreground text-sm">
                        <PageIcon className="size-4 shrink-0" name={page.icon} />
                        <span className="min-w-0 truncate font-mono text-xs" dir="ltr">
                          /{page.path}
                        </span>
                      </div>
                      <h1 className="mt-2 font-semibold text-3xl tracking-tight" dir="auto">
                        {shownTitle(page)}
                      </h1>
                      {page.description ? <p className="mt-2 text-muted-foreground">{page.description}</p> : null}
                    </div>
                    <Markdown content={page.content} site={{ projectId, lang: activeLanguage?.code, version: activeBranchId }} />
                  </>
                ) : failedQuery ? (
                  <QueryErrorState onRetry={() => void failedQuery.refetch()} retrying={failedQuery.isFetching} />
                ) : (
                  <div className="text-muted-foreground text-sm">{t('preview.empty')}</div>
                )}
              </article>
            </div>
          }
        />
      </DocumentationThemeProvider>
    </div>
  );
}

const SKELETON_ROW_WIDTHS = ['w-full', 'w-10/12', 'w-8/12'];

/** Page-list rows while the list loads (the article announces the loading status). */
function PageListSkeleton({ rows }: { rows: number }) {
  return (
    <div aria-busy="true" className="space-y-2 p-2">
      {SKELETON_ROW_WIDTHS.slice(0, rows).map((width) => (
        <Skeleton aria-hidden className={cn('h-8', width)} key={width} />
      ))}
    </div>
  );
}

interface ScopeOption {
  value: string;
  label: ReactNode;
}

/** Branch / language picker for the preview scope. `items` is passed to the root so
 *  the trigger shows the option's label (Base UI renders the raw value otherwise). */
function ScopeSelect({
  ariaLabel,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  onChange: (value: string) => void;
  options: ScopeOption[];
  value: string | undefined;
}) {
  return (
    <Select
      items={options}
      onValueChange={(next) => {
        if (next) {
          onChange(next);
        }
      }}
      value={value ?? null}
    >
      <SelectTrigger aria-label={ariaLabel} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
