import { Button } from '@nibleaf/design-system/components/ui/button';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { useForm } from '@tanstack/react-form';
import { createFileRoute } from '@tanstack/react-router';
import { Mail, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useInviteMember, useMembers, useRemoveMember, useUpdateMemberRole } from '@/hooks/api';
import { email as validateEmail } from '@/lib/form';

export const Route = createFileRoute('/app/(dashboard)/members')({
  component: MembersPage,
});

/** Grantable roles — `owner` is intentionally absent: a workspace has exactly
 *  one owner, and ownership only moves via the transfer-ownership flow. */
type AssignableRole = 'admin' | 'member';

/** Map a role value to its localized label key (editor = member). */
const roleLabelKey = (role: string | null | undefined): MessageKey => {
  if (role === 'owner') {
    return 'members.role.owner';
  }
  if (role === 'admin') {
    return 'members.role.admin';
  }
  return 'members.role.editor';
};

function MembersPage() {
  const t = useT();
  const { data, isPending } = useMembers();
  const invite = useInviteMember();
  const remove = useRemoveMember();
  const updateRole = useUpdateMemberRole();
  // No `owner` option: invitations and role changes can never grant ownership.
  // One array feeds both the trigger label (`items`) and the rendered options so they can't drift.
  const roleOptions = [
    { value: 'member', label: t('members.role.editor') },
    { value: 'admin', label: t('members.role.admin') },
  ] as const satisfies ReadonlyArray<{ value: AssignableRole; label: string }>;

  const form = useForm({
    defaultValues: { email: '', role: 'member' as AssignableRole },
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
              toast.error(error instanceof Error ? error.message : t('members.toast.inviteError'));
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
              <Select items={roleOptions} onValueChange={(v) => field.handleChange(v ?? 'member')} value={field.state.value}>
                <SelectTrigger aria-label={t('members.col.role')} className="min-w-0 flex-1 sm:w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roleOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button className="flex-1 sm:flex-none" disabled={isSubmitting} type="submit">
                <Mail className="size-4" /> {t('members.invite')}
              </Button>
            )}
          </form.Subscribe>
        </div>
      </form>

      <div className="overflow-hidden rounded-xl border border-border">
        {isPending ? (
          <div className="p-4">
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border border-b bg-muted/50 text-muted-foreground">
                <th className="px-4 py-2.5 text-start font-medium">{t('members.col.member')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('members.col.role')}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {(data?.members ?? []).map((member) => (
                <tr key={member.id} className="border-border border-b last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{member.user.name}</div>
                    <div className="text-muted-foreground text-xs">{member.user.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    {member.role === 'owner' ? (
                      <span>{t('members.role.owner')}</span>
                    ) : (
                      <Select
                        items={roleOptions}
                        value={member.role}
                        onValueChange={(v) =>
                          updateRole.mutate(
                            { id: member.id, body: { role: (v ?? 'member') as AssignableRole } },
                            {
                              onSuccess: () => toast.success(t('members.toast.roleUpdated')),
                              onError: (error) => toast.error(error instanceof Error ? error.message : t('members.toast.roleUpdateError')),
                            },
                          )
                        }
                      >
                        <SelectTrigger aria-label={t('members.col.role')} className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {roleOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                  <td className="px-4 py-3 text-end">
                    {member.role === 'owner' ? null : (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('members.remove')}
                        title={t('members.remove')}
                        onClick={() => remove.mutate(member.id, { onSuccess: () => toast.success(t('members.toast.removed')) })}
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
