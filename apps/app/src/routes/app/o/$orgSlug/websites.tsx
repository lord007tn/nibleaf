import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useLocale, useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowUpRight, BarChart3, BookText, FileText, Lock, Plus, Search } from 'lucide-react';
import { useId, useMemo, useState, useSyncExternalStore } from 'react';
import { EmptyState } from '@/components/app/empty-state';
import { NewProjectDialog } from '@/components/app/new-project-dialog';
import { WebsiteMark } from '@/components/app/org-switcher/website-mark';
import { PageHeader } from '@/components/app/page-header';
import { SiteStatusBadge } from '@/components/app/site-status';
import {
  NO_REQUESTS,
  readStartHereDismissed,
  StartHere,
  startHereDismissedKey,
  subscribeToHydration,
  useStartHereActivity,
} from '@/components/app/start-here';
import { isOrgAdmin, useCurrentOrganization } from '@/components/organization/organization-context';
import { QueryErrorState } from '@/components/query-error-state';
import { useOrgInvitations } from '@/features/people/api/hooks';
import { type SiteRole, useOrganizationAnalytics, useOrganizationMembers, useOrganizationProjects } from '@/hooks/api';
import { analyticsTimezone } from '@/hooks/api/analytics/query-options';
import { organizationKeys } from '@/hooks/api/organization-keys';
import { organizationAnalyticsQueryOptions, organizationProjectsQueryOptions } from '@/hooks/api/organization-query-options';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { useFormatters } from '@/lib/format';
import { roleLabelKey } from '@/lib/member-roles';
import { startHereProgress, startHereRequests } from '@/lib/start-here';
import { useSession } from '@/services/auth-client';

const SITE_SKELETON_CARDS = ['a', 'b', 'c'];
const VIEWS_RANGE = '30d';
const SORTS = ['updated', 'name', 'views'] as const;
type Sort = (typeof SORTS)[number];

export const Route = createFileRoute('/app/o/$orgSlug/websites')({
  validateSearch: (search: Record<string, unknown>): { newSite?: boolean } =>
    search.newSite === true || search.newSite === 'true' ? { newSite: true } : {},
  loader: ({ context: { queryClient }, params: { orgSlug } }) => {
    // The org id comes from the layout's by-slug read; prefetch once it is cached (hover → click).
    const organization = queryClient.getQueryData<{ id: string }>(organizationKeys.organizations.bySlug(orgSlug));
    if (!organization) return;
    prefetchRouteData(queryClient, organizationProjectsQueryOptions(organization.id));
    prefetchRouteData(queryClient, organizationAnalyticsQueryOptions(organization.id, VIEWS_RANGE, analyticsTimezone()));
  },
  component: WebsitesPage,
});

