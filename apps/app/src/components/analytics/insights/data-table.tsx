import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@nibleaf/design-system/components/ui/table';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import type { ReactNode } from 'react';

export interface SimpleColumn<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** Numbers align to the end edge (right in LTR, left in RTL). */
  numeric?: boolean;
  className?: string;
}

/**
 * A small read-only data table (bots, devices, slowest pages…). Real table
 * markup with a caption; it scrolls inside its card rather than the page.
 */
export function SimpleTable<Row>({
  rows,
  columns,
  rowKey,
  caption,
  empty,
  loading,
  unknown,
}: {
  rows: Row[];
  columns: SimpleColumn<Row>[];
  rowKey: (row: Row) => string;
  caption: string;
  empty: string;
  loading?: boolean;
  unknown?: boolean;
}) {
  const t = useT();
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders have no stable id
          <Skeleton className="h-8 w-full" key={index} />
        ))}
      </div>
    );
  }
  if (unknown || rows.length === 0) {
    return <p className="py-6 text-center text-muted-foreground text-sm">{unknown ? t('analytics.state.unknown') : empty}</p>;
  }
  return (
    <Table>
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead className={cn(column.numeric && 'text-end', column.className)} key={column.key} scope="col">
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={rowKey(row)}>
            {columns.map((column) => (
              <TableCell className={cn(column.numeric && 'text-end tabular-nums', column.className)} key={column.key}>
                {column.cell(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
