import { Button } from '@midad/design-system/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@midad/design-system/components/ui/table';
import { createFileRoute } from '@tanstack/react-router';
import { ExternalLink } from 'lucide-react';
import { useAdminSites } from '@/hooks/api/queries';
import { fmtDate } from '@/lib/format';
import { APP_URL } from '@/lib/links';

export const Route = createFileRoute('/(dashboard)/sites')({
  component: SitesPage,
});

function SitesPage() {
  const { data, isPending } = useAdminSites();
  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <h1 className="font-semibold text-2xl tracking-tight">Sites</h1>
      <p className="mt-1 text-muted-foreground text-sm">Every documentation site across all workspaces on this instance.</p>
      <div className="mt-8 overflow-hidden rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Workspace</TableHead>
              <TableHead>Pages</TableHead>
              <TableHead>Deploys</TableHead>
              <TableHead>Created</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableRow>
                <TableCell className="py-8 text-center text-muted-foreground" colSpan={7}>
                  Loading…
                </TableCell>
              </TableRow>
            ) : (
              data?.map((site) => (
                <TableRow key={site.id}>
                  <TableCell className="font-medium">{site.name}</TableCell>
                  <TableCell className="text-muted-foreground">{site.owner}</TableCell>
                  <TableCell className="text-muted-foreground">{site.org}</TableCell>
                  <TableCell>{site.pages}</TableCell>
                  <TableCell>{site.deployments}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(site.createdAt)}</TableCell>
                  <TableCell className="text-end">
                    <Button
                      nativeButton={false}
                      render={
                        // biome-ignore lint/a11y/useAnchorContent: content merged via Base UI render prop
                        <a aria-label="Open live site" href={`${APP_URL}/sites/${site.id}`} rel="noreferrer" target="_blank" />
                      }
                      size="icon-sm"
                      variant="ghost"
                    >
                      <ExternalLink className="size-4" />
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
