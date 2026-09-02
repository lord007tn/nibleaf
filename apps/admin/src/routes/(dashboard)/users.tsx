import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@nibleaf/design-system/components/ui/card';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nibleaf/design-system/components/ui/table';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link, Outlet, useRouterState } from '@tanstack/react-router';
import { ChevronRight, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DataEmpty, DataError } from '@/components/data-state';
import { useSetUserRole, useSuspendUser } from '@/hooks/api/mutations';
import { type AdminUser, useAdminUsers } from '@/hooks/api/queries';
import { useFormatters } from '@/lib/format';

export const Route = createFileRoute('/(dashboard)/users')({ component: UsersRoute });

type UserFilter = 'all' | 'active' | 'unverified' | 'suspended' | 'admin';

function UsersRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return pathname === '/users' ? <UsersPage /> : <Outlet />;
}

function UsersPage() {
  const t = useT();
  const format = useFormatters();
  const query = useAdminUsers();
  const setRole = useSetUserRole();
  const suspend = useSuspendUser();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<UserFilter>('all');
  const filterOptions = [
    { value: 'all', label: t('admin.users.all') },
    { value: 'active', label: t('admin.status.active') },
    { value: 'unverified', label: t('admin.status.unverified') },
    { value: 'suspended', label: t('admin.status.suspended') },
    { value: 'admin', label: t('admin.users.platformAdmins') },
  ] satisfies { value: UserFilter; label: string }[];

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
            title: t('admin.users.suspendTitle', { user: user.name || user.email }),
            description: t('admin.users.suspendBody'),
            confirmLabel: t('admin.users.suspendAccount'),
            destructive: true,
          }
        : {
            title: t('admin.users.unsuspendTitle', { user: user.name || user.email }),
            description: t('admin.users.unsuspendBody'),
            confirmLabel: t('admin.users.liftSuspension'),
          },
    );
    if (ok) suspend.mutate({ id: user.id, suspend: suspending });
  };

  if (query.isError) return <DataError retry={() => void query.refetch()} />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">{t('admin.nav.customers')}</h1>
        <p className="mt-1 text-muted-foreground text-sm">{t('admin.users.subtitle')}</p>
      </div>

      <div className="grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <label className="relative" htmlFor="customer-search">
          <span className="sr-only">{t('admin.users.search')}</span>
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="ps-9"
            id="customer-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('admin.users.searchPlaceholder')}
            value={search}
          />
        </label>
        <div>
          <Label className="sr-only" htmlFor="customer-filter">
            {t('admin.users.filter')}
          </Label>
          <Select items={filterOptions} onValueChange={(value) => setFilter(value ?? 'all')} value={filter}>
            <SelectTrigger className="w-full bg-background" id="customer-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {filterOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {query.isPending ? (
        <div className="rounded-xl border bg-card py-12 text-center text-muted-foreground text-sm" role="status">
          {t('admin.users.loading')}
        </div>
      ) : users.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <DataEmpty title={t('admin.users.empty')} description={t('admin.users.emptyBody')} />
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
            <Table className="min-w-[980px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.users.customer')}</TableHead>
                  <TableHead>{t('admin.common.status')}</TableHead>
                  <TableHead>{t('admin.users.auth')}</TableHead>
                  <TableHead>{t('admin.common.workspaces')}</TableHead>
                  <TableHead>{t('admin.common.lastActive')}</TableHead>
                  <TableHead>{t('admin.common.joined')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('admin.common.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <Link className="font-medium hover:underline" params={{ userId: user.id }} to="/users/$userId">
                        {user.name || t('admin.users.unnamed')}
                      </Link>
                      <p className="text-muted-foreground text-xs">{user.email}</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>{user.role}</Badge>
                        {user.suspendedAt ? <Badge variant="destructive">{t('admin.status.suspended')}</Badge> : null}
                        {!user.emailVerified ? <Badge variant="outline">{t('admin.status.unverified')}</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{user.providers.join(', ') || t('admin.users.emailOtp')}</TableCell>
                    <TableCell>{format.number(user.workspaces)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {user.lastActiveAt ? format.relative(user.lastActiveAt) : t('admin.users.noSession')}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{format.date(user.createdAt)}</TableCell>
                    <TableCell className="text-end">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          disabled={setRole.isPending && setRole.variables?.id === user.id}
                          onClick={() => setRole.mutate({ id: user.id, role: user.role === 'admin' ? 'user' : 'admin' })}
                          size="sm"
                          variant="outline"
                        >
                          {user.role === 'admin' ? t('admin.users.revokeAdmin') : t('admin.users.makeAdmin')}
                        </Button>
                        {user.role !== 'admin' ? (
                          <Button
                            disabled={suspend.isPending && suspend.variables?.id === user.id}
                            onClick={() => onToggleSuspend(user)}
                            size="sm"
                            variant={user.suspendedAt ? 'outline' : 'destructive'}
                          >
                            {user.suspendedAt ? t('admin.users.unsuspend') : t('admin.users.suspend')}
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
                      <span className="block truncate">{user.name || t('admin.users.unnamed')}</span>
                      <span className="block truncate font-normal text-muted-foreground text-xs">{user.email}</span>
                    </span>
                    <Button
                      nativeButton={false}
                      render={
                        <Link
                          aria-label={t('admin.users.view', { user: user.name || user.email })}
                          params={{ userId: user.id }}
                          to="/users/$userId"
                        />
                      }
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
                    {user.suspendedAt ? <Badge variant="destructive">{t('admin.status.suspended')}</Badge> : null}
                    {!user.emailVerified ? <Badge variant="outline">{t('admin.status.unverified')}</Badge> : null}
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <dt className="text-muted-foreground">{t('admin.common.workspaces')}</dt>
                      <dd className="mt-0.5 font-medium">{format.number(user.workspaces)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t('admin.common.lastActive')}</dt>
                      <dd className="mt-0.5 font-medium">{user.lastActiveAt ? format.relative(user.lastActiveAt) : t('admin.users.noSession')}</dd>
                    </div>
                  </dl>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      disabled={setRole.isPending && setRole.variables?.id === user.id}
                      onClick={() => setRole.mutate({ id: user.id, role: user.role === 'admin' ? 'user' : 'admin' })}
                      size="sm"
                      variant="outline"
                    >
                      {user.role === 'admin' ? t('admin.users.revokeAdmin') : t('admin.users.makeAdmin')}
                    </Button>
                    {user.role !== 'admin' ? (
                      <Button
                        disabled={suspend.isPending && suspend.variables?.id === user.id}
                        onClick={() => onToggleSuspend(user)}
                        size="sm"
                        variant={user.suspendedAt ? 'outline' : 'destructive'}
                      >
                        {user.suspendedAt ? t('admin.users.unsuspend') : t('admin.users.suspend')}
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
          {t('admin.users.showing', { shown: format.number(users.length), total: format.number(query.data?.length ?? 0) })}
        </p>
      ) : null}
    </div>
  );
}
