import { useForm } from '@tanstack/react-form';
import { createFileRoute } from '@tanstack/react-router';
import { Mail, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@midad/design-system/components/ui/button';
import { FieldError } from '@midad/design-system/components/ui/form-field';
import { Input } from '@midad/design-system/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@midad/design-system/components/ui/select';
import { Skeleton } from '@midad/design-system/components/ui/skeleton';
import { useInviteMember, useMembers, useRemoveMember, useUpdateMemberRole } from '@/hooks/api';
import { email as validateEmail } from '@/lib/form';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

export const Route = createFileRoute('/app/(dashboard)/members')({
  component: MembersPage,
});

type Role = 'owner' | 'admin' | 'member';

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

  const form = useForm({
    defaultValues: { email: '', role: 'member' as Role },
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
        className="flex items-end gap-3 rounded-xl border border-border bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault();
          form.handleSubmit();
        }}
      >
        <form.Field name="email" validators={{ onChange: ({ value }) => validateEmail(value) }}>
          {(field) => (
            <div className="flex flex-1 flex-col gap-1.5">
              <span className="font-medium text-sm">{t('members.inviteByEmail')}</span>
              <Input
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
        <form.Field name="role">
          {(field) => (
            <Select onValueChange={(v) => field.handleChange((v ?? 'member') as Role)} value={field.state.value}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">{t('members.role.editor')}</SelectItem>
                <SelectItem value="admin">{t('members.role.admin')}</SelectItem>
                <SelectItem value="owner">{t('members.role.owner')}</SelectItem>
              </SelectContent>
            </Select>
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button disabled={isSubmitting} type="submit">
              <Mail className="size-4" /> {t('members.invite')}
            </Button>
          )}
        </form.Subscribe>
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
                        value={member.role}
                        onValueChange={(v) =>
                          updateRole.mutate(
                            { id: member.id, body: { role: (v ?? 'member') as Role } },
                            {
                              onSuccess: () => toast.success(t('members.toast.roleUpdated')),
                              onError: (error) => toast.error(error instanceof Error ? error.message : t('members.toast.roleUpdateError')),
                            },
                          )
                        }
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">{t('members.role.editor')}</SelectItem>
                          <SelectItem value="admin">{t('members.role.admin')}</SelectItem>
                          <SelectItem value="owner">{t('members.role.owner')}</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                  <td className="px-4 py-3 text-end">
                    {member.role === 'owner' ? null : (
                      <Button
                        size="icon-sm"
                        variant="ghost"
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

