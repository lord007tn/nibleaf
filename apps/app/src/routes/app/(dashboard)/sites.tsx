import { NibleafMark } from '@nibleaf/design-system/brand';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowUpRight, BarChart3, BookText, FileText, Plus, Search, SearchX } from 'lucide-react';
import { useId, useMemo, useState, useSyncExternalStore } from 'react';
import { EmptyState } from '@/components/app/empty-state';
import { NewProjectDialog } from '@/components/app/new-project-dialog';
import { PageHeader } from '@/components/app/page-header';
import { SiteStatusBadge } from '@/components/app/site-status';
import { QueryErrorState } from '@/components/query-error-state';
import { useProjects, useWorkspaceAnalytics } from '@/hooks/api';
import { projectsQueryOptions } from '@/hooks/api/query-options';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { useFormatters } from '@/lib/format';

export const Route = createFileRoute('/app/(dashboard)/sites')({
  validateSearch: (search: Record<string, unknown>): { newSite?: boolean } =>
    search.newSite === true || search.newSite === 'true' ? { newSite: true } : {},
  loader: ({ context: { queryClient } }) => prefetchRouteData(queryClient, projectsQueryOptions()),
  component: SitesPage,
});

const subscribeToHydration = () => () => undefined;
const SITE_SKELETON_CARDS = ['a', 'b', 'c'];
/** Views on the cards cover the same window as the overview's default. */
const VIEWS_RANGE = '30d';

const SORTS = ['updated', 'name', 'views'] as const;
type Sort = (typeof SORTS)[number];

function SitesPage() {
  const { newSite } = Route.useSearch();
  const navigate = useNavigate();
  const { data: projects, isPending, isError, isFetching, refetch } = useProjects();
  // Optional context on each card; the list never waits for it.
  const analytics = useWorkspaceAnalytics(VIEWS_RANGE);
  // The shared project query can resolve before this streamed route hydrates.
  // Match the server's loading tree before exposing its cached client result.
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('updated');
  const sortId = useId();
  const t = useT();
  const { count, number, relativeTime } = useFormatters();
  // The dialog follows the URL (?newSite=true), so the palette and the site
  // switcher can open it again while this page is already showing.
  const setCreateOpen = (open: boolean) =>
    void navigate({ to: '.', search: (prev) => ({ ...prev, newSite: open ? true : undefined }), replace: !open });

  const viewsAvailable = analytics.isSuccess && analytics.data?.availability !== 'unavailable';
  const viewsById = useMemo(() => new Map((analytics.data?.byProject ?? []).map((row) => [row.projectId, row.views])), [analytics.data]);
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const list = normalized
      ? (projects ?? []).filter((project) => `${project.name} ${project.slug}`.toLowerCase().includes(normalized))
      : [...(projects ?? [])];
    // The server already returns the most recently updated first.
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'views') list.sort((a, b) => (viewsById.get(b.id) ?? 0) - (viewsById.get(a.id) ?? 0));
    return list;
  }, [projects, query, sort, viewsById]);
  const sortItems = SORTS.map((value) => ({ value, label: t(`sites.sort.${value}`) }));
  // After hydration only: the server renders the loading tree, so the toolbar must not appear from cache first.
  const hasSites = hydrated && (projects?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> {t('dashboard.newProject')}
          </Button>
        }
        description={t('sites.subtitle')}
        title={t('project.allSites')}
      />
      {hasSites ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 basis-60 sm:max-w-md">
            <Search aria-hidden className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label={t('dashboard.search.placeholder')}
              className="ps-9"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('dashboard.search.placeholder')}
              type="search"
              value={query}
            />
          </div>
          <div className="flex items-center gap-2">
            <Label className="whitespace-nowrap text-muted-foreground text-sm" htmlFor={sortId}>
              {t('sites.sort.label')}
            </Label>
            <Select items={sortItems} onValueChange={(value) => value && setSort(value as Sort)} value={sort}>
              <SelectTrigger className="w-44" id={sortId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sortItems.map((item) => (
                  <SelectItem disabled={item.value === 'views' && !viewsAvailable} key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}
      {hydrated && isError ? <QueryErrorState onRetry={() => void refetch()} retrying={isFetching} /> : null}
      {!hydrated || isPending ? (
        <div aria-busy="true" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <p className="sr-only" role="status">
            {t('common.loading')}
          </p>
          {/* Shaped like a site card: mark, name, address, status, then the facts row. */}
          {SITE_SKELETON_CARDS.map((card) => (
            <div aria-hidden className="rounded-xl border border-border bg-card p-5" key={card}>
              <div className="flex items-start gap-3">
                <Skeleton className="size-11 shrink-0 rounded-xl" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
                  <Skeleton className="h-5 w-3/5" />
                  <Skeleton className="h-3 w-2/5" />
                </div>
              </div>
              <Skeleton className="mt-4 h-5 w-20 rounded-full" />
              <Skeleton className="mt-5 h-4 w-40" />
            </div>
          ))}
        </div>
      ) : isError && !projects ? null : visible.length ? (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((project) => (
            <li key={project.id}>
              {/* A real link: middle-click, open in a new tab and copy link all work, and it is announced as a link. */}
              <Link
                params={{ projectId: project.id }}
                to="/app/projects/$projectId"
                className="group flex h-full flex-col rounded-xl border border-border bg-card p-5 text-start outline-none transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <div className="flex items-start gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-muted/50">
                    <NibleafMark className="size-7" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      <bdi>{project.name}</bdi>
                    </span>
                    <span className="block truncate font-mono text-muted-foreground text-xs">
                      <bdi dir="ltr">/{project.slug}</bdi>
                    </span>
                  </span>
                  <ArrowUpRight
                    aria-hidden
                    className="size-4.5 shrink-0 text-muted-foreground transition group-hover:text-primary rtl:-scale-x-100"
                  />
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
                  <SiteStatusBadge site={project} />
                  {project.lastPublishedAt ? <span>{t('sites.lastPublished', { when: relativeTime(project.lastPublishedAt) })}</span> : null}
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-5 text-muted-foreground text-sm">
                  <span className="flex items-center gap-1.5">
                    <FileText aria-hidden className="size-4" /> {t('dashboard.pages', count(project._count?.pages ?? 0))}
                  </span>
                  {viewsAvailable ? (
                    <span className="flex items-center gap-1.5">
                      <BarChart3 aria-hidden className="size-4" />
                      {t('sites.views30d', { count: number(viewsById.get(project.id) ?? 0) })}
                    </span>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : query.trim() ? (
        <EmptyState
          action={
            <Button onClick={() => setQuery('')} variant="outline">
              {t('dashboard.search.clear')}
            </Button>
          }
          framed
          icon={<SearchX />}
          title={t('dashboard.search.noResults')}
        />
      ) : (
        <EmptyState
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> {t('dashboard.empty.cta')}
            </Button>
          }
          description={t('dashboard.empty.body')}
          framed
          icon={<BookText />}
          title={t('dashboard.empty.title')}
        />
      )}
      <NewProjectDialog open={Boolean(newSite)} onOpenChange={setCreateOpen} />
    </div>
  );
}
