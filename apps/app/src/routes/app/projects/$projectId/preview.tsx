import { ScrollArea } from '@nibleaf/design-system/components/ui/scroll-area';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ChevronDown, Eye, FileText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { Markdown } from '@/components/markdown';
import { DocumentationProjectPreviewLayout, DocumentationThemeProvider } from '@/components/site/documentation-theme-provider';
import { PageIcon } from '@/components/site/page-icon';
import { useBranches, useLanguages, usePage, usePages, useProject } from '@/hooks/api';
import type { PageNode } from '@/hooks/api/types';
import { projectThemeStyle, projectThemeVariables, resolveProjectTheme } from '@/lib/site-theme';

export const Route = createFileRoute('/app/projects/$projectId/preview')({
  component: ProjectPreview,
  validateSearch: (search) =>
    z
      .object({
        branchId: z.string().min(1).optional().catch(undefined),
        languageId: z.string().min(1).optional().catch(undefined),
        pageId: z.string().min(1).optional().catch(undefined),
      })
      .parse(search),
});

const firstPage = (pages: PageNode[] | undefined): PageNode | undefined => pages?.find((page) => page.kind === 'PAGE' && !page.hidden);

function ProjectPreview() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const t = useT();
  const { data: project } = useProject(projectId);
  const { data: languages } = useLanguages(projectId);
  const { data: branches } = useBranches(projectId);
  const activeLanguageId = search.languageId ?? languages?.find((language) => language.isDefault)?.id ?? languages?.[0]?.id;
  const activeLanguage = languages?.find((language) => language.id === activeLanguageId);
  // Content direction follows the previewed language (Arabic → RTL), mirroring
  // the published site so authors preview real layout, not always-LTR.
  const contentDir = activeLanguage?.direction === 'RTL' ? 'rtl' : 'ltr';
  const activeBranchId = search.branchId ?? branches?.find((branch) => branch.isDefault)?.id ?? branches?.[0]?.id;
  const previewEnabled = project ? project.config?.addons?.previewDeployments !== false : false;
  const { data: pages, isPending: pagesPending } = usePages(previewEnabled ? projectId : undefined, activeLanguageId, activeBranchId);
  const selected = useMemo(() => pages?.find((page) => page.id === search.pageId) ?? firstPage(pages), [pages, search.pageId]);
  const { data: page, isPending: pagePending } = usePage(previewEnabled ? projectId : undefined, selected?.id);
  const contentPending = pagesPending || (Boolean(selected) && pagePending);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const theme = resolveProjectTheme(project?.config);
  const previewMode = project?.config?.styling?.theme === 'dark' ? 'dark' : 'light';

  const updateSearch = (patch: Partial<typeof search>) => {
    navigate({ search: (prev) => ({ ...prev, ...patch }) });
  };

  if (!previewEnabled) {
    return (
      <div className="mx-auto max-w-2xl px-8 py-12">
        <div className="mb-3 flex items-center gap-2 font-semibold text-lg">
          <Eye className="size-5 text-muted-foreground" /> {t('preview.title')}
        </div>
        <p className="text-muted-foreground text-sm">{t('preview.disabled')}</p>
      </div>
    );
  }

  return (
    <DocumentationThemeProvider
      appearance={previewMode}
      className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden"
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
                <span className="block truncate text-muted-foreground text-xs">{selected?.title ?? t('preview.empty')}</span>
              </span>
              <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', mobileNavigationOpen && 'rotate-180')} />
            </button>

            {mobileNavigationOpen ? (
              <div className="max-h-[min(55vh,28rem)] overflow-y-auto border-border border-t p-3" id="mobile-preview-navigation">
                <p className="mb-3 text-muted-foreground text-xs">{t('preview.description')}</p>
                <div className="mb-3 grid gap-2">
                  {branches && branches.length > 1 ? (
                    <select
                      aria-label={t('settings.git.productionBranch')}
                      className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                      onChange={(event) => updateSearch({ branchId: event.target.value, pageId: undefined })}
                      value={activeBranchId}
                    >
                      {branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {languages && languages.length > 1 ? (
                    <select
                      aria-label={t('editor.addLanguage.languageField')}
                      className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                      onChange={(event) => updateSearch({ languageId: event.target.value, pageId: undefined })}
                      value={activeLanguageId}
                    >
                      {languages.map((language) => (
                        <option key={language.id} value={language.id}>
                          {language.label}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
                {pagesPending ? (
                  <div className="space-y-2 p-2">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-10/12" />
                  </div>
                ) : null}
                {(pages ?? []).map((item) => (
                  <button
                    className={cn(
                      'mb-1 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-start text-sm transition-colors',
                      item.kind === 'GROUP' && 'font-semibold text-muted-foreground text-xs uppercase tracking-wide',
                      item.id === selected?.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      item.hidden && 'opacity-55',
                    )}
                    disabled={item.kind === 'GROUP'}
                    key={item.id}
                    onClick={() => {
                      updateSearch({ pageId: item.id });
                      setMobileNavigationOpen(false);
                    }}
                    style={{ paddingInlineStart: `${8 + item.path.split('/').length * 8}px` }}
                    type="button"
                  >
                    {item.kind === 'GROUP' ? <FileText className="size-3.5" /> : <PageIcon className="size-3.5" name={item.icon} />}
                    <span className="truncate">{item.title}</span>
                  </button>
                ))}
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
              <div className="mt-4 grid gap-2">
                {branches && branches.length > 1 ? (
                  <select
                    aria-label={t('settings.git.productionBranch')}
                    className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                    onChange={(event) => updateSearch({ branchId: event.target.value, pageId: undefined })}
                    value={activeBranchId}
                  >
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                ) : null}
                {languages && languages.length > 1 ? (
                  <select
                    aria-label={t('editor.addLanguage.languageField')}
                    className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                    onChange={(event) => updateSearch({ languageId: event.target.value, pageId: undefined })}
                    value={activeLanguageId}
                  >
                    {languages.map((language) => (
                      <option key={language.id} value={language.id}>
                        {language.label}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="p-3" data-theme-region="sidebar-content">
                {pagesPending ? (
                  <div className="space-y-2 p-2">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-10/12" />
                    <Skeleton className="h-8 w-8/12" />
                  </div>
                ) : null}
                {(pages ?? []).map((item) => (
                  <button
                    className={cn(
                      'mb-1 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm transition-colors',
                      item.kind === 'GROUP' && 'font-semibold text-muted-foreground text-xs uppercase tracking-wide',
                      item.id === selected?.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      item.hidden && 'opacity-55',
                    )}
                    disabled={item.kind === 'GROUP'}
                    key={item.id}
                    onClick={() => updateSearch({ pageId: item.id })}
                    style={{ paddingInlineStart: `${8 + item.path.split('/').length * 8}px` }}
                    type="button"
                  >
                    {item.kind === 'GROUP' ? <FileText className="size-3.5" /> : <PageIcon className="size-3.5" name={item.icon} />}
                    <span className="truncate">{item.title}</span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </>
        }
        content={
          <main className="min-h-0 flex-1 overflow-y-auto bg-background" data-theme-region="preview-main">
            {/* Same typography variables the published site sets on its chrome, so
            the preview reads exactly like production. */}
            <article className="mx-auto max-w-4xl px-5 py-7 sm:px-8 md:px-10 md:py-10" data-theme-region="article" dir={contentDir}>
              {contentPending ? (
                <div className="space-y-4">
                  <Skeleton className="h-8 w-64" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-10/12" />
                </div>
              ) : page ? (
                <>
                  <div className="mb-8 border-border border-b pb-5">
                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                      <PageIcon className="size-4" name={page.icon} />
                      {page.path || '/'}
                    </div>
                    <h1 className="mt-2 font-semibold text-3xl tracking-tight">{page.title}</h1>
                    {page.description ? <p className="mt-2 text-muted-foreground">{page.description}</p> : null}
                  </div>
                  <Markdown content={page.content} site={{ projectId, lang: activeLanguage?.code, version: activeBranchId }} />
                </>
              ) : (
                <div className="text-muted-foreground text-sm">{t('preview.empty')}</div>
              )}
            </article>
          </main>
        }
      />
    </DocumentationThemeProvider>
  );
}
