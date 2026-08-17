import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useForm } from '@tanstack/react-form';
import { Check, Copy, Crown, Link2, Mail, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { GradientAvatar } from '@/components/settings/section';
import {
  useCancelProjectInvitation,
  useInviteProjectMember,
  useProjectMembers,
  useRemoveProjectMember,
  useTransferProjectOwnership,
  useUpdateProjectMemberRole,
} from '@/hooks/api';
import { useSession } from '@/lib/auth-client';
import { email as validateEmail } from '@/lib/form';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { copyToClipboard, inviteAcceptUrl } from '@/lib/invitations';
import { SectionHeader } from './shared';

/** A small button that copies an invite link to the clipboard with feedback. */
function CopyLinkButton({ link, label }: { link: string; label: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      title={label}
      aria-label={label}
      onClick={async () => {
        const ok = await copyToClipboard(link);
        if (ok) {
          setCopied(true);
          toast.success(t('settings.members.linkCopied'));
          setTimeout(() => setCopied(false), 1500);
        } else {
          toast.error(t('settings.members.copyFailed'));
        }
      }}
    >
      {copied ? <Check className="size-4" /> : <Link2 className="size-4" />}
    </Button>
  );
}

/** Grantable roles — `owner` is intentionally absent: there is exactly one
 *  owner, and ownership only moves via the transfer-ownership flow. */
type AssignableRole = 'admin' | 'member';
const ROLE_LABEL_KEYS: Record<string, MessageKey> = {
  owner: 'settings.members.role.owner',
  admin: 'settings.members.role.admin',
  member: 'settings.members.role.member',
};

export function MembersSection({ projectId }: { projectId: string }) {
  const t = useT();
  const { data, isPending } = useProjectMembers(projectId);
  const invite = useInviteProjectMember(projectId);
  const remove = useRemoveProjectMember(projectId);
  const updateRole = useUpdateProjectMemberRole(projectId);
  const cancelInvite = useCancelProjectInvitation(projectId);
  const transfer = useTransferProjectOwnership(projectId);
  const confirm = useConfirm();
  const { data: session } = useSession();

  const members = data?.members ?? [];
  const invitations = data?.invitations ?? [];
  // The transfer action is only offered to the current owner (server-enforced too).
  const currentUserId = session?.user?.id;
  const isCurrentOwner = members.some((member) => member.user.id === currentUserId && member.role === 'owner');
  const [lastInvite, setLastInvite] = useState<{ email: string; link: string } | null>(null);

  const form = useForm({
    defaultValues: { email: '', role: 'member' as AssignableRole },
    onSubmit: async ({ value }) => {
      const invited = value.email.trim();
      await new Promise<void>((resolve) => {
        invite.mutate(
          { email: invited, role: value.role },
          {
            onSuccess: (created) => {
              setLastInvite({ email: invited, link: inviteAcceptUrl(created.id) });
              toast.success(t('settings.members.inviteCreated', { email: invited }));
              form.reset();
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
    <div>
      <SectionHeader icon="⧉" title={t('settings.members.title')} description={t('settings.members.description')} />

      <form
        className="mb-5 flex flex-col items-stretch gap-2.5 rounded-xl bg-muted/30 p-3.5 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          form.handleSubmit();
        }}
      >
        <form.Field name="email" validators={{ onChange: ({ value }) => validateEmail(value) }}>
          {(field) => (
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="font-medium text-[13px]">{t('settings.members.inviteByEmail')}</span>
              <Input
                className="bg-background"
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
        <div className="flex w-full items-end gap-2.5 sm:w-auto">
          <form.Field name="role">
            {(field) => (
              // No `owner` option: invitations can never carry the owner role.
              <Select onValueChange={(v) => field.handleChange((v ?? 'member') as AssignableRole)} value={field.state.value}>
                <SelectTrigger className="min-w-0 flex-1 bg-background sm:w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">{t('settings.members.role.member')}</SelectItem>
                  <SelectItem value="admin">{t('settings.members.role.admin')}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => [state.isSubmitting, state.values.email] as const}>
            {([isSubmitting, emailValue]) => (
              <Button className="flex-1 sm:flex-none" disabled={isSubmitting || !emailValue.trim()} type="submit">
                <Mail className="size-4" /> {t('settings.members.invite')}
              </Button>
            )}
          </form.Subscribe>
        </div>
      </form>

      {lastInvite ? (
        <div className="mb-5 rounded-xl border border-primary/30 bg-primary/5 p-3.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-medium text-[13px]">{t('settings.members.inviteCreated', { email: lastInvite.email })}</span>
            <Button onClick={() => setLastInvite(null)} size="sm" variant="ghost">
              {t('settings.members.dismiss')}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Input className="flex-1 font-mono text-sm" onFocus={(event) => event.currentTarget.select()} readOnly value={lastInvite.link} />
            <Button
              onClick={async () => {
                const ok = await copyToClipboard(lastInvite.link);
                toast[ok ? 'success' : 'error'](t(ok ? 'settings.members.linkCopied' : 'settings.members.copyFailed'));
              }}
              type="button"
            >
              <Copy className="size-4" /> {t('settings.members.copyLink')}
            </Button>
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">{t('settings.members.inviteLinkHint')}</p>
        </div>
      ) : null}

      <div className="mb-3 font-mono text-[12px] text-muted-foreground">
        {members.length === 1
          ? t('settings.members.count.one', { count: members.length })
          : t('settings.members.count.other', { count: members.length })}
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
                  // The single owner: a badge, never a role select — ownership
                  // only moves via the explicit transfer action below.
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 font-medium text-[12px] text-primary">
                    <Crown className="size-3.5" />
                    {t('settings.members.role.owner')}
                  </span>
                ) : (
                  <>
                    {isCurrentOwner && member.role === 'admin' ? (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('settings.members.transferOwnership')}
                        title={t('settings.members.transferOwnership')}
                        disabled={transfer.isPending}
                        onClick={async () => {
                          const ok = await confirm({
                            title: t('settings.members.transferOwnership'),
                            description: t('settings.members.transferConfirm', { name: member.user.name || member.user.email }),
                            confirmLabel: t('settings.members.transferOwnership'),
                            destructive: true,
                          });
                          if (!ok) {
                            return;
                          }
                          transfer.mutate(
                            { memberId: member.id },
                            {
                              onSuccess: () => toast.success(t('settings.members.toast.ownershipTransferred')),
                              onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.members.toast.transferError')),
                            },
                          );
                        }}
                      >
                        <Crown className="size-4" />
                      </Button>
                    ) : null}
                    <Select
                      value={member.role}
                      onValueChange={(v) =>
                        updateRole.mutate(
                          { id: member.id, body: { role: (v ?? 'member') as AssignableRole } },
                          {
                            onSuccess: () => toast.success(t('settings.members.toast.roleUpdated')),
                            onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.members.toast.roleError')),
                          },
                        )
                      }
                    >
                      <SelectTrigger className="w-28" size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      {/* No `owner` option: role changes can never grant ownership. */}
                      <SelectContent>
                        <SelectItem value="member">{t('settings.members.role.member')}</SelectItem>
                        <SelectItem value="admin">{t('settings.members.role.admin')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('settings.members.remove')}
                      title={t('settings.members.remove')}
                      onClick={() =>
                        remove.mutate(member.id, {
                          onSuccess: () => toast.success(t('settings.members.toast.removed')),
                          onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.members.toast.removeError')),
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
          {members.length === 0 ? <p className="border-border border-t py-3 text-muted-foreground text-sm">{t('settings.members.empty')}</p> : null}

          {invitations.length > 0 ? (
            <>
              <div className="mt-6 mb-1 font-mono text-[12px] text-muted-foreground">{t('settings.members.pendingInvitations')}</div>
              {invitations.map((inv) => (
                <div className="flex items-center gap-3 border-border border-t py-3" key={inv.id}>
                  <div className="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground">
                    <Mail className="size-4" />
                  </div>
                  <div className="min-w-0 leading-tight">
                    <div className="truncate font-medium text-[13.5px]">{inv.email}</div>
                    <div className="text-[12px] text-muted-foreground">
                      {t('settings.members.invitedAs', {
                        role: t(ROLE_LABEL_KEYS[inv.role ?? 'member'] ?? 'settings.members.role.member'),
                      })}
                    </div>
                  </div>
                  <div className="ms-auto flex items-center gap-1">
                    <CopyLinkButton label={t('settings.members.copyInviteLink')} link={inviteAcceptUrl(inv.id)} />
                    <Button
                      onClick={() =>
                        cancelInvite.mutate(inv.id, {
                          onSuccess: () => toast.success(t('settings.members.toast.invitationRevoked')),
                          onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.members.toast.revokeError')),
                        })
                      }
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('settings.members.revokeInvite')}
                      title={t('settings.members.revokeInvite')}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
