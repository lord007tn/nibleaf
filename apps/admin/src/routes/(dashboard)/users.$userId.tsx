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
import { createFileRoute, Link } from '@tanstack/react-router';
import { Activity, Building2, Clock3, KeyRound, ShieldCheck } from 'lucide-react';
import { DataEmpty, DataError } from '@/components/data-state';
import { StatusBadge } from '@/components/status-badge';
import { useAdminUser } from '@/hooks/api/queries';
import { fmtDate, fmtDateTime, fmtRelative } from '@/lib/format';

export const Route = createFileRoute('/(dashboard)/users/$userId')({ component: UserDetailPage });

const activityLabels: Record<string, string> = {
  signup_completed: 'Completed sign-up',
  page_edited: 'Edited content for the first time',
  publish_clicked: 'Started a publish',
  publish_ready: 'Published successfully',
  publish_failed: 'Publish failed',
};

function UserDetailPage() {
  const { userId } = Route.useParams();
  const query = useAdminUser(userId);

  if (query.isPending)
    return (
      <div className="py-16 text-center text-muted-foreground text-sm" role="status">
        Loading customer…
      </div>
    );
  if (query.isError || !query.data)
    return <DataError message="This customer could not be loaded or no longer exists." retry={() => void query.refetch()} />;
  const user = query.data;

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/users" />}>Customers</BreadcrumbLink>
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
            <h1 className="truncate font-semibold text-2xl tracking-tight">{user.name || 'Unnamed customer'}</h1>
            <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>{user.role}</Badge>
            {user.suspendedAt ? <Badge variant="destructive">suspended</Badge> : null}
          </div>
          <p className="mt-1 break-all text-muted-foreground text-sm">{user.email}</p>
        </div>
        <p className="text-muted-foreground text-xs">Customer since {fmtDate(user.createdAt)}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Email</CardDescription>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4 text-muted-foreground" />
              {user.emailVerified ? 'Verified' : 'Unverified'}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Authentication</CardDescription>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4 text-muted-foreground" />
              {user.providers.join(', ') || 'Email OTP'}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Active sessions</CardDescription>
            <CardTitle className="font-semibold text-2xl tabular-nums">{user.sessions.active}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Last active</CardDescription>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock3 className="size-4 text-muted-foreground" />
              {user.sessions.lastActiveAt ? fmtRelative(user.sessions.lastActiveAt) : 'No active session'}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="size-4 text-muted-foreground" />
              Sites & workspaces
            </CardTitle>
            <CardDescription>Membership and current delivery health. Each site has its own workspace boundary.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {user.workspaces.length === 0 ? (
              <DataEmpty title="No workspaces" description="This customer does not currently belong to a site workspace." />
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
                        <StatusBadge label="taken down" value="taken-down" />
                      ) : workspace.project?.latestDeployment ? (
                        <StatusBadge value={workspace.project.latestDeployment.status} />
                      ) : (
                        <Badge variant="outline">not published</Badge>
                      )}
                    </div>
                  </div>
                  {workspace.project ? (
                    <dl className="mt-3 grid grid-cols-3 gap-3 text-xs">
                      <div>
                        <dt className="text-muted-foreground">Domains</dt>
                        <dd className="mt-0.5 font-medium">
                          {workspace.project.domains}
                          {workspace.project.domainIssues
                            ? ` · ${workspace.project.domainIssues} issue${workspace.project.domainIssues === 1 ? '' : 's'}`
                            : ''}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Joined</dt>
                        <dd className="mt-0.5 font-medium">{fmtDate(workspace.joinedAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Updated</dt>
                        <dd className="mt-0.5 font-medium">{fmtRelative(workspace.project.updatedAt)}</dd>
                      </div>
                    </dl>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4 text-muted-foreground" />
              Recent product activity
            </CardTitle>
            <CardDescription>Allowlisted event names only; content and event metadata stay private.</CardDescription>
          </CardHeader>
          <CardContent>
            {user.activity.length === 0 ? (
              <DataEmpty title="No recorded activity" description="No platform events are available for this customer." />
            ) : (
              <ol className="space-y-4">
                {user.activity.slice(0, 12).map((event) => (
                  <li
                    className="relative ps-5 text-sm before:absolute before:start-0 before:top-1.5 before:size-2 before:rounded-full before:bg-muted-foreground/40"
                    key={event.id}
                  >
                    <p className="font-medium">{activityLabels[event.type] ?? event.type.replaceAll('_', ' ')}</p>
                    <p className="text-muted-foreground text-xs">
                      {event.projectName ?? 'Account'} ·{' '}
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
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Authentication connections</CardTitle>
          <CardDescription>Provider state without credentials, tokens, IP addresses, or user agents.</CardDescription>
        </CardHeader>
        <CardContent>
          {user.providerConnections.length === 0 ? (
            <p className="text-muted-foreground text-sm">Email OTP is available; no durable provider account is recorded.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {user.providerConnections.map((provider) => (
                <div className="rounded-lg border p-3" key={`${provider.provider}-${provider.connectedAt}`}>
                  <p className="font-medium text-sm">{provider.provider}</p>
                  <p className="mt-1 text-muted-foreground text-xs">
                    Connected {fmtDateTime(provider.connectedAt)} · updated {fmtRelative(provider.updatedAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
