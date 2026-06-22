import { useForm } from '@tanstack/react-form';
import { Mail, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { GradientAvatar } from '@/components/settings/section';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useCancelProjectInvitation,
  useInviteProjectMember,
  useProjectMembers,
  useRemoveProjectMember,
  useUpdateProjectMemberRole,
} from '@/hooks/api';
import { email as validateEmail } from '@/lib/form';
import { SectionHeader } from './shared';

type Role = 'owner' | 'admin' | 'member';
const ROLE_LABELS: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Editor' };

export function MembersSection({ projectId }: { projectId: string }) {
  const { data, isPending } = useProjectMembers(projectId);
  const invite = useInviteProjectMember(projectId);
  const remove = useRemoveProjectMember(projectId);
  const updateRole = useUpdateProjectMemberRole(projectId);
  const cancelInvite = useCancelProjectInvitation(projectId);

  const members = data?.members ?? [];
  const invitations = data?.invitations ?? [];

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
    <div>
      <SectionHeader icon="⧉" title="Members" description="People who can access and edit this site. Each site has its own members and roles." />

      <form
        className="mb-5 flex items-end gap-2.5 rounded-xl border border-border bg-card p-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          form.handleSubmit();
        }}
      >
        <form.Field name="email" validators={{ onChange: ({ value }) => validateEmail(value) }}>
          {(field) => (
            <div className="flex flex-1 flex-col gap-1.5">
              <span className="font-medium text-[13px]">Invite by email</span>
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
        <form.Subscribe selector={(state) => [state.isSubmitting, state.values.email] as const}>
          {([isSubmitting, emailValue]) => (
            <Button disabled={isSubmitting || !emailValue.trim()} type="submit">
              <Mail className="size-4" /> Invite
            </Button>
          )}
        </form.Subscribe>
      </form>

      <div className="mb-3 font-mono text-[12px] text-muted-foreground">
        {members.length} {members.length === 1 ? 'member' : 'members'}
      </div>

      {isPending ? (
        <Skeleton className="h-12 w-full rounded-xl" />
      ) : (
        <>
          {members.map((member) => (
            <div className="flex items-center gap-3 border-border border-t py-3" key={member.id}>
              <GradientAvatar className="size-8 text-[12px]" name={member.user.name} />
              <div className="min-w-0 leading-tight">
                <div className="truncate font-medium text-[13.5px]">{member.user.name}</div>
                <div className="truncate text-[12px] text-muted-foreground">{member.user.email}</div>
              </div>
              <div className="ms-auto flex items-center gap-1.5">
                {member.role === 'owner' ? (
                  <span className="rounded-md border border-border px-2.5 py-1 text-[12px] text-muted-foreground">Owner</span>
                ) : (
                  <>
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
                      <SelectTrigger className="h-8 w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">Editor</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="owner">Owner</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() =>
                        remove.mutate(member.id, {
                          onSuccess: () => toast.success('Member removed'),
                          onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not remove the member'),
                        })
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
          {members.length === 0 ? <p className="border-border border-t py-3 text-muted-foreground text-sm">No members yet.</p> : null}

          {invitations.length > 0 ? (
            <>
              <div className="mt-6 mb-1 font-mono text-[12px] text-muted-foreground">Pending invitations</div>
              {invitations.map((inv) => (
                <div className="flex items-center gap-3 border-border border-t py-3" key={inv.id}>
                  <div className="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground">
                    <Mail className="size-4" />
                  </div>
                  <div className="min-w-0 leading-tight">
                    <div className="truncate font-medium text-[13.5px]">{inv.email}</div>
                    <div className="text-[12px] text-muted-foreground">Invited as {ROLE_LABELS[inv.role ?? 'member'] ?? inv.role}</div>
                  </div>
                  <Button
                    className="ms-auto"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() =>
                      cancelInvite.mutate(inv.id, {
                        onSuccess: () => toast.success('Invitation revoked'),
                        onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not revoke the invitation'),
                      })
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
