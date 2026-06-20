import { useForm } from '@tanstack/react-form';
import { createFileRoute } from '@tanstack/react-router';
import { Mail, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useInviteMember, useMembers, useRemoveMember, useUpdateMemberRole } from '@/hooks/api';
import { email as validateEmail } from '@/lib/form';

export const Route = createFileRoute('/app/(dashboard)/members')({
  component: MembersPage,
});

type Role = 'owner' | 'admin' | 'member';

function MembersPage() {
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
              toast.success(`Invited ${invited}`);
              form.reset();
              resolve();
            },
            onError: (error) => {
              toast.error(error instanceof Error ? error.message : 'Could not invite');
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
        <h1 className="font-semibold text-3xl tracking-tight">Members</h1>
        <p className="mt-1 text-muted-foreground text-sm">Invite teammates to collaborate on documentation.</p>
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
              <span className="font-medium text-sm">Invite by email</span>
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
                <SelectItem value="member">Editor</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="owner">Owner</SelectItem>
              </SelectContent>
            </Select>
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button disabled={isSubmitting} type="submit">
              <Mail className="size-4" /> Invite
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
                <th className="px-4 py-2.5 text-start font-medium">Member</th>
                <th className="px-4 py-2.5 text-start font-medium">Role</th>
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
                      <span className="capitalize">{member.role}</span>
                    ) : (
                      <Select
                        value={member.role}
                        onValueChange={(v) =>
                          updateRole.mutate(
                            { id: member.id, body: { role: (v ?? 'member') as Role } },
                            {
                              onSuccess: () => toast.success('Role updated'),
                              onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not update the role'),
                            },
                          )
                        }
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">Editor</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="owner">Owner</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                  <td className="px-4 py-3 text-end">
                    {member.role === 'owner' ? null : (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => remove.mutate(member.id, { onSuccess: () => toast.success('Member removed') })}
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
                    <div className="text-muted-foreground text-xs">Invitation pending</div>
                  </td>
                  <td className="px-4 py-3 capitalize">{inv.role ?? 'member'}</td>
                  <td className="px-4 py-3 text-end font-mono text-muted-foreground text-xs">pending</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
