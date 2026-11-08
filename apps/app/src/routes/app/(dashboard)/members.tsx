import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useT } from '@nibleaf/i18n/react';
import type { AssignableMemberRole } from '@nibleaf/shared/rbac';
import { useForm } from '@tanstack/react-form';
import { createFileRoute } from '@tanstack/react-router';
import { Mail, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { RoleSelect } from '@/components/members/role-select';
import { QueryErrorState } from '@/components/query-error-state';
import { friendlyErrorMessage, useInviteMember, useMembers, useRemoveMember, useUpdateMemberRole } from '@/hooks/api';
import { membersQueryOptions } from '@/hooks/api/query-options';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { email as validateEmail } from '@/lib/form';
import { DEFAULT_INVITE_ROLE, roleLabelKey } from '@/lib/member-roles';

const MEMBER_SKELETON_ROWS = ['a', 'b', 'c'];

export const Route = createFileRoute('/app/(dashboard)/members')({
  loader: ({ context: { queryClient } }) => prefetchRouteData(queryClient, membersQueryOptions()),
  component: MembersPage,
});

function MembersPage() {
  const t = useT();
  const { data, isPending, isError, isFetching, refetch } = useMembers();
  const invite = useInviteMember();
  const remove = useRemoveMember();
  const updateRole = useUpdateMemberRole();
  const confirm = useConfirm();
  // Removing someone is not undoable here, so ask first (same copy as site settings → Members).
  const removeMember = async (member: { id: string; user: { name: string | null; email: string } }) => {
    const name = member.user.name || member.user.email;
    const ok = await confirm({
      title: t('members.remove'),
      description: t('settings.members.removeConfirm', { name }),
      confirmLabel: t('members.remove'),
      destructive: true,
    });
    if (!ok) return;
    remove.mutate(member.id, {
      onSuccess: () => toast.success(t('members.toast.removed')),
      onError: (error) =>
        toast.error(friendlyErrorMessage(t, error, 'settings.members.toast.removeError', { 409: 'settings.members.toast.removeError' })),
    });
  };
  // RoleSelect never offers `owner`: invitations and role changes can never grant ownership.
  const form = useForm({
    defaultValues: { email: '', role: DEFAULT_INVITE_ROLE as AssignableMemberRole },
    onSubmit: async ({ value }) => {
      const invited = value.email.trim();
      await new Promise<void>((resolve) => {
        invite.mutate(
          { email: invited, role: value.role },
          {
            onSuccess: () => {
              toast.success(t('members.toast.invited', { email: invited }));
              form.reset();
              resolve();
            },
            onError: (error) => {
              // Server text is English and technical; say what happened in plain words.
              // 409: that person is already a member.
              toast.error(friendlyErrorMessage(t, error, 'members.toast.inviteError', { 409: 'members.toast.alreadyMember' }));
              resolve();
            },
          },
        );
      });
    },
  });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-semibold text-3xl tracking-tight">{t('members.title')}</h1>
        <p className="mt-1 text-muted-foreground text-sm">{t('members.subtitle')}</p>
      </div>

      <form
        className="flex flex-col items-stretch gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          form.handleSubmit();
        }}
      >
        <form.Field name="email" validators={{ onChange: ({ value }) => validateEmail(value, t) }}>
          {(field) => (
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label className="font-medium text-sm" htmlFor="workspace-member-email">
                {t('members.inviteByEmail')}
              </Label>
              <Input
                id="workspace-member-email"
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="teammate@company.com"
                type="email"
                value={field.state.value}
              />
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
        <div className="flex w-full items-end gap-3 sm:w-auto">
          <form.Field name="role">
            {(field) => (
              <RoleSelect
                ariaLabel={t('members.col.role')}
                className="min-w-0 flex-1 sm:w-32"
                onValueChange={field.handleChange}
                value={field.state.value}
              />
            )}
          </form.Field>
          <Button className="flex-1 sm:flex-none" loading={invite.isPending} type="submit">
            <Mail className="size-4" /> {t('members.invite')}
          </Button>
        </div>
      </form>

      {isError && !data ? <QueryErrorState onRetry={() => void refetch()} retrying={isFetching} /> : null}

      <div aria-busy={isPending && !isError ? true : undefined} className="overflow-hidden rounded-xl border border-border">
        {isPending && !isError ? (
          <p className="sr-only" role="status">
            {t('common.loading')}
          </p>
        ) : null}
        {isError && !data ? null : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border border-b bg-muted/50 text-muted-foreground">
                <th className="px-4 py-2.5 text-start font-medium">{t('members.col.member')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('members.col.role')}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {/* Shaped like a member row: name over email, the role picker, the remove button. */}
              {isPending
                ? MEMBER_SKELETON_ROWS.map((row) => (
                    <tr aria-hidden className="border-border border-b last:border-0" key={row}>
                      <td className="px-4 py-3">
                        <Skeleton className="h-4 w-36" />
                        <Skeleton className="mt-1.5 h-3 w-48 max-w-full" />
                      </td>
                      <td className="px-4 py-3">
                        <Skeleton className="h-8 w-32" />
                      </td>
                      <td className="px-4 py-3">
                        <Skeleton className="ms-auto size-7" />
                      </td>
                    </tr>
                  ))
                : null}
              {(data?.members ?? []).map((member) => (
                <tr key={member.id} className="border-border border-b last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{member.user.name}</div>
                    <div className="text-muted-foreground text-xs">{member.user.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    {member.role === 'owner' ? (
                      <span>{t('roles.owner')}</span>
                    ) : (
                      <RoleSelect
                        ariaLabel={t('members.col.role')}
                        className="w-32"
                        value={member.role as AssignableMemberRole}
                        onValueChange={(role) =>
                          updateRole.mutate(
                            { id: member.id, body: { role } },
                            {
                              onSuccess: () => toast.success(t('members.toast.roleUpdated')),
                              onError: (error) =>
                                toast.error(
                                  friendlyErrorMessage(t, error, 'members.toast.roleUpdateError', { 409: 'members.toast.roleUpdateError' }),
                                ),
                            },
                          )
                        }
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 text-end">
                    {member.role === 'owner' ? null : (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('members.remove')}
                        title={t('members.remove')}
                        loading={remove.isPending && remove.variables === member.id}
                        onClick={() => void removeMember(member)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {(data?.invitations ?? []).map((inv) => (
                <tr key={inv.id} className="border-border border-b bg-muted/20 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{inv.email}</div>
                    <div className="text-muted-foreground text-xs">{t('members.invitationPending')}</div>
                  </td>
                  <td className="px-4 py-3">{t(roleLabelKey(inv.role))}</td>
                  <td className="px-4 py-3 text-end font-mono text-muted-foreground text-xs">{t('members.pending')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
