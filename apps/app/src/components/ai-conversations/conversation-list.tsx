import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nibleaf/design-system/components/ui/table';
import { useT } from '@nibleaf/i18n/react';
import type { AiConversationListItem } from '@nibleaf/validators';
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useFormatters } from '@/lib/format';

function Results({ item }: { item: Pick<AiConversationListItem, 'answered' | 'noAnswer' | 'failed' | 'cancelled'> }) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-1">
      {item.answered > 0 && <Badge variant="secondary">{t('dashboard.ai.answered')}</Badge>}
      {item.noAnswer > 0 && <Badge variant="outline">{t('dashboard.ai.no_answer')}</Badge>}
      {item.failed > 0 && <Badge variant="destructive">{t('dashboard.ai.failed')}</Badge>}
      {item.cancelled > 0 && <Badge variant="outline">{t('dashboard.ai.cancelled')}</Badge>}
    </div>
  );
}
export function ConversationList({ items, onOpen }: { items: AiConversationListItem[]; onOpen: (id: string) => void }) {
  // TanStack Table v8 returns a stable table instance whose methods read
  // internal state; the React Compiler would memoize those reads away.
  'use no memo';
  const t = useT();
  const f = useFormatters();
  // Stable columns: the table only rebuilds them when the locale or formatter changes.
  const columns = useMemo<ColumnDef<AiConversationListItem>[]>(
    () => [
      {
        accessorKey: 'firstQuestion',
        header: t('dashboard.ai.question'),
        cell: ({ row }) => (
          <Button
            variant="link"
            className="h-auto whitespace-normal p-0 text-start"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(row.id);
            }}
          >
            {row.original.firstQuestion ?? t('dashboard.ai.notSaved')}
          </Button>
        ),
      },
      { accessorKey: 'language', header: t('dashboard.ai.language') },
      { accessorKey: 'turns', header: t('dashboard.ai.count'), cell: ({ row }) => f.number(row.original.turns) },
      { id: 'result', header: t('dashboard.ai.result'), cell: ({ row }) => <Results item={row.original} /> },
      { accessorKey: 'rating', header: t('dashboard.ai.rating'), cell: ({ row }) => t(`dashboard.ai.${row.original.rating ?? 'unrated'}`) },
      { accessorKey: 'pagePath', header: t('dashboard.ai.page'), cell: ({ row }) => <span dir="auto">{row.original.pagePath ?? '\u2014'}</span> },
      {
        accessorKey: 'lastActivityAt',
        header: t('dashboard.ai.activity'),
        cell: ({ row }) => (
          <time dateTime={row.original.lastActivityAt} title={f.dateTime(row.original.lastActivityAt)}>
            {f.relativeTime(row.original.lastActivityAt)}
          </time>
        ),
      },
    ],
    [t, f, onOpen],
  );
  // react-doctor-disable-next-line react-hooks-js/incompatible-library -- this component opts out of the compiler ('use no memo') for exactly this reason.
  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel(), getRowId: (row) => row.conversationId });
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {table.getAllLeafColumns().map((column) => (
                <TableHead key={column.id}>{String(column.columnDef.header)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                tabIndex={0}
                className="cursor-pointer focus-visible:outline focus-visible:outline-ring"
                onClick={() => onOpen(row.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onOpen(row.id);
                }}
              >
                {row.getAllCells().map((cell) => (
                  <TableCell className="max-w-80 whitespace-normal break-words" key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="space-y-3 md:hidden">
        {items.map((item) => (
          <button
            type="button"
            className="w-full space-y-2 rounded-xl border bg-card p-4 text-start focus-visible:outline focus-visible:outline-ring"
            key={item.conversationId}
            onClick={() => onOpen(item.conversationId)}
          >
            <p dir="auto" className="font-medium">
              {item.firstQuestion ?? t('dashboard.ai.notSaved')}
            </p>
            <Results item={item} />
            <p className="text-muted-foreground text-sm">
              {item.language} · {t('dashboard.ai.count')}: {f.number(item.turns)} · {t(`dashboard.ai.${item.rating ?? 'unrated'}`)}
            </p>
            <p dir="auto" className="truncate text-sm">
              {item.pagePath ?? '—'}
            </p>
            <time className="text-muted-foreground text-xs" dateTime={item.lastActivityAt} title={f.dateTime(item.lastActivityAt)}>
              {f.relativeTime(item.lastActivityAt)}
            </time>
          </button>
        ))}
      </div>
    </>
  );
}