/** The organization's Websites (§5.1): every website you can open, the first-run checklist, and New website for Owner/Admin. */
function WebsitesPage() {
  const organization = useCurrentOrganization();
  const { newSite } = Route.useSearch();
  const navigate = useNavigate();
  const t = useT();
  const { locale } = useLocale();
  const { count, dateTime, number, relativeTime } = useFormatters();
  const canCreate = organization.canCreateWebsite;
  const admin = isOrgAdmin(organization);
  const projects = useOrganizationProjects(organization.id, { pollWhilePublishing: true });
  const analytics = useOrganizationAnalytics(organization.id, VIEWS_RANGE, analyticsTimezone());
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('updated');
  const sortId = useId();
  const setCreateOpen = (open: boolean) =>
    void navigate({ to: '.', search: (prev) => ({ ...prev, newSite: open && canCreate ? true : undefined }), replace: !open });

  // First-run checklist, moved here from the old overview: about the newest website you can edit.
  const { data: session } = useSession();
  const dismissedKey = startHereDismissedKey(session?.user?.id);
  const storedDismissed = useSyncExternalStore(
    subscribeToHydration,
    () => readStartHereDismissed(dismissedKey),
    () => true,
  );
  const [dismissedNow, setDismissedNow] = useState(false);
  const dismissed = storedDismissed || dismissedNow || !canCreate;
  const siteList = useMemo(() => projects.data ?? [], [projects.data]);
  // Invited counts across the organization, not the newest website (WORKSPACE-13). Only Owner/Admins see the checklist.
  const orgMembers = useOrganizationMembers(dismissed ? undefined : organization.id);
  const orgInvitations = useOrgInvitations(dismissed ? undefined : organization.id);
  const teamSize = orgMembers.data && orgInvitations.data ? orgMembers.data.length + orgInvitations.data.length : undefined;
  const requests = useMemo(() => (dismissed ? NO_REQUESTS : startHereRequests(siteList)), [dismissed, siteList]);
  const activity = useStartHereActivity(requests.deploymentSiteIds, requests.pageSiteIds);
  const progress = startHereProgress(siteList, teamSize, activity);
  const showStartHere = hydrated && siteList.length > 0 && !projects.isError && progress.known && progress.done < progress.total && !dismissed;
  const dismissStartHere = () => {
    setDismissedNow(true);
    if (!dismissedKey) return;
    try {
      window.localStorage.setItem(dismissedKey, '1');
    } catch {
      // Storage can be unavailable (private mode); the card stays hidden for this visit.
    }
  };

  const viewsAvailable = analytics.isSuccess && analytics.data?.availability !== 'unavailable';
  const viewsById = useMemo(() => new Map((analytics.data?.byProject ?? []).map((row) => [row.projectId, row.views])), [analytics.data]);
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale);
    const list = normalized
      ? siteList.filter((project) => `${project.name} ${project.slug} ${project.domain ?? ''}`.toLocaleLowerCase(locale).includes(normalized))
      : [...siteList];
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, locale));
    if (sort === 'views') list.sort((a, b) => (viewsById.get(b.id) ?? 0) - (viewsById.get(a.id) ?? 0));
    return list;
  }, [siteList, query, sort, viewsById, locale]);
  const sortItems = SORTS.map((value) => ({ value, label: t(`sites.sort.${value}`) }));
  const loading = !hydrated || projects.isPending;
  const hasSites = !loading && siteList.length > 0;
  const administrators = (organization.administrators ?? []).map((person) => person.name).filter(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> {t('organization.websites.new')}
            </Button>
          ) : null
        }
        description={t('organization.websites.subtitle', { org: organization.name })}
        title={t('nav.websites')}
      />
      {showStartHere ? (
        <StartHere onCreateSite={() => setCreateOpen(true)} onDismiss={dismissStartHere} orgSlug={organization.slug} progress={progress} />
      ) : null}
      {hasSites ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 basis-60 sm:max-w-md">
            <Search aria-hidden className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label={t('organization.websites.search')}
              className="ps-9"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('organization.websites.search')}
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
      {hydrated && projects.isError ? <QueryErrorState onRetry={() => void projects.refetch()} retrying={projects.isFetching} /> : null}
      {loading ? (
        <div aria-busy="true" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <p className="sr-only" role="status">
            {t('common.loading')}
          </p>
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
      ) : projects.isError && !projects.data ? null : visible.length ? (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((project) => (
            <li key={project.id}>
              <Link
                className="group flex h-full flex-col rounded-xl border border-border bg-card p-5 text-start outline-none transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                params={{ projectId: project.id }}
                to="/app/projects/$projectId"
              >
                <div className="flex items-start gap-3">
                  <WebsiteMark className="size-11 rounded-xl text-xl" icon={project.icon} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      <bdi>{project.name}</bdi>
                    </span>
                    <span className="block truncate font-mono text-muted-foreground text-xs">
                      <bdi dir="ltr">{project.domain ?? `/${project.slug}`}</bdi>
                    </span>
                  </span>
                  <ArrowUpRight
                    aria-hidden
                    className="size-4.5 shrink-0 text-muted-foreground transition group-hover:text-primary rtl:-scale-x-100"
                  />
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
                  <SiteStatusBadge site={project} />
                  {/* Members see their role on each website; Owner/Admin have access to all of them. */}
                  {!admin ? <RoleBadge role={project.role} /> : null}
                  {project.lastPublishedAt ? (
                    <time dateTime={project.lastPublishedAt} title={dateTime(project.lastPublishedAt)}>
                      {t('sites.lastPublished', { when: relativeTime(project.lastPublishedAt) })}
                    </time>
                  ) : null}
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
          icon={<Search />}
          title={t('dashboard.search.noResults')}
        />
      ) : canCreate ? (
        <EmptyState
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> {t('organization.websites.createFirst')}
            </Button>
          }
          description={t('organization.websites.emptyAdmin', { org: organization.name })}
          framed
          icon={<BookText />}
          title={t('organization.websites.emptyAdminTitle')}
        />
      ) : (
        <EmptyState
          description={
            administrators.length > 0
              ? t('organization.websites.emptyMemberAsk', { names: administrators.join(t('organization.websites.nameSeparator')) })
              : undefined
          }
          framed
          icon={<Lock />}
          title={t('organization.websites.emptyMember', { org: organization.name })}
        />
      )}
      {canCreate ? (
        <NewProjectDialog
          onOpenChange={setCreateOpen}
          open={Boolean(newSite)}
          organizationId={organization.id}
          organizationName={organization.name}
        />
      ) : null}
    </div>
  );
}

function RoleBadge({ role }: { role: SiteRole }) {
  const t = useT();
  return (
    <Badge className="font-normal" data-role={role} variant="secondary">
      {t(roleLabelKey(role))}
    </Badge>
  );
}
