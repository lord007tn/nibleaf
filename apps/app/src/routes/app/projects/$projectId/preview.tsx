import { ScrollArea } from '@nibleaf/design-system/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ChevronDown, Eye, FileText } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
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
                <div className="mb-3 grid gap-2">{scopeSelects}</div>
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
              <div className="mt-4 grid gap-2">{scopeSelects}</div>
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
