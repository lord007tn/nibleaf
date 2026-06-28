import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowRight,
  BarChart3,
  CreditCard,
  Eye,
  FileText,
  type LucideIcon,
  PenLine,
  Plug,
  Rocket,
  Settings as SettingsIcon,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { SectionCard } from '@/components/analytics/section-card';
import { ViewsAreaChart } from '@/components/analytics/views-area-chart';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { AnalyticsRange } from '@/hooks/api';
import { useAnalytics, useDeployments, usePages, useProject, useProjectMembers } from '@/hooks/api';
import { useFormatters, viewsTrend } from '@/lib/format';
import { useT } from '@/lib/i18n';

export const Route = createFileRoute('/app/projects/$projectId/')({
  component: SiteOverviewPage,
});

/** Per-site dashboard: the hub each site opens to (stats, traffic, recent pages,
 *  and quick links). The full-page editor lives at /editor. */
function SiteOverviewPage() {
  const { projectId } = Route.useParams();
  const t = useT();
  const navigate = useNavigate();
  const { date } = useFormatters();
  const [range, setRange] = useState<AnalyticsRange>('30d');
  const { data: project } = useProject(projectId);
  const { data: pages } = usePages(projectId);
  const { data: members } = useProjectMembers(projectId);
  const { data: deployments } = useDeployments(projectId);
  const { data: analytics, isPending: analyticsPending } = useAnalytics(projectId, range);

  const pageCount = (pages ?? []).filter((page) => page.kind !== 'GROUP').length;
  const memberCount = members?.members.length ?? 0;
  const deployCount = (deployments ?? []).length;
  const trend = useMemo(() => viewsTrend(analytics?.timeseries ?? []), [analytics?.timeseries]);
  const recentPages = useMemo(
    () =>
      (pages ?? [])
        .filter((p) => p.kind === 'PAGE')
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 6),
    [pages],
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">{project?.name ?? t('overview.title')}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{t('overview.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            nativeButton={false}
            render={
              // biome-ignore lint/a11y/useAnchorContent: content merged via Base UI render prop
              <a href={`/sites/${projectId}`} target="_blank" rel="noreferrer" aria-label={t('overview.viewSite')} />
            }
            size="sm"
            variant="outline"
          >
            <Eye className="size-3.5" /> {t('overview.viewSite')}
          </Button>
          <Button nativeButton={false} render={<Link params={{ projectId }} to="/app/projects/$projectId/editor" />} size="sm">
            <PenLine className="size-3.5" /> {t('overview.openEditor')}
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SectionCard label={t('overview.stats.pages')} value={pageCount} icon={<FileText className="size-4" />} />
        <SectionCard label={t('overview.stats.members')} value={memberCount} icon={<Users className="size-4" />} />
        <SectionCard label={t('overview.stats.deploys')} value={deployCount} icon={<Rocket className="size-4" />} />
        <SectionCard
          label={t('overview.stats.pageviews')}
          value={analytics?.totalViews ?? 0}
          icon={<BarChart3 className="size-4" />}
          trend={trend}
          hint={trend ? t('analytics.vsPrevious') : undefined}
          loading={analyticsPending}
        />
      </div>

      {/* Traffic chart */}
      <div className="mt-6">
        <ViewsAreaChart
          title={t('overview.viewsTitle')}
          description={t('overview.viewsDesc')}
          data={analytics?.timeseries ?? []}
          range={range}
          onRangeChange={setRange}
          loading={analyticsPending}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_320px]">
        {/* Recent pages */}
        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-border border-b px-5 py-3.5">
            <h2 className="font-semibold text-sm">{t('overview.recentPages')}</h2>
            <Link
              className="flex items-center gap-1 text-primary text-xs hover:underline"
              params={{ projectId }}
              to="/app/projects/$projectId/editor"
            >
              {t('overview.openEditor')} <ArrowRight className="size-3 rtl:-scale-x-100" />
            </Link>
          </div>
          {recentPages.length === 0 ? (
            <p className="px-5 py-8 text-center text-muted-foreground text-sm">{t('overview.noPages')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('overview.col.page')}</TableHead>
                  <TableHead className="text-end">{t('overview.col.updated')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentPages.map((page) => (
                  <TableRow
                    key={page.id}
                    className="cursor-pointer"
                    onClick={() => navigate({ to: '/app/projects/$projectId/editor', params: { projectId } })}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium">{page.config?.sidebarTitle?.trim() || page.title}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-end text-muted-foreground text-xs">{date(page.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Manage quick links */}
        <div className="flex flex-col gap-3">
          <h2 className="font-semibold text-sm">{t('overview.manage')}</h2>
          <ManageRow icon={BarChart3} title={t('overview.link.analytics')} desc={t('overview.link.analyticsDesc')}>
            <Link className="absolute inset-0" params={{ projectId }} to="/app/projects/$projectId/analytics" />
          </ManageRow>
          <ManageRow icon={Users} title={t('overview.link.members')} desc={t('overview.link.membersDesc')}>
            <Link className="absolute inset-0" params={{ projectId }} search={{ section: 'members' }} to="/app/projects/$projectId/settings" />
          </ManageRow>
          <ManageRow icon={Plug} title={t('overview.link.integrations')} desc={t('overview.link.integrationsDesc')}>
            <Link className="absolute inset-0" params={{ projectId }} search={{ section: 'integrations' }} to="/app/projects/$projectId/settings" />
          </ManageRow>
          <ManageRow icon={CreditCard} title={t('overview.link.billing')} desc={t('overview.link.billingDesc')}>
            <Link className="absolute inset-0" params={{ projectId }} search={{ section: 'billing' }} to="/app/projects/$projectId/settings" />
          </ManageRow>
          <ManageRow icon={SettingsIcon} title={t('overview.link.settings')} desc={t('overview.link.settingsDesc')}>
            <Link className="absolute inset-0" params={{ projectId }} search={{ section: 'general' }} to="/app/projects/$projectId/settings" />
          </ManageRow>
        </div>
      </div>
    </div>
  );
}

function ManageRow({ icon: Icon, title, desc, children }: { icon: LucideIcon; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="relative flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 transition-colors hover:bg-muted/40">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 leading-snug">
        <div className="font-medium text-sm">{title}</div>
        <div className="mt-0.5 text-muted-foreground text-xs">{desc}</div>
      </div>
      {children}
    </div>
  );
}
