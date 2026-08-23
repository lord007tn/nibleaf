import { Button } from '@nibleaf/design-system/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nibleaf/design-system/components/ui/table';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowRight,
  BarChart3,
  CreditCard,
  Eye,
  FileText,
  Globe2,
  Link2Off,
  Loader2,
  type LucideIcon,
  PenLine,
  Plug,
  Rocket,
  Settings as SettingsIcon,
  SpellCheck,
  TriangleAlert,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { SectionCard } from '@/components/analytics/section-card';
import { ViewsAreaChart } from '@/components/analytics/views-area-chart';
import { env } from '@/env';
import type { AnalyticsRange, Deployment } from '@/hooks/api';
import { useDeployments, useDomains, usePages, useProject, useProjectMembers, usePublishAnyway } from '@/hooks/api';
import { useProjectAnalytics } from '@/hooks/api/analytics';
import { useFormatters, viewsTrend } from '@/lib/format';

export const Route = createFileRoute('/app/projects/$projectId/')({
  component: SiteOverviewPage,
});

// Only present a `slug.<base>` free-subdomain host when a base domain is actually
// configured for this deployment; otherwise it 404s, so we fall back to /sites/:id.
const siteBaseDomain = () => env.VITE_SITE_BASE_DOMAIN?.replace(/^\*\./, '').replace(/\.$/, '') || undefined;
const siteUrl = (domain: string | null, projectId: string) => (domain ? `https://${domain}` : `/sites/${projectId}`);

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
  const { data: domains } = useDomains(projectId);
  const { data: analytics, isPending: analyticsPending } = useProjectAnalytics(projectId, range);

  const pageCount = (pages ?? []).filter((page) => page.kind !== 'GROUP').length;
  const memberCount = members?.members.length ?? 0;
  const deployCount = (deployments ?? []).length;
  const latestDeployment = deployments?.[0];
  const hasReadyDeployment = (deployments ?? []).some((deployment) => deployment.status === 'READY');
  const publishFailed = latestDeployment?.status === 'FAILED';
  const primaryDomain = domains?.find((domain) => domain.isPrimary && domain.verified) ?? domains?.find((domain) => domain.verified);
  const baseDomain = siteBaseDomain();
  // Prefer a verified custom domain; else a configured free-subdomain host; else
  // the always-working internal /sites/:id path (never a hardcoded fake host).
  const liveDomain = primaryDomain?.domain ?? (project && baseDomain ? `${project.slug}.${baseDomain}` : null);
  const liveHref = siteUrl(liveDomain, projectId);
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
    <div className="w-full px-6 py-8 xl:px-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">{project?.name ?? t('overview.title')}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{t('overview.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            nativeButton={false}
            render={<a href={liveHref} target="_blank" rel="noreferrer" aria-label={t('overview.viewSite')} />}
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

      {/* Publish-failure triage: what blocked the last publish, with per-page
          links into the editor and a grammar-only "Publish anyway" escape hatch. */}
      {publishFailed && latestDeployment ? <PublishFailureCard projectId={projectId} deployment={latestDeployment} pages={pages ?? []} /> : null}

      {/* First-publish nudge: shown until the site has one READY deployment.
          Hidden while the latest attempt is FAILED (the failure card leads). */}
      {deployments && !hasReadyDeployment && !publishFailed ? <PublishNudge projectId={projectId} /> : null}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.4fr]">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
              <Globe2 className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="font-semibold text-sm">{t('overview.live.title')}</div>
              <a className="truncate font-mono text-primary text-sm hover:underline" href={liveHref} target="_blank" rel="noreferrer">
                {liveDomain ?? liveHref}
              </a>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-semibold text-sm">{t('overview.activity.title')}</h2>
            {latestDeployment ? (
              <span className="rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-primary text-xs">{latestDeployment.status}</span>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            {(deployments ?? []).slice(0, 3).map((deployment) => (
              <div className="flex items-center justify-between gap-3 text-sm" key={deployment.id}>
                <div className="min-w-0 truncate">
                  <span className="font-medium">v{deployment.version}</span>
                  <span className="ms-2 text-muted-foreground">{deployment.commitMessage || t('overview.activity.publish')}</span>
                </div>
                <span className="shrink-0 text-muted-foreground text-xs">{date(deployment.completedAt ?? deployment.createdAt)}</span>
              </div>
            ))}
            {(deployments ?? []).length === 0 ? <p className="text-muted-foreground text-sm">{t('overview.activity.empty')}</p> : null}
          </div>
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
            <Link className="absolute inset-0" params={{ projectId }} search={{ section: 'plan' }} to="/app/projects/$projectId/settings" />
          </ManageRow>
          <ManageRow icon={SettingsIcon} title={t('overview.link.settings')} desc={t('overview.link.settingsDesc')}>
            <Link className="absolute inset-0" params={{ projectId }} search={{ section: 'general' }} to="/app/projects/$projectId/settings" />
          </ManageRow>
        </div>
      </div>
    </div>
  );
}

const publishIssuesOf = (deployment: Deployment) => {
  const details = (deployment as Deployment & { errorDetails?: unknown }).errorDetails;
  if (!Array.isArray(details)) {
    return [];
  }
  return details.flatMap((issue) => {
    const parsed = z
      .object({
        type: z.enum(['broken-link', 'grammar']),
        pageTitle: z.string(),
        pagePath: z.string(),
        detail: z.string(),
      })
      .safeParse(issue);
    return parsed.success ? [parsed.data] : [];
  });
};

/** Why the last publish failed: the structured check issues, each linking into
 *  the editor, plus "Publish anyway" when only the grammar linter is blocking. */
function PublishFailureCard({
  projectId,
  deployment,
  pages,
}: {
  projectId: string;
  deployment: Deployment;
  pages: Array<{ id: string; path: string }>;
}) {
  const t = useT();
  const issues = publishIssuesOf(deployment);
  const grammarOnly = issues.length > 0 && issues.every((issue) => issue.type === 'grammar');

  const publishAnyway = usePublishAnyway(projectId);
  const publishAnywayWithFeedback = () => {
    publishAnyway.mutate(undefined, {
      onSuccess: () => {
        toast.success(t('overview.publishFailed.queued'));
      },
      onError: (error) => toast.error(error instanceof Error ? error.message : t('overview.publishFailed.error')),
    });
  };

  // Map a check issue's page path back to the draft page, for an editor deep link.
  const pageIdFor = (issuePath: string): string | undefined => {
    const clean = issuePath.replace(/^\/+/, '');
    return pages.find((page) => page.path === clean)?.id;
  };

  return (
    <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive">
          <TriangleAlert className="size-4" />
        </span>
        <div className="min-w-0 flex-1 leading-snug">
          <div className="font-semibold text-sm">{t('overview.publishFailed.title', { version: deployment.version })}</div>
          <p className="mt-0.5 text-muted-foreground text-sm">
            {grammarOnly ? t('overview.publishFailed.grammarOnly') : t('overview.publishFailed.body')}
          </p>
        </div>
        {grammarOnly ? (
          <Button size="sm" disabled={publishAnyway.isPending} onClick={publishAnywayWithFeedback}>
            {publishAnyway.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />}
            {publishAnyway.isPending ? t('overview.publishFailed.publishing') : t('overview.publishFailed.publishAnyway')}
          </Button>
        ) : null}
      </div>
      {issues.length > 0 ? (
        <ul className="divide-y divide-border border-border border-t">
          {issues.map((issue) => {
            const pageId = pageIdFor(issue.pagePath);
            return (
              <li key={`${issue.type}-${issue.pagePath}-${issue.detail}`} className="flex items-start gap-3 px-5 py-2.5 text-sm">
                <span className="mt-0.5 shrink-0 text-muted-foreground">
                  {issue.type === 'broken-link' ? <Link2Off className="size-3.5" /> : <SpellCheck className="size-3.5" />}
                </span>
                <div className="min-w-0 flex-1 leading-snug">
                  {pageId ? (
                    <Link
                      className="font-medium hover:underline"
                      to="/app/projects/$projectId/editor"
                      params={{ projectId }}
                      search={{ page: pageId }}
                    >
                      {issue.pageTitle || issue.pagePath}
                    </Link>
                  ) : (
                    <span className="font-medium">{issue.pageTitle || issue.pagePath}</span>
                  )}
                  <span className="ms-2 text-muted-foreground">{issue.detail}</span>
                </div>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-medium text-[10.5px] text-muted-foreground uppercase tracking-wide">
                  {issue.type === 'broken-link' ? t('overview.publishFailed.type.brokenLink') : t('overview.publishFailed.type.grammar')}
                </span>
              </li>
            );
          })}
        </ul>
      ) : deployment.error ? (
        <p className="border-border border-t px-5 py-3 text-muted-foreground text-sm">{deployment.error}</p>
      ) : null}
    </div>
  );
}

const nudgeDismissKey = (projectId: string) => `nibleaf.publishNudge.${projectId}`;

/** First-publish checklist: shown until the site has a READY deployment. */
function PublishNudge({ projectId }: { projectId: string }) {
  const t = useT();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(nudgeDismissKey(projectId)) === '1');
    } catch {
      setDismissed(false);
    }
  }, [projectId]);
  if (dismissed) {
    return null;
  }
  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(nudgeDismissKey(projectId), '1');
    } catch {
      // ignore storage failures (private mode etc.)
    }
  };

  return (
    <div className="relative mt-6 rounded-xl border border-primary/30 bg-primary/5 p-5">
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('overview.nudge.dismiss')}
        title={t('overview.nudge.dismiss')}
        className="absolute end-3 top-3 cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-4" />
      </button>
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Rocket className="size-4" />
        </span>
        <div className="leading-snug">
          <div className="font-semibold text-sm">{t('overview.nudge.title')}</div>
          <p className="mt-0.5 text-muted-foreground text-sm">{t('overview.nudge.body')}</p>
        </div>
      </div>
      <ol className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <NudgeStep n={1} title={t('overview.nudge.step1')} desc={t('overview.nudge.step1Desc')}>
          <Link className="absolute inset-0" aria-label={t('overview.nudge.step1')} to="/app/projects/$projectId/editor" params={{ projectId }} />
        </NudgeStep>
        <NudgeStep n={2} title={t('overview.nudge.step2')} desc={t('overview.nudge.step2Desc')}>
          <Link
            className="absolute inset-0"
            aria-label={t('overview.nudge.step2')}
            to="/app/projects/$projectId/editor"
            params={{ projectId }}
            search={{ publish: true }}
          />
        </NudgeStep>
        <NudgeStep n={3} title={t('overview.nudge.step3')} desc={t('overview.nudge.step3Desc')}>
          <Link
            className="absolute inset-0"
            aria-label={t('overview.nudge.step3')}
            to="/app/projects/$projectId/settings"
            params={{ projectId }}
            search={{ section: 'domain' }}
          />
        </NudgeStep>
      </ol>
    </div>
  );
}

function NudgeStep({ n, title, desc, children }: { n: number; title: string; desc: string; children: React.ReactNode }) {
  return (
    <li className="relative flex items-start gap-3 rounded-lg border border-border bg-card p-3.5 transition-colors hover:bg-muted/40">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 font-semibold text-[12px] text-primary">{n}</span>
      <div className="min-w-0 leading-snug">
        <div className="font-medium text-sm">{title}</div>
        <div className="mt-0.5 text-muted-foreground text-xs">{desc}</div>
      </div>
      {children}
    </li>
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
