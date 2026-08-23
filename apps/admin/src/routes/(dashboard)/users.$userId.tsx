import { Badge } from '@nibleaf/design-system/components/ui/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@nibleaf/design-system/components/ui/breadcrumb';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@nibleaf/design-system/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@nibleaf/design-system/components/ui/tabs';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Activity, Building2, Clock3, KeyRound, ShieldCheck } from 'lucide-react';
import { z } from 'zod';
import { DataEmpty, DataError } from '@/components/data-state';
import { StatusBadge } from '@/components/status-badge';
import { SupportAccessDialog } from '@/components/support-access-dialog';
import { useAdminUser } from '@/hooks/api/queries';
import { useFormatters } from '@/lib/format';

export const Route = createFileRoute('/(dashboard)/users/$userId')({
  component: UserDetailPage,
  validateSearch: (search) => z.object({ tab: z.enum(['overview', 'workspaces', 'security', 'activity']).optional().catch(undefined) }).parse(search),
});

function UserDetailPage() {
  const t = useT();
  const format = useFormatters();
  const activityLabels: Record<string, string> = {
    signup_completed: t('admin.activity.signupCompleted'),
    page_edited: t('admin.activity.pageEdited'),
    publish_clicked: t('admin.activity.publishClicked'),
    publish_ready: t('admin.activity.publishReady'),
    publish_failed: t('admin.activity.publishFailed'),
    admin_impersonation_started: t('admin.activity.supportStarted'),
    admin_impersonation_ended: t('admin.activity.supportStopped'),
  };
  const { userId } = Route.useParams();
  const { tab: selectedTab } = Route.useSearch();
  const tab = selectedTab ?? 'overview';
  const navigate = useNavigate({ from: Route.fullPath });
  const query = useAdminUser(userId);

  if (query.isPending)
    return (
      <div className="py-16 text-center text-muted-foreground text-sm" role="status">
        {t('admin.user.loading')}
      </div>
    );
  if (query.isError || !query.data) return <DataError message={t('admin.user.loadError')} retry={() => void query.refetch()} />;
  const user = query.data;
  const supportTargets =
    user.role === 'admin' || user.suspendedAt
      ? []
      : user.workspaces.map((workspace) => ({
          userId: user.id,
          label: user.name || user.email,
          detail: workspace.project ? `${workspace.project.name} · ${workspace.organizationName}` : workspace.organizationName,
          organizationId: workspace.organizationId,
        }));

  const summaryCards = (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader>
          <CardDescription>{t('admin.user.email')}</CardDescription>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-muted-foreground" />
            {user.emailVerified ? t('admin.status.verified') : t('admin.status.unverified')}
          </CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardDescription>{t('admin.user.authentication')}</CardDescription>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4 text-muted-foreground" />
            {user.providers.join(', ') || t('admin.users.emailOtp')}
          </CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardDescription>{t('admin.user.activeSessions')}</CardDescription>
          <CardTitle className="font-semibold text-2xl tabular-nums">{format.number(user.sessions.active)}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardDescription>{t('admin.common.lastActive')}</CardDescription>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock3 className="size-4 text-muted-foreground" />
            {user.sessions.lastActiveAt ? format.relative(user.sessions.lastActiveAt) : t('admin.user.noActiveSession')}
          </CardTitle>
        </CardHeader>
      </Card>
    </div>
  );

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/users" />}>{t('admin.nav.customers')}</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{user.name || user.email}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate font-semibold text-2xl tracking-tight">{user.name || t('admin.users.unnamed')}</h1>
            <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>{user.role}</Badge>
            {user.suspendedAt ? <Badge variant="destructive">{t('admin.status.suspended')}</Badge> : null}
          </div>
          <p className="mt-1 break-all text-muted-foreground text-sm">{user.email}</p>
          <p className="mt-1 text-muted-foreground text-xs">{t('admin.user.customerSince', { date: format.date(user.createdAt) })}</p>
        </div>
        <SupportAccessDialog subject={user.name || user.email} targets={supportTargets} />
      </div>

      <Tabs
        onValueChange={(value) =>
          navigate({ search: { tab: z.enum(['overview', 'workspaces', 'security', 'activity']).parse(value) }, replace: true })
        }
        value={tab}
      >
        <div className="overflow-x-auto pb-1">
          <TabsList aria-label={t('admin.user.details')} className="min-w-max" variant="line">
            <TabsTrigger value="overview">{t('nav.overview')}</TabsTrigger>
            <TabsTrigger value="workspaces">{t('admin.sites.title')}</TabsTrigger>
            <TabsTrigger value="security">{t('admin.user.authentication')}</TabsTrigger>
            <TabsTrigger value="activity">{t('admin.user.activity')}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent className="space-y-4 pt-4" value="overview">
          {summaryCards}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('admin.user.operationalSummary')}</CardTitle>
              <CardDescription>{t('admin.user.operationalPrivacy')}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">{t('admin.common.workspaces')}</dt>
                  <dd className="mt-1 font-medium">{format.number(user.workspaces.length)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('admin.user.accountUpdated')}</dt>
                  <dd className="mt-1 font-medium">{format.relative(user.updatedAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('admin.user.nextSessionExpiry')}</dt>
                  <dd className="mt-1 font-medium">
                    {user.sessions.nextExpiryAt ? format.relative(user.sessions.nextExpiryAt) : t('admin.user.noActiveSession')}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('admin.common.status')}</dt>
                  <dd className="mt-1 font-medium">
                    {user.suspendedAt ? t('admin.user.suspendedOn', { date: format.date(user.suspendedAt) }) : t('admin.status.active')}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="pt-4" value="workspaces">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="size-4 text-muted-foreground" /> {t('admin.sites.title')}
              </CardTitle>
              <CardDescription>{t('admin.user.workspacesBody')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {user.workspaces.length === 0 ? (
                <DataEmpty title={t('admin.user.noWorkspaces')} description={t('admin.user.noWorkspacesBody')} />
              ) : (
                user.workspaces.map((workspace) => (
                  <div className="rounded-lg border p-3" key={workspace.membershipId}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        {workspace.project ? (
                          <Link className="font-medium hover:underline" params={{ siteId: workspace.project.id }} to="/sites/$siteId">
                            {workspace.project.name}
                          </Link>
                        ) : (
                          <p className="font-medium">{workspace.organizationName}</p>
                        )}
                        <p className="truncate text-muted-foreground text-xs">
                          {workspace.organizationName} · {workspace.plan} plan
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="outline">{workspace.role}</Badge>
                        {workspace.project?.takedownAt ? (
                          <StatusBadge label={t('admin.status.takenDown')} value="taken-down" />
                        ) : workspace.project?.latestDeployment ? (
                          <StatusBadge value={workspace.project.latestDeployment.status} />
                        ) : (
                          <Badge variant="outline">{t('admin.status.unpublished')}</Badge>
                        )}
                      </div>
                    </div>
                    {workspace.project ? (
                      <dl className="mt-3 grid grid-cols-3 gap-3 text-xs">
                        <div>
                          <dt className="text-muted-foreground">{t('admin.common.domains')}</dt>
                          <dd className="mt-0.5 font-medium">
                            {workspace.project.domains}
                            {workspace.project.domainIssues
                              ? ` · ${workspace.project.domainIssues} issue${workspace.project.domainIssues === 1 ? '' : 's'}`
                              : ''}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">{t('admin.common.joined')}</dt>
                          <dd className="mt-0.5 font-medium">{format.date(workspace.joinedAt)}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">{t('admin.common.updated')}</dt>
                          <dd className="mt-0.5 font-medium">{format.relative(workspace.project.updatedAt)}</dd>
                        </div>
                      </dl>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="grid gap-4 pt-4 lg:grid-cols-2" value="security">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('admin.user.authConnections')}</CardTitle>
              <CardDescription>{t('admin.user.authPrivacy')}</CardDescription>
            </CardHeader>
            <CardContent>
              {user.providerConnections.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t('admin.user.emailOtpAvailable')}</p>
              ) : (
                <div className="grid gap-3">
                  {user.providerConnections.map((provider) => (
                    <div className="rounded-lg border p-3" key={`${provider.provider}-${provider.connectedAt}`}>
                      <p className="font-medium text-sm">{provider.provider}</p>
                      <p className="mt-1 text-muted-foreground text-xs">
                        {t('admin.user.providerConnected', {
                          connected: format.dateTime(provider.connectedAt),
                          updated: format.relative(provider.updatedAt),
                        })}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('admin.user.sessionPosture')}</CardTitle>
              <CardDescription>{t('admin.user.sessionPrivacy')}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">{t('admin.user.activeSessions')}</dt>
                  <dd className="mt-1 font-medium">{format.number(user.sessions.active)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('admin.common.lastActive')}</dt>
                  <dd className="mt-1 font-medium">
                    {user.sessions.lastActiveAt ? format.dateTime(user.sessions.lastActiveAt) : t('admin.user.noRecordedSession')}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('admin.user.nextExpiry')}</dt>
                  <dd className="mt-1 font-medium">{user.sessions.nextExpiryAt ? format.dateTime(user.sessions.nextExpiryAt) : '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('admin.user.emailState')}</dt>
                  <dd className="mt-1 font-medium">{user.emailVerified ? t('admin.status.verified') : t('admin.status.unverified')}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="pt-4" value="activity">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="size-4 text-muted-foreground" /> {t('admin.user.recentActivity')}
              </CardTitle>
              <CardDescription>{t('admin.user.activityPrivacy')}</CardDescription>
            </CardHeader>
            <CardContent>
              {user.activity.length === 0 ? (
                <DataEmpty title={t('admin.user.noActivity')} description={t('admin.user.noActivityBody')} />
              ) : (
                <ol className="space-y-4">
                  {user.activity.map((event) => (
                    <li
                      className="relative ps-5 text-sm before:absolute before:start-0 before:top-1.5 before:size-2 before:rounded-full before:bg-muted-foreground/40"
                      key={event.id}
                    >
                      <p className="font-medium">{activityLabels[event.type] ?? event.type.replaceAll('_', ' ')}</p>
                      <p className="text-muted-foreground text-xs">
                        {event.projectName ?? t('admin.user.account')} ·{' '}
                        <time dateTime={event.createdAt} title={format.dateTime(event.createdAt)}>
                          {format.relative(event.createdAt)}
                        </time>
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
