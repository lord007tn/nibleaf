import { useForm } from '@tanstack/react-form';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FieldError } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useCancelInvitation, useInviteMember, useMembers, useUpdateMemberRole } from '@/hooks/api';
import type { Invitation, Member } from '@/hooks/api';
import { email as validateEmail } from '@/lib/form';
import { GradientAvatar, SettingsSection } from './section';

type Role = 'owner' | 'admin' | 'member';

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: 'member', label: 'Editor' },
  { value: 'admin', label: 'Admin' },
  { value: 'owner', label: 'Owner' },
];

const roleLabel = (role: string) => ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role;

function InviteDialog() {
  const [open, setOpen] = useState(false);
  const invite = useInviteMember();

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
              setOpen(false);
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" /> Invite
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>Send an invitation to collaborate on this workspace.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit();
          }}
        >
          <form.Field name="email" validators={{ onChange: ({ value }) => validateEmail(value) }}>
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  autoFocus
                  id="invite-email"
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
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invite-role">Role</Label>
                <Select onValueChange={(v) => field.handleChange((v ?? 'member') as Role)} value={field.state.value}>
                  <SelectTrigger className="w-full" id="invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </form.Field>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button disabled={isSubmitting} type="submit">
                  {isSubmitting ? 'Sending…' : 'Send invite'}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MemberRow({ member }: { member: Member }) {
  const updateRole = useUpdateMemberRole();
  const isOwner = member.role === 'owner';

  return (
    <div className="flex items-center gap-3 border-border border-t py-2.5 first:border-t-0">
      <GradientAvatar className="size-8 text-xs" name={member.user.name} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate font-medium text-sm">{member.user.name}</div>
        <div className="truncate text-muted-foreground text-xs">{member.user.email}</div>
      </div>
      {isOwner ? (
        <span className="rounded-md border border-border px-2.5 py-1 text-muted-foreground text-xs">{roleLabel(member.role)}</span>
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
          <SelectTrigger className="h-8 w-32" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function PendingRow({ invitation }: { invitation: Invitation }) {
  const cancel = useCancelInvitation();
  const initial = (invitation.email[0] ?? '?').toUpperCase();

  return (
    <div className="flex items-center gap-3 border-border border-t py-2.5 first:border-t-0">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted font-semibold text-muted-foreground text-xs">{initial}</span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate font-medium text-sm">{invitation.email}</div>
        <div className="truncate text-amber-600 text-xs dark:text-amber-400">Invited · awaiting response</div>
      </div>
      <span className="rounded-md border border-border px-2.5 py-1 text-muted-foreground text-xs">{roleLabel(invitation.role ?? 'member')}</span>
      <Button
        className="text-destructive hover:text-destructive"
        size="sm"
        variant="outline"
        onClick={() =>
          cancel.mutate(invitation.id, {
            onSuccess: () => toast.success('Invitation revoked'),
            onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not revoke the invitation'),
          })
        }
      >
        Revoke
      </Button>
    </div>
  );
}

export function MembersTab() {
  const { data, isPending } = useMembers();
  const members = data?.members ?? [];
  const invitations = data?.invitations ?? [];

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        action={<InviteDialog />}
        title={
          <span className="flex items-center gap-2">
            Members
            <span className="font-mono font-normal text-muted-foreground text-sm">{members.length}</span>
          </span>
        }
      >
        {isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : members.length === 0 ? (
          <p className="text-muted-foreground text-sm">No members yet.</p>
        ) : (
          <div className="flex flex-col">
            {members.map((member) => (
              <MemberRow key={member.id} member={member} />
            ))}
          </div>
        )}
      </SettingsSection>

      {invitations.length > 0 ? (
        <SettingsSection
          title={
            <span className="flex items-center gap-2">
              Pending invites
              <span className="font-mono font-normal text-muted-foreground text-sm">{invitations.length}</span>
            </span>
          }
        >
          <div className="flex flex-col">
            {invitations.map((invitation) => (
              <PendingRow key={invitation.id} invitation={invitation} />
            ))}
          </div>
        </SettingsSection>
      ) : null}
    </div>
  );
}
