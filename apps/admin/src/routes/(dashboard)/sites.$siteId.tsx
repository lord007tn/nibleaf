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
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Activity, Database, ExternalLink, FileText, Globe2, LockKeyhole, Rocket, TriangleAlert, Users } from 'lucide-react';
import { z } from 'zod';
import { DataEmpty, DataError } from '@/components/data-state';
import { StatusBadge } from '@/components/status-badge';
import { SupportAccessDialog } from '@/components/support-access-dialog';
import { useAdminSite } from '@/hooks/api/queries';
import { fmtBytes, fmtDate, fmtDateTime, fmtRelative } from '@/lib/format';
import { APP_URL } from '@/lib/links';

export const Route = createFileRoute('/(dashboard)/sites/$siteId')({
  component: SiteDetailPage,
  validateSearch: (search) =>
    z.object({ tab: z.enum(['overview', 'deployments', 'domains', 'access', 'activity']).optional().catch(undefined) }).parse(search),
});

const activityLabels: Record<string, string> = {
  page_edited: 'Content edited',
  publish_clicked: 'Publish started',
  publish_ready: 'Publish completed',
  publish_failed: 'Publish failed',
};

function SiteDetailPage() {
  const { siteId } = Route.useParams();
  const { tab: selectedTab } = Route.useSearch();
  const tab = selectedTab ?? 'overview';
  const navigate = useNavigate({ from: Route.fullPath });
  const query = useAdminSite(siteId);
  if (query.isPending)
    return (
      <div className="py-16 text-center text-muted-foreground text-sm" role="status">
        Loading site operations…
      </div>
    );
  if (query.isError || !query.data)
    return <DataError message="This site could not be loaded or no longer exists." retry={() => void query.refetch()} />;

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
            <BreadcrumbLink render={<Link to="/sites" />}>Sites</BreadcrumbLink>
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
              <StatusBadge label="taken down" value="taken-down" />
            ) : latest ? (
              <StatusBadge value={latest.status} />
            ) : (
              <Badge variant="outline">not published</Badge>
            )}
            <Badge variant="outline">{site.accessMode.toLowerCase()}</Badge>
          </div>
          <p className="mt-1 text-muted-foreground text-sm">
            {site.workspace.name} · <span className="font-mono">{site.slug}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button nativeButton={false} render={<Link to="/operations" />} variant="outline">
            View operations
          </Button>
          <Button
            nativeButton={false}
            render={<a aria-label={`Open ${site.name} live site`} href={`${APP_URL}/sites/${site.id}`} rel="noreferrer" target="_blank" />}
            variant="outline"
          >
            <ExternalLink className="size-4" /> Live site
          </Button>
          <SupportAccessDialog subject={site.name} targets={supportTargets} />
        </div>
      </div>

      {needsAttention ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Operator attention required</AlertTitle>
          <AlertDescription>
            {site.takedownAt ? `Taken down ${fmtDate(site.takedownAt)}. ` : ''}
            {domainIssues.length ? `${domainIssues.length} domain issue${domainIssues.length === 1 ? '' : 's'}. ` : ''}
            {latest?.status === 'FAILED' ? 'The latest publish failed. ' : ''}
            {site.invitations.some((invitation) => invitation.expired) ? 'An owner or member invitation has expired.' : ''}
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
          <TabsList aria-label="Website details" className="min-w-max" variant="line">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="deployments">Deployments</TabsTrigger>
            <TabsTrigger value="domains">Domains</TabsTrigger>
            <TabsTrigger value="access">Access</TabsTrigger>
            <TabsTrigger value="activity">Activity & operations</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent className="space-y-4 pt-4" value="overview">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard label="Plan metadata" value={site.workspace.plan} />
            <MetricCard
              icon={<FileText className="size-4 text-muted-foreground" />}
              label="Content"
              value={`${site.usage.pages} page${site.usage.pages === 1 ? '' : 's'} · ${site.usage.languages} lang.`}
            />
            <Card>
              <CardHeader>
                <CardDescription>Traffic (30d)</CardDescription>
                <CardTitle className="font-semibold text-2xl tabular-nums">{site.usage.traffic.pageviews30d}</CardTitle>
                <CardDescription>{site.usage.traffic.searches30d} searches</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Storage</CardDescription>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Database className="size-4 text-muted-foreground" />
                  {fmtBytes(site.usage.storage.bytes)}
                </CardTitle>
                <CardDescription>{site.usage.storage.assets} assets</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Access</CardDescription>
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
              <CardTitle className="text-base">Website identity</CardTitle>
              <CardDescription>Product and workspace identifiers useful for support; document content remains private.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">Website ID</dt>
                  <dd className="mt-1 break-all font-mono text-xs">{site.id}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Workspace</dt>
                  <dd className="mt-1 font-medium">{site.workspace.name}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Languages</dt>
                  <dd className="mt-1 font-medium">
                    {site.languages.map((language) => `${language.code}${language.isDefault ? ' (default)' : ''}`).join(', ') || 'None'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Updated</dt>
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
              <CardDescription>Latest 30 immutable publish attempts; raw build errors and document snapshots stay private.</CardDescription>
            </CardHeader>
            <CardContent>
              {site.deployments.length === 0 ? (
                <DataEmpty title="Not published" description="This site has no deployment attempts yet." />
              ) : (
                <div className="overflow-x-auto">
                  <Table className="min-w-[620px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Version</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Pages</TableHead>
                        <TableHead>Started</TableHead>
                        <TableHead>Completed</TableHead>
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
              <CardDescription>DNS, certificate, and provider state without provider payloads.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {site.domains.length === 0 ? (
                <DataEmpty title="No custom domains" description="The default Nibleaf site URL remains available after publishing." />
              ) : (
                site.domains.map((domain) => (
                  <div className="rounded-lg border p-3" key={domain.id}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <a className="break-all font-medium text-sm hover:underline" href={`https://${domain.domain}`} rel="noreferrer" target="_blank">
                        {domain.domain}
                      </a>
                      <div className="flex gap-1.5">
                        {domain.isPrimary ? <Badge>primary</Badge> : null}
                        {domain.hasError ? <Badge variant="destructive">provider error</Badge> : null}
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
              <CardDescription>Authors and pending invitations in this site’s isolated workspace.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {site.members.length === 0 ? (
                <DataEmpty title="No active members" description="This workspace currently has no accepted members." />
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
                      {member.user.role === 'admin' ? <Badge>platform admin</Badge> : null}
                      {member.user.suspendedAt ? (
                        <Badge variant="destructive">suspended</Badge>
                      ) : !member.user.emailVerified ? (
                        <Badge variant="outline">unverified</Badge>
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
              <CardDescription>Allowlisted activity labels only; content and metadata stay private.</CardDescription>
            </CardHeader>
            <CardContent>
              {site.activity.length === 0 ? (
                <DataEmpty title="No recorded activity" description="No platform events are available for this site." />
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
              <CardTitle className="text-base">Connected operations</CardTitle>
              <CardDescription>Git and export state without repository names, credentials, changed files, or raw errors.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs">Git authoring</p>
                {site.git ? (
                  <>
                    <div className="mt-2 flex items-center gap-2">
                      <p className="font-medium capitalize">{site.git.provider}</p>
                      <StatusBadge value={site.git.status} />
                      {site.git.hasError ? <Badge variant="destructive">error recorded</Badge> : null}
                    </div>
                    <p className="mt-1 text-muted-foreground text-xs">
                      {site.git.lastSyncedAt ? `Last synced ${fmtRelative(site.git.lastSyncedAt)}` : 'Connected; no completed sync recorded'}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 font-medium text-sm">Not connected</p>
                )}
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs">Exports</p>
                <p className="mt-2 font-medium text-sm">{Object.values(site.exports).reduce((total, count) => total + count, 0)} total jobs</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(site.exports).length ? (
                    Object.entries(site.exports).map(([status, count]) => (
                      <Badge key={status} variant={status === 'FAILED' ? 'destructive' : 'outline'}>
                        {status.toLowerCase()}: {count}
                      </Badge>
                    ))
                  ) : (
                    <Badge variant="outline">none yet</Badge>
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
