import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nibleaf/design-system/components/ui/table';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Info } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { AdminRequired } from '@/components/organization/admin-required';
import { isOrgAdmin, useCurrentOrganization } from '@/components/organization/organization-context';
import { isAccessLoss } from '@/components/organization/use-access-loss';
import { QueryErrorState } from '@/components/query-error-state';
import { UsageOverview } from '@/components/settings/usage-tab';
import { useOrganizationUsage } from '@/hooks/api';
import { organizationUsageQueryOptions } from '@/hooks/api/organization-query-options';
import { queryKeys } from '@/hooks/api/query-keys';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { useFormatters } from '@/lib/format';
import { formatByteQuantity } from '@/lib/usage-format';

export const Route = createFileRoute('/app/o/$orgSlug/billing')({
  loader: ({ context: { queryClient }, params: { orgSlug } }) => {
    const organization = queryClient.getQueryData<{ id: string; orgRole: string }>(queryKeys.organizations.bySlug(orgSlug));
    if (organization && organization.orgRole !== 'member') prefetchRouteData(queryClient, organizationUsageQueryOptions(organization.id));
  },
  component: BillingPage,
});

/** Columns of the per-website breakdown: the measures that add up to the org totals. */
const BREAKDOWN: Array<{ key: string; label: MessageKey }> = [
  { key: 'published_page', label: 'settings.usage.meter.publishedPage' },
  { key: 'public_page_view', label: 'settings.usage.meter.publicPageView' },
  { key: 'asset_storage_byte', label: 'settings.usage.meter.assetStorage' },
  { key: 'build', label: 'settings.usage.meter.build' },
];

type Reading = { key: string; unit?: string; quantity: string | null };
type WebsiteUsage = { projectId: string; name?: string; meters: Reading[] };

/** Usage & billing (§5.1, Owner/Admin): plan, org totals with seats computed once, and a per-website breakdown. */
function BillingPage() {
  const organization = useCurrentOrganization();
  const t = useT();
  const admin = isOrgAdmin(organization);
  const usage = useOrganizationUsage(admin ? organization.id : undefined);
  if (!admin || isAccessLoss(usage.error)) return <AdminRequired orgSlug={organization.slug} />;
  const data = usage.data as
    | (Parameters<typeof UsageOverview>[0]['usage'] & { plan?: { key: string | null }; websites: WebsiteUsage[]; incomplete?: boolean })
    | undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader description={t('organization.billing.subtitle', { org: organization.name })} title={t('nav.billing')} />
      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Info className="size-5" />
        </span>
        <div className="leading-snug">
          <div className="font-medium text-sm">{t('settings.billing.notice.title')}</div>
          <p className="mt-0.5 text-muted-foreground text-sm">{t('settings.billing.notice.description')}</p>
        </div>
      </div>
      {usage.isError && !usage.data ? (
        <QueryErrorState onRetry={() => void usage.refetch()} retrying={usage.isFetching} />
      ) : (
        <>
          <UsageOverview
            description={t('organization.billing.totals')}
            isPending={usage.isPending}
            planKey={data?.plan?.key ?? null}
            title={t('organization.billing.usageTitle')}
            usage={data}
          />
          <WebsiteBreakdown pending={usage.isPending} websites={data?.websites ?? []} />
        </>
      )}
    </div>
  );
}

function WebsiteBreakdown({ websites, pending }: { websites: WebsiteUsage[]; pending: boolean }) {
  const t = useT();
  const { number } = useFormatters();
  const format = (reading: Reading | undefined) => {
    if (!reading || reading.quantity === null) return '—';
    if (reading.unit !== 'byte') return number(BigInt(reading.quantity));
    return formatByteQuantity(reading.quantity, {
      number,
      decimal: (whole, fraction) => t('settings.usage.decimal', { whole, fraction }),
      unit: (value, unit) =>
        t('settings.usage.unit', {
          value,
          unit: t(unit === 'gib' ? 'settings.usage.unit.gib' : unit === 'mib' ? 'settings.usage.unit.mib' : 'settings.usage.unit.byte'),
        }),
    });
  };
  return (
    <section aria-labelledby="breakdown-title" className="rounded-xl border border-border bg-card">
      <div className="border-border border-b px-5 py-3.5">
        <h2 className="font-semibold text-sm" id="breakdown-title">
          {t('organization.billing.breakdown')}
        </h2>
        <p className="mt-0.5 text-muted-foreground text-xs">{t('organization.billing.breakdownHint')}</p>
      </div>
      <div className="overflow-x-auto">
        <Table aria-busy={pending}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('organization.billing.website')}</TableHead>
              {BREAKDOWN.map((column) => (
                <TableHead className="text-end" key={column.key}>
                  {t(column.label)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pending
              ? ['a', 'b'].map((row) => (
                  <TableRow aria-hidden key={row}>
                    <TableCell>
                      <Skeleton className="h-4 w-32" />
                    </TableCell>
                    {BREAKDOWN.map((column) => (
                      <TableCell key={column.key}>
                        <Skeleton className="ms-auto h-4 w-12" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : websites.map((website) => (
                  <TableRow key={website.projectId}>
                    <TableCell className="font-medium">
                      <Link className="hover:underline" params={{ projectId: website.projectId }} to="/app/projects/$projectId">
                        <bdi>{website.name ?? website.projectId}</bdi>
                      </Link>
                    </TableCell>
                    {BREAKDOWN.map((column) => (
                      <TableCell className="text-end tabular-nums" key={column.key}>
                        {format(website.meters.find((meter) => meter.key === column.key))}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>
      {!pending && websites.length === 0 ? (
        <p className="px-5 py-6 text-center text-muted-foreground text-sm">{t('organization.billing.noWebsites')}</p>
      ) : null}
    </section>
  );
}
