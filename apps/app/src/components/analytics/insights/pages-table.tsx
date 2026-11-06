import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@nibleaf/design-system/components/ui/table';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useId, useState } from 'react';
import type { PageRow } from '@/hooks/api/analytics';
import type { InsightsSearch } from './filters';
import { PageLabel } from './insight-card';
import { DeltaBadge } from './kpi-card';
import { REASON_HINTS, REASON_LABELS } from './labels';
import { countDelta } from './metrics';
import { PageInsightsLink } from './section-links';
import { useInsightFormat } from './use-insight-format';
import { RatingBadge } from './vitals';
import { rateVital } from './web-vitals';

const PAGE_SIZE = 25;

/** Unknown values sort after every known one in both directions. */
const known = (value: number | null) => value ?? undefined;

const matchesFilter = (row: PageRow, needle: string) => {
  const query = needle.trim().toLocaleLowerCase();
  if (!query) return true;
  return row.path.toLocaleLowerCase().includes(query) || (row.title ?? '').toLocaleLowerCase().includes(query);
};

/**
 * Every page with traffic in the period: sortable columns, a text filter and
 * pagination (TanStack Table, client-side over the ≤500 rows the API returns).
 * Each row links to the page's drill-down. The table scrolls inside its card.
 */
export function PagesTable({ rows, projectId, filters, compare }: { rows: PageRow[]; projectId: string; filters: InsightsSearch; compare: boolean }) {
  // TanStack Table v8 returns a stable table instance whose methods read
  // internal state; the React Compiler would memoize those reads away.
  'use no memo';
  const t = useT();
  const format = useInsightFormat();
  const filterId = useId();
  const [sorting, setSorting] = useState<SortingState>([{ id: 'views', desc: true }]);
  const [globalFilter, setGlobalFilter] = useState('');

  const columns: ColumnDef<PageRow>[] = [
    {
      id: 'page',
      header: t('analytics.pages.column.page'),
      accessorFn: (row) => row.title ?? row.path,
      cell: ({ row }) => (
        <PageInsightsLink className="block max-w-[18rem]" filters={filters} path={row.original.path} projectId={projectId}>
          <PageLabel path={row.original.path} title={row.original.title} />
        </PageInsightsLink>
      ),
    },
    {
      id: 'views',
      header: t('analytics.pages.column.views'),
      accessorFn: (row) => row.views,
      cell: ({ row }) => {
        const delta = compare ? countDelta(row.original.views, row.original.previousViews) : null;
        return (
          <span className="inline-flex items-center gap-2">
            {format.count(row.original.views)}
            {delta ? <DeltaBadge delta={delta} polarity="higher_is_better" /> : null}
          </span>
        );
      },
      meta: { numeric: true },
    },
    {
      id: 'visits',
      header: t('analytics.pages.column.visits'),
      accessorFn: (row) => row.visits,
      cell: ({ getValue }) => format.count(getValue<number>()),
      meta: { numeric: true },
    },
    {
      id: 'engaged',
      header: t('analytics.pages.column.engaged'),
      accessorFn: (row) => known(row.avgEngagedMs),
      sortUndefined: 'last',
      cell: ({ row }) => format.duration(row.original.avgEngagedMs),
      meta: { numeric: true },
    },
    {
      id: 'scroll',
      header: t('analytics.pages.column.scroll'),
      accessorFn: (row) => known(row.avgScrollDepth),
      sortUndefined: 'last',
      cell: ({ row }) => format.rate(row.original.avgScrollDepth),
      meta: { numeric: true },
    },
    {
      id: 'exit',
      header: t('analytics.pages.column.exitRate'),
      accessorFn: (row) => known(row.exitRate),
      sortUndefined: 'last',
      cell: ({ row }) => format.rate(row.original.exitRate),
      meta: { numeric: true },
    },
    {
      id: 'helpful',
      header: t('analytics.pages.column.helpful'),
      accessorFn: (row) => known(row.helpfulRate),
      sortUndefined: 'last',
      cell: ({ row }) => (
        <span
          title={t('analytics.pages.helpfulVotes', {
            helpful: format.count(row.original.helpful),
            notHelpful: format.count(row.original.notHelpful),
          })}
        >
          {format.rate(row.original.helpfulRate)}
        </span>
      ),
      meta: { numeric: true },
    },
    {
      id: 'lcp',
      header: t('analytics.pages.column.speed'),
      accessorFn: (row) => known(row.lcpP75Ms),
      sortUndefined: 'last',
      cell: ({ row }) =>
        row.original.lcpP75Ms === null ? (
          format.ms(null)
        ) : (
          <span className="inline-flex items-center gap-2">
            {format.ms(row.original.lcpP75Ms)}
            <RatingBadge rating={rateVital('lcp', row.original.lcpP75Ms)} />
          </span>
        ),
      meta: { numeric: true },
    },
    {
      id: 'attention',
      header: t('analytics.pages.column.attention'),
      accessorFn: (row) => row.attention.length,
      cell: ({ row }) =>
        row.original.attention.length === 0 ? (
          <span className="text-muted-foreground text-xs">{t('analytics.pages.noAttention')}</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {row.original.attention.map((reason) => (
              <Badge key={reason} title={t(REASON_HINTS[reason])} variant="outline">
                {t(REASON_LABELS[reason])}
              </Badge>
            ))}
          </span>
        ),
    },
  ];

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, _columnId, value) => matchesFilter(row.original, String(value ?? '')),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: PAGE_SIZE } },
    autoResetPageIndex: true,
  });

  const pageCount = Math.max(1, table.getPageCount());
  const matching = table.getFilteredRowModel().rows.length;
  const visible = table.getRowModel().rows;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="relative w-full sm:w-72" htmlFor={filterId}>
          <span className="sr-only">{t('analytics.pages.filter.label')}</span>
          <Search aria-hidden className="-translate-y-1/2 pointer-events-none absolute start-2.5 top-1/2 size-4 text-muted-foreground" />
          <Input
            className="ps-8"
            id={filterId}
            onChange={(event) => setGlobalFilter(event.target.value)}
            placeholder={t('analytics.pages.filter.placeholder')}
            type="search"
            value={globalFilter}
          />
        </label>
        <p aria-live="polite" className="text-muted-foreground text-xs">
          {t('analytics.pages.count', { count: format.count(matching) })}
        </p>
      </div>
      <Table>
        <TableCaption className="sr-only">{t('analytics.pages.caption')}</TableCaption>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const numeric = (header.column.columnDef.meta as { numeric?: boolean } | undefined)?.numeric;
                const sorted = header.column.getIsSorted();
                const SortIcon = sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ArrowUpDown;
                return (
                  <TableHead
                    aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
                    className={cn(numeric && 'text-end')}
                    key={header.id}
                    scope="col"
                  >
                    <button
                      className={cn(
                        'inline-flex items-center gap-1 rounded-sm font-medium hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
                        numeric && 'flex-row-reverse',
                      )}
                      onClick={header.column.getToggleSortingHandler()}
                      type="button"
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <SortIcon aria-hidden className={cn('size-3.5', !sorted && 'opacity-40')} />
                    </button>
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {visible.length === 0 ? (
            <TableRow>
              <TableCell className="py-8 text-center text-muted-foreground" colSpan={columns.length}>
                {t('analytics.pages.filter.noMatch')}
              </TableCell>
            </TableRow>
          ) : (
            visible.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => {
                  const numeric = (cell.column.columnDef.meta as { numeric?: boolean } | undefined)?.numeric;
                  return (
                    <TableCell className={cn(numeric && 'text-end tabular-nums')} key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {pageCount > 1 ? (
        <nav aria-label={t('analytics.pages.pagination.label')} className="flex items-center justify-end gap-2">
          <Button
            aria-label={t('analytics.pages.pagination.previous')}
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
            size="icon-sm"
            variant="outline"
          >
            <ChevronLeft aria-hidden className="rtl:-scale-x-100" />
          </Button>
          <span className="text-muted-foreground text-xs tabular-nums">
            {t('analytics.pages.pagination.status', {
              page: format.count(table.getState().pagination.pageIndex + 1),
              total: format.count(pageCount),
            })}
          </span>
          <Button
            aria-label={t('analytics.pages.pagination.next')}
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
            size="icon-sm"
            variant="outline"
          >
            <ChevronRight aria-hidden className="rtl:-scale-x-100" />
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
