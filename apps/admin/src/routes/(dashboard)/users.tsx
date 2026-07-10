import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nibleaf/design-system/components/ui/table';
import { createFileRoute } from '@tanstack/react-router';
import { useSetUserRole, useSuspendUser } from '@/hooks/api/mutations';
import { type AdminUser, useAdminUsers } from '@/hooks/api/queries';
import { fmtDate } from '@/lib/format';

export const Route = createFileRoute('/(dashboard)/users')({
  component: UsersPage,
});

function UsersPage() {
  const { data, isPending } = useAdminUsers();
  const setRole = useSetUserRole();
  const suspend = useSuspendUser();
  const confirm = useConfirm();

  const onToggleSuspend = async (user: AdminUser) => {
    const suspending = !user.suspendedAt;
    const ok = await confirm(
      suspending
        ? {
            title: `Suspend ${user.name || user.email}?`,
            description: 'They are signed out everywhere and blocked from signing in until the suspension is lifted. Their sites stay online.',
            confirmLabel: 'Suspend account',
            destructive: true,
          }
        : {
            title: `Lift the suspension for ${user.name || user.email}?`,
            description: 'They can sign in and use their workspaces again.',
            confirmLabel: 'Lift suspension',
          },
    );
    if (ok) {
      suspend.mutate({ id: user.id, suspend: suspending });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">Customers</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Every customer account on Nibleaf Cloud. Grant or revoke platform admin access, or suspend abusive accounts.
        </p>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Workspaces</TableHead>
              <TableHead>Joined</TableHead>
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
              data?.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell className="text-muted-foreground">{user.email}</TableCell>
                  <TableCell>
                    <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>{user.role}</Badge>
                  </TableCell>
                  <TableCell>
                    {user.suspendedAt ? (
                      <Badge variant="destructive">Suspended {fmtDate(user.suspendedAt)}</Badge>
                    ) : (
                      <Badge variant="secondary">Active</Badge>
                    )}
                  </TableCell>
                  <TableCell>{user.workspaces}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(user.createdAt)}</TableCell>
                  <TableCell className="text-end">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        disabled={setRole.isPending && setRole.variables?.id === user.id}
                        onClick={() => setRole.mutate({ id: user.id, role: user.role === 'admin' ? 'user' : 'admin' })}
                        size="sm"
                        variant="outline"
                      >
                        {user.role === 'admin' ? 'Revoke admin' : 'Make admin'}
                      </Button>
                      {/* Admins can never be suspended (server refuses); demote first. */}
                      {user.role !== 'admin' ? (
                        <Button
                          disabled={suspend.isPending && suspend.variables?.id === user.id}
                          onClick={() => onToggleSuspend(user)}
                          size="sm"
                          variant={user.suspendedAt ? 'outline' : 'destructive'}
                        >
                          {user.suspendedAt ? 'Unsuspend' : 'Suspend'}
                        </Button>
                      ) : null}
                    </div>
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
