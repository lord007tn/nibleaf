import { Alert, AlertDescription, AlertTitle } from '@nibleaf/design-system/components/ui/alert';
import { Badge } from '@nibleaf/design-system/components/ui/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@nibleaf/design-system/components/ui/breadcrumb';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@nibleaf/design-system/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nibleaf/design-system/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@nibleaf/design-system/components/ui/tabs';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Activity, Database, ExternalLink, FileText, Globe2, LockKeyhole, Rocket, TriangleAlert, Users } from 'lucide-react';
import { z } from 'zod';
import { DataEmpty, DataError } from '@/components/data-state';
import { StatusBadge } from '@/components/status-badge';
import { SupportAccessDialog } from '@/components/support-access-dialog';
import { useAdminSite } from '@/hooks/api/queries';
import { fmtBytes, fmtDateTime, fmtRelative, useFormatters } from '@/lib/format';
import { APP_URL } from '@/lib/links';

export const Route = createFileRoute('/(dashboard)/sites/$siteId')({
  component: SiteDetailPage,
  validateSearch: (search) =>
    z.object({ tab: z.enum(['overview', 'deployments', 'domains', 'access', 'activity']).optional().catch(undefined) }).parse(search),
});

function SiteDetailPage() {
  const t = useT();
  const format = useFormatters();
  const activityLabels: Record<string, string> = {
    page_edited: t('admin.activity.contentEdited'),
    publish_clicked: t('admin.activity.publishClicked'),
    publish_ready: t('admin.activity.publishCompleted'),
    publish_failed: t('admin.activity.publishFailed'),
  };
  const { siteId } = Route.useParams();
  const { tab: selectedTab } = Route.useSearch();
  const tab = selectedTab ?? 'overview';
  const navigate = useNavigate({ from: Route.fullPath });
  const query = useAdminSite(siteId);
  if (query.isPending)
    return (
      <div className="py-16 text-center text-muted-foreground text-sm" role="status">
        {t('admin.site.loading')}
      </div>
    );
  if (query.isError || !query.data) return <DataError message={t('admin.site.loadError')} retry={() => void query.refetch()} />;

  const site = query.data;
  const latest = site.deployments[0];
  const domainIssues = site.domains.filter((domain) => domain.dnsStatus === 'ERROR' || domain.sslStatus === 'ERROR');
  const deploymentFailures = site.deployments.filter((deployment) => deployment.status === 'FAILED');
  const needsAttention = Boolean(
    site.takedownAt || domainIssues.length || latest?.status === 'FAILED' || site.invitations.some((invite) => invite.expired),
  );
  const supportTargets = site.members
    .filter((member) => member.user.role !== 'admin' && !member.user.suspendedAt)
    .map((member) => ({
      userId: member.user.id,
      label: member.user.name || member.user.email,
      detail: `${member.role} · ${site.workspace.name}`,
      organizationId: site.workspace.id,
    }));

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/sites" />}>{t('nav.sites')}</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{site.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate font-semibold text-2xl tracking-tight">{site.name}</h1>
            {site.takedownAt ? (
              <StatusBadge label={t('admin.status.takenDown')} value="taken-down" />
            ) : latest ? (
              <StatusBadge value={latest.status} />
            ) : (
              <Badge variant="outline">{t('admin.status.unpublished')}</Badge>
            )}
            <Badge variant="outline">{site.accessMode.toLowerCase()}</Badge>
          </div>
          <p className="mt-1 text-muted-foreground text-sm">
            {site.workspace.name} · <span className="font-mono">{site.slug}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button nativeButton={false} render={<Link to="/operations" />} variant="outline">
            {t('admin.site.viewOperations')}
          </Button>
          <Button
            nativeButton={false}
            render={
              <a aria-label={t('admin.site.openLive', { site: site.name })} href={`${APP_URL}/sites/${site.id}`} rel="noreferrer" target="_blank" />
            }
            variant="outline"
          >
            <ExternalLink className="size-4" /> {t('admin.site.liveSite')}
          </Button>
          <SupportAccessDialog subject={site.name} targets={supportTargets} />
        </div>
      </div>

      {needsAttention ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{t('admin.site.attention')}</AlertTitle>
          <AlertDescription>
            {site.takedownAt ? t('admin.site.takenDownOn', { date: format.date(site.takedownAt) }) : ''}
            {domainIssues.length ? t('admin.site.domainIssues', { count: format.number(domainIssues.length) }) : ''}
            {latest?.status === 'FAILED' ? t('admin.site.latestPublishFailed') : ''}
            {site.invitations.some((invitation) => invitation.expired) ? t('admin.site.invitationExpired') : ''}
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs
        onValueChange={(value) =>
          navigate({ search: { tab: z.enum(['overview', 'deployments', 'domains', 'access', 'activity']).parse(value) }, replace: true })
        }
        value={tab}
      >
        <div className="overflow-x-auto pb-1">
          <TabsList aria-label={t('admin.site.details')} className="min-w-max" variant="line">
            <TabsTrigger value="overview">{t('nav.overview')}</TabsTrigger>
            <TabsTrigger value="deployments">{t('admin.overview.deployments')}</TabsTrigger>
            <TabsTrigger value="domains">{t('admin.operations.domains')}</TabsTrigger>
            <TabsTrigger value="access">{t('admin.support.access')}</TabsTrigger>
            <TabsTrigger value="activity">{t('admin.site.activityOperations')}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent className="space-y-4 pt-4" value="overview">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard label={t('admin.site.planMetadata')} value={site.workspace.plan} />
            <MetricCard
              icon={<FileText className="size-4 text-muted-foreground" />}
              label={t('admin.site.content')}
              value={`${site.usage.pages} page${site.usage.pages === 1 ? '' : 's'} · ${site.usage.languages} lang.`}
            />
            <Card>
              <CardHeader>
                <CardDescription>{t('admin.site.traffic30d')}</CardDescription>
                <CardTitle className="font-semibold text-2xl tabular-nums">{site.usage.traffic.pageviews30d}</CardTitle>
                <CardDescription>{site.usage.traffic.searches30d} searches</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>{t('admin.site.storage')}</CardDescription>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Database className="size-4 text-muted-foreground" />
                  {fmtBytes(site.usage.storage.bytes)}
                </CardTitle>
                <CardDescription>{site.usage.storage.assets} assets</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>{t('admin.support.access')}</CardDescription>
                <CardTitle className="flex items-center gap-2 text-base">
                  <LockKeyhole className="size-4 text-muted-foreground" />
                  {site.access.mode.toLowerCase()}
                </CardTitle>
                <CardDescription>
                  {site.access.readers} readers · JWT {site.access.jwtEnabled ? 'on' : 'off'}
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('admin.site.identity')}</CardTitle>
              <CardDescription>{t('admin.site.identityPrivacy')}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">{t('admin.site.id')}</dt>
                  <dd className="mt-1 break-all font-mono text-xs">{site.id}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('admin.common.workspace')}</dt>
                  <dd className="mt-1 font-medium">{site.workspace.name}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('admin.site.languages')}</dt>
                  <dd className="mt-1 font-medium">
                    {site.languages.map((language) => `${language.code}${language.isDefault ? ' (default)' : ''}`).join(', ') || 'None'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('admin.common.updated')}</dt>
                  <dd className="mt-1 font-medium">{fmtDateTime(site.updatedAt)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="pt-4" value="deployments">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Rocket className="size-4 text-muted-foreground" />
                Deployments
              </CardTitle>
              <CardDescription>{t('admin.site.deploymentsPrivacy')}</CardDescription>
            </CardHeader>
            <CardContent>
              {site.deployments.length === 0 ? (
                <DataEmpty title={t('admin.status.unpublished')} description={t('admin.site.noDeployments')} />
              ) : (
                <div className="overflow-x-auto">
                  <Table className="min-w-[620px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('admin.site.version')}</TableHead>
                        <TableHead>{t('admin.common.status')}</TableHead>
                        <TableHead>{t('admin.common.pages')}</TableHead>
                        <TableHead>{t('admin.site.started')}</TableHead>
                        <TableHead>{t('admin.site.completed')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {site.deployments.map((deployment) => (
                        <TableRow key={deployment.id}>
                          <TableCell className="font-mono">v{deployment.version}</TableCell>
                          <TableCell>
                            <StatusBadge value={deployment.status} />
                          </TableCell>
                          <TableCell>{deployment.pages}</TableCell>
                          <TableCell className="text-muted-foreground" title={fmtDateTime(deployment.createdAt)}>
                            {fmtRelative(deployment.createdAt)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {deployment.completedAt ? fmtRelative(deployment.completedAt) : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {deploymentFailures.length ? (
                <p className="mt-3 text-muted-foreground text-xs">
                  {deploymentFailures.length} failed attempt{deploymentFailures.length === 1 ? ' is' : 's are'} visible in this 30-deployment window.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="pt-4" value="domains">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Globe2 className="size-4 text-muted-foreground" />
                Custom domains
              </CardTitle>
              <CardDescription>{t('admin.site.domainsPrivacy')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {site.domains.length === 0 ? (
                <DataEmpty title={t('admin.site.noDomains')} description={t('admin.site.noDomainsBody')} />
              ) : (
                site.domains.map((domain) => (
                  <div className="rounded-lg border p-3" key={domain.id}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <a className="break-all font-medium text-sm hover:underline" href={`https://${domain.domain}`} rel="noreferrer" target="_blank">
                        {domain.domain}
                      </a>
                      <div className="flex gap-1.5">
                        {domain.isPrimary ? <Badge>{t('admin.operations.primary')}</Badge> : null}
                        {domain.hasError ? <Badge variant="destructive">{t('admin.site.providerError')}</Badge> : null}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <StatusBadge label={`DNS ${domain.dnsStatus.toLowerCase()}`} value={domain.dnsStatus} />
                      <StatusBadge label={`TLS ${domain.sslStatus.toLowerCase()}`} value={domain.sslStatus} />
                    </div>
                    <p className="mt-2 text-muted-foreground text-xs">
                      {domain.provider} · {domain.lastCheckedAt ? `checked ${fmtRelative(domain.lastCheckedAt)}` : 'not checked yet'}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="pt-4" value="access">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="size-4 text-muted-foreground" />
                Workspace access
              </CardTitle>
              <CardDescription>{t('admin.site.accessBody')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {site.members.length === 0 ? (
                <DataEmpty title={t('admin.site.noMembers')} description={t('admin.site.noMembersBody')} />
              ) : (
                site.members.map((member) => (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3" key={member.id}>
                    <div className="min-w-0">
                      <Link className="truncate font-medium text-sm hover:underline" params={{ userId: member.user.id }} to="/users/$userId">
                        {member.user.name || member.user.email}
                      </Link>
                      <p className="truncate text-muted-foreground text-xs">{member.user.email}</p>
                    </div>
                    <div className="flex gap-1.5">
                      <Badge variant="outline">{member.role}</Badge>
                      {member.user.role === 'admin' ? <Badge>{t('admin.users.platformAdmins')}</Badge> : null}
                      {member.user.suspendedAt ? (
                        <Badge variant="destructive">{t('admin.status.suspended')}</Badge>
                      ) : !member.user.emailVerified ? (
                        <Badge variant="outline">{t('admin.status.unverified')}</Badge>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
              {site.invitations.map((invitation) => (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-3" key={invitation.id}>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-sm">{invitation.email}</p>
                    <p className="text-muted-foreground text-xs">Invitation expires {fmtDateTime(invitation.expiresAt)}</p>
                  </div>
                  <StatusBadge label={invitation.expired ? 'expired invite' : 'pending invite'} value={invitation.expired ? 'expired' : 'PENDING'} />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="grid gap-4 pt-4 lg:grid-cols-2" value="activity">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="size-4 text-muted-foreground" />
                Recent product activity
              </CardTitle>
              <CardDescription>{t('admin.site.activityPrivacy')}</CardDescription>
            </CardHeader>
            <CardContent>
              {site.activity.length === 0 ? (
                <DataEmpty title={t('admin.user.noActivity')} description={t('admin.site.noActivityBody')} />
              ) : (
                <ol className="space-y-4">
                  {site.activity.map((event) => (
                    <li
                      className="relative ps-5 text-sm before:absolute before:start-0 before:top-1.5 before:size-2 before:rounded-full before:bg-muted-foreground/40"
                      key={event.id}
                    >
                      <p className="font-medium">{activityLabels[event.type] ?? event.type.replaceAll('_', ' ')}</p>
                      <p className="text-muted-foreground text-xs">
                        {event.actorName ?? 'System'} ·{' '}
                        <time dateTime={event.createdAt} title={fmtDateTime(event.createdAt)}>
                          {fmtRelative(event.createdAt)}
                        </time>
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('admin.site.connectedOperations')}</CardTitle>
              <CardDescription>{t('admin.site.connectedPrivacy')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs">{t('admin.site.gitAuthoring')}</p>
                {site.git ? (
                  <>
                    <div className="mt-2 flex items-center gap-2">
                      <p className="font-medium capitalize">{site.git.provider}</p>
                      <StatusBadge value={site.git.status} />
                      {site.git.hasError ? <Badge variant="destructive">{t('admin.site.errorRecorded')}</Badge> : null}
                    </div>
                    <p className="mt-1 text-muted-foreground text-xs">
                      {site.git.lastSyncedAt ? `Last synced ${fmtRelative(site.git.lastSyncedAt)}` : 'Connected; no completed sync recorded'}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 font-medium text-sm">{t('admin.site.notConnected')}</p>
                )}
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs">{t('admin.operations.exports')}</p>
                <p className="mt-2 font-medium text-sm">
                  {t('admin.site.totalJobs', { count: format.number(Object.values(site.exports).reduce((total, count) => total + count, 0)) })}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(site.exports).length ? (
                    Object.entries(site.exports).map(([status, count]) => (
                      <Badge key={status} variant={status === 'FAILED' ? 'destructive' : 'outline'}>
                        {status.toLowerCase()}: {count}
                      </Badge>
                    ))
                  ) : (
                    <Badge variant="outline">{t('admin.site.noneYet')}</Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <p className="text-muted-foreground text-xs">
        Created {fmtDateTime(site.createdAt)} · last updated {fmtDateTime(site.updatedAt)}
      </p>
    </div>
  );
}

function MetricCard({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="flex items-center gap-2 text-base capitalize">
          {icon}
          {value}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}
