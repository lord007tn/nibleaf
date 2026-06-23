import { createFileRoute, Link } from '@tanstack/react-router';
import { BarChart3, CreditCard, Eye, FileText, type LucideIcon, PenLine, Plug, Rocket, Settings as SettingsIcon, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { StatCard } from '@/components/analytics/stat-card';
import { Button } from '@/components/ui/button';
import { useAnalytics, useDeployments, usePages, useProject, useProjectMembers } from '@/hooks/api';
import { useT } from '@/lib/i18n';

export const Route = createFileRoute('/app/projects/$projectId/')({
  component: SiteOverviewPage,
});

/** Per-site dashboard: the hub each site opens to (stats + quick links). The
 *  full-page editor lives at /editor; everything else hangs off here. */
function SiteOverviewPage() {
  const { projectId } = Route.useParams();
  const t = useT();
  const { data: project } = useProject(projectId);
  const { data: pages } = usePages(projectId);
  const { data: members } = useProjectMembers(projectId);
  const { data: deployments } = useDeployments(projectId);
  const { data: analytics } = useAnalytics(projectId, '30d');

  const pageCount = (pages ?? []).filter((page) => page.kind !== 'GROUP').length;
  const memberCount = members?.members.length ?? 0;
  const deployCount = (deployments ?? []).length;
  const views = analytics?.totalViews ?? 0;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">{project?.name ?? t('overview.title')}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{t('overview.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            render={
              // biome-ignore lint/a11y/useAnchorContent: content merged via Base UI render prop
              <a href={`/sites/${projectId}`} target="_blank" rel="noreferrer" aria-label={t('overview.viewSite')} />
            }
            size="sm"
            variant="outline"
          >
            <Eye className="size-3.5" /> {t('overview.viewSite')}
          </Button>
          <Button render={<Link params={{ projectId }} to="/app/projects/$projectId/editor" />} size="sm">
            <PenLine className="size-3.5" /> {t('overview.openEditor')}
          </Button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={<FileText className="size-4" />} label={t('overview.stats.pages')} value={pageCount} />
        <StatCard icon={<Users className="size-4" />} label={t('overview.stats.members')} value={memberCount} />
        <StatCard icon={<Rocket className="size-4" />} label={t('overview.stats.deploys')} value={deployCount} />
        <StatCard icon={<BarChart3 className="size-4" />} label={t('overview.stats.pageviews')} value={views} />
      </div>

      <h2 className="mt-8 mb-3 font-semibold text-sm">{t('overview.manage')}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ManageCard icon={PenLine} title={t('overview.link.editor')} desc={t('overview.link.editorDesc')}>
          <Link className="absolute inset-0" params={{ projectId }} to="/app/projects/$projectId/editor" />
        </ManageCard>
        <ManageCard icon={BarChart3} title={t('overview.link.analytics')} desc={t('overview.link.analyticsDesc')}>
          <Link className="absolute inset-0" params={{ projectId }} to="/app/projects/$projectId/analytics" />
        </ManageCard>
        <ManageCard icon={Users} title={t('overview.link.members')} desc={t('overview.link.membersDesc')}>
          <Link className="absolute inset-0" params={{ projectId }} search={{ section: 'members' }} to="/app/projects/$projectId/settings" />
        </ManageCard>
        <ManageCard icon={CreditCard} title={t('overview.link.billing')} desc={t('overview.link.billingDesc')}>
          <Link className="absolute inset-0" params={{ projectId }} search={{ section: 'billing' }} to="/app/projects/$projectId/settings" />
        </ManageCard>
        <ManageCard icon={Plug} title={t('overview.link.integrations')} desc={t('overview.link.integrationsDesc')}>
          <Link className="absolute inset-0" params={{ projectId }} search={{ section: 'integrations' }} to="/app/projects/$projectId/settings" />
        </ManageCard>
        <ManageCard icon={SettingsIcon} title={t('overview.link.settings')} desc={t('overview.link.settingsDesc')}>
          <Link className="absolute inset-0" params={{ projectId }} search={{ section: 'general' }} to="/app/projects/$projectId/settings" />
        </ManageCard>
      </div>
    </div>
  );
}

function ManageCard({ icon: Icon, title, desc, children }: { icon: LucideIcon; title: string; desc: string; children: ReactNode }) {
  return (
    <div className="relative flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/40">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4.5" />
      </span>
      <div className="min-w-0 leading-snug">
        <div className="font-medium text-sm">{title}</div>
        <div className="mt-0.5 text-muted-foreground text-xs">{desc}</div>
      </div>
      {children}
    </div>
  );
}
