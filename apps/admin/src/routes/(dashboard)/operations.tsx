import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@nibleaf/design-system/components/ui/card';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Archive, GitBranch, Globe2, RefreshCw, Rocket, Search, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DataEmpty, DataError } from '@/components/data-state';
import { StatusBadge } from '@/components/status-badge';
import { useAdminOperations } from '@/hooks/api/queries';
import { fmtRelative } from '@/lib/format';

export const Route = createFileRoute('/(dashboard)/operations')({ component: OperationsPage });

type Queue = 'deployments' | 'domains' | 'exports' | 'git';

function OperationsPage() {
  const query = useAdminOperations();
  const [queue, setQueue] = useState<Queue>('deployments');
  const [search, setSearch] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const data = query.data;

  const counts = {
    deploymentIssues:
      data?.deployments.filter((item) => item.status === 'FAILED' || item.status === 'BUILDING' || item.status === 'PENDING').length ?? 0,
    domainIssues: data?.domains.filter((item) => item.dnsStatus === 'ERROR' || item.sslStatus === 'ERROR').length ?? 0,
    exportIssues: data?.exports.filter((item) => item.status === 'FAILED').length ?? 0,
    gitIssues: data?.git.filter((item) => item.status === 'FAILED' || item.status === 'CONFLICT').length ?? 0,
  };

  const items = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const source = data?.[queue] ?? [];
    return source.filter((item) => {
      const matchesSearch =
        !needle || item.projectName.toLowerCase().includes(needle) || ('domain' in item && item.domain.toLowerCase().includes(needle));
      const isIssue =
        ('dnsStatus' in item && (item.dnsStatus === 'ERROR' || item.sslStatus === 'ERROR')) ||
        ('status' in item && ['FAILED', 'CONFLICT'].includes(item.status)) ||
        ('status' in item && queue === 'deployments' && ['PENDING', 'BUILDING'].includes(item.status));
      return matchesSearch && (!onlyIssues || isIssue);
    });
  }, [data, onlyIssues, queue, search]);
  const queueRecordName = queue === 'git' ? 'Git' : queue.slice(0, -1);

  if (query.isError) return <DataError message="Operational queues could not be loaded." retry={() => void query.refetch()} />;

  const queueButtons: { id: Queue; label: string; count: number; icon: typeof Rocket }[] = [
    { id: 'deployments', label: 'Deployments', count: data?.deployments.length ?? 0, icon: Rocket },
    { id: 'domains', label: 'Domains', count: data?.domains.length ?? 0, icon: Globe2 },
    { id: 'exports', label: 'Exports', count: data?.exports.length ?? 0, icon: Archive },
    { id: 'git', label: 'Git', count: data?.git.length ?? 0, icon: GitBranch },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">Operations</h1>
          <p className="mt-1 text-muted-foreground text-sm">Recent delivery and provider state. Refreshes every 30 seconds while open.</p>
        </div>
        <Button disabled={query.isFetching} onClick={() => void query.refetch()} size="sm" variant="outline">
          <RefreshCw className={query.isFetching ? 'size-4 animate-spin' : 'size-4'} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Deployment attention</CardDescription>
            <CardTitle className="font-semibold text-2xl tabular-nums">{query.isPending ? '—' : counts.deploymentIssues}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Domain errors</CardDescription>
            <CardTitle className="font-semibold text-2xl tabular-nums">{query.isPending ? '—' : counts.domainIssues}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Failed exports</CardDescription>
            <CardTitle className="font-semibold text-2xl tabular-nums">{query.isPending ? '—' : counts.exportIssues}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Git issues</CardDescription>
            <CardTitle className="font-semibold text-2xl tabular-nums">{query.isPending ? '—' : counts.gitIssues}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Operational queues</CardTitle>
          <CardDescription>Raw errors, document content, repository locations, provider payloads, and credentials are not exposed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Operational queue">
            {queueButtons.map((item) => (
              <Button
                aria-selected={queue === item.id}
                key={item.id}
                onClick={() => setQueue(item.id)}
                role="tab"
                size="sm"
                variant={queue === item.id ? 'default' : 'outline'}
              >
                <item.icon className="size-4" />
                {item.label}
                <Badge variant={queue === item.id ? 'secondary' : 'outline'}>{item.count}</Badge>
              </Button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="relative" htmlFor="operations-search">
              <span className="sr-only">Search operations</span>
              <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="ps-9"
                id="operations-search"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search site or domain"
                value={search}
              />
            </label>
            <Button aria-pressed={onlyIssues} onClick={() => setOnlyIssues((value) => !value)} variant={onlyIssues ? 'default' : 'outline'}>
              <TriangleAlert className="size-4" />
              Issues only
            </Button>
          </div>

          {query.isPending ? (
            <div className="py-12 text-center text-muted-foreground text-sm" role="status">
              Loading operational queues…
            </div>
          ) : items.length === 0 ? (
            <DataEmpty
              title="No matching operations"
              description={onlyIssues ? 'No issues match this queue and search.' : 'No recent records match this queue and search.'}
            />
          ) : (
            <div className="grid gap-2">
              {queue === 'deployments'
                ? items.map((raw) => {
                    const item = raw as NonNullable<typeof data>['deployments'][number];
                    return (
                      <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center" key={item.id}>
                        <div className="min-w-0">
                          <Link className="truncate font-medium text-sm hover:underline" params={{ siteId: item.projectId }} to="/sites/$siteId">
                            {item.projectName}
                          </Link>
                          <p className="text-muted-foreground text-xs">
                            Deployment v{item.version} · {item.pages} page{item.pages === 1 ? '' : 's'}
                          </p>
                        </div>
                        <StatusBadge value={item.status} />
                        <p className="text-muted-foreground text-xs" title={item.createdAt}>
                          {fmtRelative(item.completedAt ?? item.createdAt)}
                        </p>
                      </div>
                    );
                  })
                : null}
              {queue === 'domains'
                ? items.map((raw) => {
                    const item = raw as NonNullable<typeof data>['domains'][number];
                    return (
                      <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center" key={item.id}>
                        <div className="min-w-0">
                          <Link className="truncate font-medium text-sm hover:underline" params={{ siteId: item.projectId }} to="/sites/$siteId">
                            {item.domain}
                          </Link>
                          <p className="text-muted-foreground text-xs">
                            {item.projectName} · {item.provider}
                            {item.isPrimary ? ' · primary' : ''}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <StatusBadge label={`DNS ${item.dnsStatus.toLowerCase()}`} value={item.dnsStatus} />
                          <StatusBadge label={`TLS ${item.sslStatus.toLowerCase()}`} value={item.sslStatus} />
                        </div>
                        <p className="text-muted-foreground text-xs">{item.lastCheckedAt ? fmtRelative(item.lastCheckedAt) : 'Not checked'}</p>
                      </div>
                    );
                  })
                : null}
              {queue === 'exports'
                ? items.map((raw) => {
                    const item = raw as NonNullable<typeof data>['exports'][number];
                    return (
                      <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center" key={item.id}>
                        <div className="min-w-0">
                          <Link className="truncate font-medium text-sm hover:underline" params={{ siteId: item.projectId }} to="/sites/$siteId">
                            {item.projectName}
                          </Link>
                          <p className="text-muted-foreground text-xs">
                            {item.trigger.toLowerCase()} export · {item.attempts} attempt{item.attempts === 1 ? '' : 's'}
                          </p>
                        </div>
                        <StatusBadge value={item.status} />
                        <p className="text-muted-foreground text-xs">{fmtRelative(item.completedAt ?? item.createdAt)}</p>
                      </div>
                    );
                  })
                : null}
              {queue === 'git'
                ? items.map((raw) => {
                    const item = raw as NonNullable<typeof data>['git'][number];
                    return (
                      <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center" key={item.id}>
                        <div className="min-w-0">
                          <Link className="truncate font-medium text-sm hover:underline" params={{ siteId: item.projectId }} to="/sites/$siteId">
                            {item.projectName}
                          </Link>
                          <p className="text-muted-foreground text-xs">{item.kind.replaceAll('_', ' ').toLowerCase()} operation</p>
                        </div>
                        <StatusBadge value={item.status} />
                        <p className="text-muted-foreground text-xs">{fmtRelative(item.completedAt ?? item.createdAt)}</p>
                      </div>
                    );
                  })
                : null}
            </div>
          )}
          {!query.isPending ? (
            <p className="text-muted-foreground text-xs" aria-live="polite">
              Showing {items.length} {queueRecordName} record{items.length === 1 ? '' : 's'} from the bounded recent queue.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
