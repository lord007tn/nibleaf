import { Badge } from '@midad/design-system/components/ui/badge';
import { Button } from '@midad/design-system/components/ui/button';
import { useConfirm } from '@midad/design-system/components/ui/confirm';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@midad/design-system/components/ui/table';
import { createFileRoute } from '@tanstack/react-router';
import { Download, Trash2 } from 'lucide-react';
import { useDeleteWaitlistEntry } from '@/hooks/api/mutations';
import { type AdminWaitlistEntry, useAdminWaitlist } from '@/hooks/api/queries';
import { fmtDate } from '@/lib/format';

export const Route = createFileRoute('/(dashboard)/waitlist')({
  component: WaitlistPage,
});

function exportCsv(rows: AdminWaitlistEntry[]) {
  // Quote every field, and prefix a leading `'` when a value starts with a
  // formula trigger so spreadsheets don't evaluate it (CSV formula injection).
  const esc = (v: unknown) => {
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) {
      s = `'${s}`;
    }
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = 'email,source,locale,created_at';
  const body = rows.map((r) => [r.email, r.source ?? '', r.locale ?? '', r.createdAt].map(esc).join(',')).join('\n');
  const blob = new Blob([`${header}\n${body}`], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'midad-cloud-waitlist.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function WaitlistPage() {
  const { data, isPending } = useAdminWaitlist();
  const remove = useDeleteWaitlistEntry();
  const confirm = useConfirm();
  const rows = data ?? [];
  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">Cloud waitlist</h1>
          <p className="mt-1 text-muted-foreground text-sm">Signups from the marketing site while Midad Cloud is not yet live.</p>
        </div>
        <Button disabled={rows.length === 0} onClick={() => exportCsv(rows)} size="sm" variant="outline">
          <Download className="size-4" /> Export CSV
        </Button>
      </div>
      <div className="mt-8 overflow-hidden rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Locale</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableRow>
                <TableCell className="py-8 text-center text-muted-foreground" colSpan={5}>
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell className="py-8 text-center text-muted-foreground" colSpan={5}>
                  No signups yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">{entry.email}</TableCell>
                  <TableCell>
                    {entry.source ? <Badge variant="secondary">{entry.source}</Badge> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{entry.locale ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(entry.createdAt)}</TableCell>
                  <TableCell className="text-end">
                    <Button
                      disabled={remove.isPending && remove.variables === entry.id}
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Delete waitlist entry',
                          description: `Remove ${entry.email} from the waitlist? This cannot be undone.`,
                          confirmLabel: 'Delete',
                          destructive: true,
                        });
                        if (ok) {
                          remove.mutate(entry.id);
                        }
                      }}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
