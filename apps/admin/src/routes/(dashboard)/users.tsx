import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@nibleaf/design-system/components/ui/card';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nibleaf/design-system/components/ui/table';
import { createFileRoute, Link, Outlet, useRouterState } from '@tanstack/react-router';
import { ChevronRight, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DataEmpty, DataError } from '@/components/data-state';
import { useSetUserRole, useSuspendUser } from '@/hooks/api/mutations';
import { type AdminUser, useAdminUsers } from '@/hooks/api/queries';
import { fmtDate, fmtRelative } from '@/lib/format';

export const Route = createFileRoute('/(dashboard)/users')({ component: UsersRoute });

type UserFilter = 'all' | 'active' | 'unverified' | 'suspended' | 'admin';

function UsersRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return pathname === '/users' ? <UsersPage /> : <Outlet />;
}

function UsersPage() {
  const query = useAdminUsers();
  const setRole = useSetUserRole();
  const suspend = useSuspendUser();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<UserFilter>('all');

  const users = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (query.data ?? []).filter((user) => {
      const matchesSearch = !needle || user.name.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle);
      const matchesFilter =
        filter === 'all' ||
        (filter === 'active' && !user.suspendedAt) ||
        (filter === 'unverified' && !user.emailVerified) ||
        (filter === 'suspended' && Boolean(user.suspendedAt)) ||
        (filter === 'admin' && user.role === 'admin');
      return matchesSearch && matchesFilter;
    });
  }, [filter, query.data, search]);

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
    if (ok) suspend.mutate({ id: user.id, suspend: suspending });
  };

  if (query.isError) return <DataError retry={() => void query.refetch()} />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">Customers</h1>
        <p className="mt-1 text-muted-foreground text-sm">Authentication, workspace access, and account state across Nibleaf Cloud.</p>
      </div>

      <div className="grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <label className="relative" htmlFor="customer-search">
          <span className="sr-only">Search customers</span>
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="ps-9"
            id="customer-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name or email"
            value={search}
          />
        </label>
        <label htmlFor="customer-filter">
          <span className="sr-only">Filter customers</span>
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            id="customer-filter"
            onChange={(event) => setFilter(event.target.value as UserFilter)}
            value={filter}
          >
            <option value="all">All customers</option>
            <option value="active">Active</option>
            <option value="unverified">Unverified email</option>
            <option value="suspended">Suspended</option>
            <option value="admin">Platform admins</option>
          </select>
        </label>
      </div>

      {query.isPending ? (
        <div className="rounded-xl border bg-card py-12 text-center text-muted-foreground text-sm" role="status">
          Loading customers…
        </div>
      ) : users.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <DataEmpty title="No customers match" description="Clear the search or choose another account filter." />
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
            <Table className="min-w-[980px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Auth</TableHead>
                  <TableHead>Workspaces</TableHead>
                  <TableHead>Last active</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <Link className="font-medium hover:underline" params={{ userId: user.id }} to="/users/$userId">
                        {user.name || 'Unnamed customer'}
                      </Link>
                      <p className="text-muted-foreground text-xs">{user.email}</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>{user.role}</Badge>
                        {user.suspendedAt ? <Badge variant="destructive">suspended</Badge> : null}
                        {!user.emailVerified ? <Badge variant="outline">unverified</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{user.providers.join(', ') || 'email OTP'}</TableCell>
                    <TableCell>{user.workspaces}</TableCell>
                    <TableCell className="text-muted-foreground">{user.lastActiveAt ? fmtRelative(user.lastActiveAt) : 'No session'}</TableCell>
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
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="grid gap-3 md:hidden">
            {users.map((user) => (
              <Card key={user.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-start justify-between gap-3 text-base">
                    <span className="min-w-0">
                      <span className="block truncate">{user.name || 'Unnamed customer'}</span>
                      <span className="block truncate font-normal text-muted-foreground text-xs">{user.email}</span>
                    </span>
                    <Button
                      nativeButton={false}
                      render={<Link aria-label={`View ${user.name || user.email}`} params={{ userId: user.id }} to="/users/$userId" />}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>{user.role}</Badge>
                    {user.suspendedAt ? <Badge variant="destructive">suspended</Badge> : null}
                    {!user.emailVerified ? <Badge variant="outline">unverified</Badge> : null}
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Workspaces</dt>
                      <dd className="mt-0.5 font-medium">{user.workspaces}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Last active</dt>
                      <dd className="mt-0.5 font-medium">{user.lastActiveAt ? fmtRelative(user.lastActiveAt) : 'No session'}</dd>
                    </div>
                  </dl>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      disabled={setRole.isPending && setRole.variables?.id === user.id}
                      onClick={() => setRole.mutate({ id: user.id, role: user.role === 'admin' ? 'user' : 'admin' })}
                      size="sm"
                      variant="outline"
                    >
                      {user.role === 'admin' ? 'Revoke admin' : 'Make admin'}
                    </Button>
                    {user.role !== 'admin' ? (
                      <Button
                        disabled={suspend.isPending && suspend.variables?.id === user.id}
                        onClick={() => onToggleSuspend(user)}
                        size="sm"
                        variant={user.suspendedAt ? 'outline' : 'destructive'}
                      >
                        {user.suspendedAt ? 'Unsuspend' : 'Suspend'}
                      </Button>
                    ) : (
                      <span />
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
      {!query.isPending ? (
        <p className="text-muted-foreground text-xs" aria-live="polite">
          Showing {users.length} of {query.data?.length ?? 0} customers
        </p>
      ) : null}
    </div>
  );
}
