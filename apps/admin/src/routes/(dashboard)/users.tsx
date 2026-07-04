import { Badge } from '@midad/design-system/components/ui/badge';
import { Button } from '@midad/design-system/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@midad/design-system/components/ui/table';
import { createFileRoute } from '@tanstack/react-router';
import { useSetUserRole } from '@/hooks/api/mutations';
import { useAdminUsers } from '@/hooks/api/queries';
import { fmtDate } from '@/lib/format';

export const Route = createFileRoute('/(dashboard)/users')({
  component: UsersPage,
});

function UsersPage() {
  const { data, isPending } = useAdminUsers();
  const setRole = useSetUserRole();
  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <h1 className="font-semibold text-2xl tracking-tight">Users</h1>
      <p className="mt-1 text-muted-foreground text-sm">Everyone with an account on this instance. Grant or revoke platform admin access.</p>
      <div className="mt-8 overflow-hidden rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Workspaces</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableRow>
                <TableCell className="py-8 text-center text-muted-foreground" colSpan={6}>
                  Loading…
                </TableCell>
              </TableRow>
            ) : (
              data?.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell className="text-muted-foreground">{user.email}</TableCell>
                  <TableCell>
                    <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>{user.role}</Badge>
                  </TableCell>
                  <TableCell>{user.workspaces}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(user.createdAt)}</TableCell>
                  <TableCell className="text-end">
                    <Button
                      disabled={setRole.isPending && setRole.variables?.id === user.id}
                      onClick={() => setRole.mutate({ id: user.id, role: user.role === 'admin' ? 'user' : 'admin' })}
                      size="sm"
                      variant="outline"
                    >
                      {user.role === 'admin' ? 'Revoke admin' : 'Make admin'}
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
