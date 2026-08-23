import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@nibleaf/design-system/components/ui/card';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Archive, GitBranch, Globe2, type LucideIcon, RefreshCw, Rocket, Search, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DataEmpty, DataError } from '@/components/data-state';
import { StatusBadge } from '@/components/status-badge';
import { useAdminOperations } from '@/hooks/api/queries';
import { useFormatters } from '@/lib/format';

export const Route = createFileRoute('/(dashboard)/operations')({ component: OperationsPage });

type Queue = 'deployments' | 'domains' | 'exports' | 'git';

function OperationsPage() {
  const t = useT();
  const format = useFormatters();
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
  const queueRecordName =
    queue === 'deployments'
      ? t('admin.operations.deployment')
      : queue === 'domains'
        ? t('admin.operations.domain')
        : queue === 'exports'
          ? t('admin.operations.export')
          : t('admin.operations.git');

  if (query.isError) return <DataError message={t('admin.operations.loadError')} retry={() => void query.refetch()} />;

  const queueButtons: { id: Queue; label: string; count: number; icon: LucideIcon }[] = [
    { id: 'deployments', label: t('admin.overview.deployments'), count: data?.deployments.length ?? 0, icon: Rocket },
    { id: 'domains', label: t('admin.operations.domains'), count: data?.domains.length ?? 0, icon: Globe2 },
    { id: 'exports', label: t('admin.operations.exports'), count: data?.exports.length ?? 0, icon: Archive },
    { id: 'git', label: t('admin.operations.git'), count: data?.git.length ?? 0, icon: GitBranch },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">{t('admin.nav.operations')}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{t('admin.operations.subtitle')}</p>
        </div>
        <Button disabled={query.isFetching} onClick={() => void query.refetch()} size="sm" variant="outline">
          <RefreshCw className={query.isFetching ? 'size-4 animate-spin' : 'size-4'} />
          {t('common.refresh')}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>{t('admin.operations.deploymentAttention')}</CardDescription>
            <CardTitle className="font-semibold text-2xl tabular-nums">{query.isPending ? '—' : format.number(counts.deploymentIssues)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>{t('admin.overview.domainErrors')}</CardDescription>
            <CardTitle className="font-semibold text-2xl tabular-nums">{query.isPending ? '—' : format.number(counts.domainIssues)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>{t('admin.operations.failedExports')}</CardDescription>
            <CardTitle className="font-semibold text-2xl tabular-nums">{query.isPending ? '—' : format.number(counts.exportIssues)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>{t('admin.overview.gitIssues')}</CardDescription>
            <CardTitle className="font-semibold text-2xl tabular-nums">{query.isPending ? '—' : format.number(counts.gitIssues)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('admin.operations.queues')}</CardTitle>
          <CardDescription>{t('admin.operations.privacy')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <fieldset className="flex gap-2 overflow-x-auto pb-1">
            <legend className="sr-only">{t('admin.operations.queue')}</legend>
            {queueButtons.map((item) => (
              <Button
                aria-pressed={queue === item.id}
                key={item.id}
                onClick={() => setQueue(item.id)}
                size="sm"
                variant={queue === item.id ? 'default' : 'outline'}
              >
                <item.icon className="size-4" />
                {item.label}
                <Badge variant={queue === item.id ? 'secondary' : 'outline'}>{format.number(item.count)}</Badge>
              </Button>
            ))}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="relative" htmlFor="operations-search">
              <span className="sr-only">{t('admin.operations.search')}</span>
              <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="ps-9"
                id="operations-search"
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('admin.operations.searchPlaceholder')}
                value={search}
              />
            </label>
            <Button aria-pressed={onlyIssues} onClick={() => setOnlyIssues((value) => !value)} variant={onlyIssues ? 'default' : 'outline'}>
              <TriangleAlert className="size-4" />
              {t('admin.operations.issuesOnly')}
            </Button>
          </div>

          {query.isPending ? (
            <div className="py-12 text-center text-muted-foreground text-sm" role="status">
              {t('admin.operations.loading')}
            </div>
          ) : items.length === 0 ? (
            <DataEmpty
              title={t('admin.operations.empty')}
              description={onlyIssues ? t('admin.operations.emptyIssues') : t('admin.operations.emptyRecords')}
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
                            {t('admin.operations.deploymentSummary', { version: format.number(item.version), pages: format.number(item.pages) })}
                          </p>
                        </div>
                        <StatusBadge value={item.status} />
                        <p className="text-muted-foreground text-xs" title={item.createdAt}>
                          {format.relative(item.completedAt ?? item.createdAt)}
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
                            {item.isPrimary ? ` · ${t('admin.operations.primary')}` : ''}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <StatusBadge label={`DNS ${item.dnsStatus.toLowerCase()}`} value={item.dnsStatus} />
                          <StatusBadge label={`TLS ${item.sslStatus.toLowerCase()}`} value={item.sslStatus} />
                        </div>
                        <p className="text-muted-foreground text-xs">
                          {item.lastCheckedAt ? format.relative(item.lastCheckedAt) : t('admin.operations.notChecked')}
                        </p>
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
                            {t('admin.operations.exportSummary', { trigger: item.trigger.toLowerCase(), attempts: format.number(item.attempts) })}
                          </p>
                        </div>
                        <StatusBadge value={item.status} />
                        <p className="text-muted-foreground text-xs">{format.relative(item.completedAt ?? item.createdAt)}</p>
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
                          <p className="text-muted-foreground text-xs">
                            {t('admin.operations.gitSummary', { kind: item.kind.replaceAll('_', ' ').toLowerCase() })}
                          </p>
                        </div>
                        <StatusBadge value={item.status} />
                        <p className="text-muted-foreground text-xs">{format.relative(item.completedAt ?? item.createdAt)}</p>
                      </div>
                    );
                  })
                : null}
            </div>
          )}
          {!query.isPending ? (
            <p className="text-muted-foreground text-xs" aria-live="polite">
              {t('admin.operations.showing', { count: format.number(items.length), record: queueRecordName })}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
