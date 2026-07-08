import { Button } from '@nibleaf/design-system/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@nibleaf/design-system/components/ui/dialog';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useForm } from '@tanstack/react-form';
import { Check, Link2, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Invitation, Member } from '@/hooks/api';
import { useCancelInvitation, useInviteMember, useMembers, useUpdateMemberRole } from '@/hooks/api';
import { email as validateEmail } from '@/lib/form';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { copyToClipboard, inviteAcceptUrl } from '@/lib/invitations';
import { GradientAvatar, SettingsSection } from './section';

type Role = 'owner' | 'admin' | 'member';

const ROLE_OPTIONS: Array<{ value: Role; labelKey: MessageKey }> = [
  { value: 'member', labelKey: 'settings.members.role.member' },
  { value: 'admin', labelKey: 'settings.members.role.admin' },
  { value: 'owner', labelKey: 'settings.members.role.owner' },
];

const roleLabelKey = (role: string): MessageKey => ROLE_OPTIONS.find((r) => r.value === role)?.labelKey ?? 'settings.members.role.member';

function InviteDialog() {
  const t = useT();
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
              toast.success(t('settings.members.toast.invited', { email: invited }));
              form.reset();
              setOpen(false);
              resolve();
            },
            onError: (error) => {
              toast.error(error instanceof Error ? error.message : t('settings.members.toast.inviteError'));
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
        <Plus className="size-4" /> {t('settings.members.invite')}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.members.inviteTitle')}</DialogTitle>
          <DialogDescription>{t('settings.members.inviteDescription')}</DialogDescription>
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
                <Label htmlFor="invite-email">{t('settings.members.emailLabel')}</Label>
                <Input
                  autoFocus
                  id="invite-email"
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder={t('settings.members.emailPlaceholder')}
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
                <Label htmlFor="invite-role">{t('settings.members.roleLabel')}</Label>
                <Select onValueChange={(v) => field.handleChange((v ?? 'member') as Role)} value={field.state.value}>
                  <SelectTrigger className="w-full" id="invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </form.Field>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>{t('common.cancel')}</DialogClose>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button disabled={isSubmitting} type="submit">
                  {isSubmitting ? t('settings.members.sending') : t('settings.members.sendInvite')}
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
  const t = useT();
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
        <span className="rounded-md border border-border px-2.5 py-1 text-muted-foreground text-xs">{t(roleLabelKey(member.role))}</span>
      ) : (
        <Select
          value={member.role}
          onValueChange={(v) =>
            updateRole.mutate(
              { id: member.id, body: { role: (v ?? 'member') as Role } },
              {
                onSuccess: () => toast.success(t('settings.members.toast.roleUpdated')),
                onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.members.toast.roleError')),
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
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function PendingRow({ invitation }: { invitation: Invitation }) {
  const t = useT();
  const cancel = useCancelInvitation();
  const initial = (invitation.email[0] ?? '?').toUpperCase();
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    const ok = await copyToClipboard(inviteAcceptUrl(invitation.id));
    if (ok) {
      setCopied(true);
      toast.success(t('settings.members.linkCopied'));
      setTimeout(() => setCopied(false), 1500);
    } else {
      toast.error(t('settings.members.copyFailed'));
    }
  };

  return (
    <div className="flex items-center gap-3 border-border border-t py-2.5 first:border-t-0">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted font-semibold text-muted-foreground text-xs">{initial}</span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate font-medium text-sm">{invitation.email}</div>
        <div className="truncate text-amber-600 text-xs dark:text-amber-400">{t('settings.members.awaitingResponse')}</div>
      </div>
      <span className="rounded-md border border-border px-2.5 py-1 text-muted-foreground text-xs">
        {t(roleLabelKey(invitation.role ?? 'member'))}
      </span>
      <Button onClick={copyLink} size="sm" variant="outline">
        {copied ? <Check className="size-4" /> : <Link2 className="size-4" />} {t('settings.members.copyLink')}
      </Button>
      <Button
        className="text-destructive hover:text-destructive"
        size="sm"
        variant="outline"
        onClick={() =>
          cancel.mutate(invitation.id, {
            onSuccess: () => toast.success(t('settings.members.toast.invitationRevoked')),
            onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.members.toast.revokeError')),
          })
        }
      >
        {t('settings.members.revoke')}
      </Button>
    </div>
  );
}

export function MembersTab() {
  const t = useT();
  const { data, isPending } = useMembers();
  const members = data?.members ?? [];
  const invitations = data?.invitations ?? [];

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        action={<InviteDialog />}
        title={
          <span className="flex items-center gap-2">
            {t('settings.members.title')}
            <span className="font-mono font-normal text-muted-foreground text-sm">{members.length}</span>
          </span>
        }
      >
        {isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : members.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('settings.members.empty')}</p>
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
              {t('settings.members.pendingInvitations')}
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
