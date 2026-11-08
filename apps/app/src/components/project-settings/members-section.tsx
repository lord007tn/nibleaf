import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { SkeletonListRow } from '@nibleaf/design-system/components/ui/skeleton';
import { useT } from '@nibleaf/i18n/react';
import { type AssignableMemberRole, canAdminister } from '@nibleaf/shared/rbac';
import { useForm } from '@tanstack/react-form';
import { Check, Copy, Crown, Link2, Mail, Trash2, Users } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { RoleSelect } from '@/components/members/role-select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/settings/api-key-alert-dialog';
import { GradientAvatar } from '@/components/settings/section';
import {
  friendlyErrorMessage,
  useCancelProjectInvitation,
  useInviteProjectMember,
  useProjectMembers,
  useRemoveProjectMember,
  useTransferProjectOwnership,
  useUpdateProjectMemberRole,
} from '@/hooks/api';
import { email as validateEmail } from '@/lib/form';
import { copyToClipboard, inviteAcceptUrl } from '@/lib/invitations';
import { DEFAULT_INVITE_ROLE, roleLabelKey } from '@/lib/member-roles';
import { useSession } from '@/services/auth-client';
import { DirtyStateReporter, SectionHeader } from './shared';

/** A small button that copies an invite link to the clipboard with feedback.
 *  Copying is instant, so it shows a tick afterwards rather than a spinner. */
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

type MemberAction = { kind: 'remove'; id: string; name: string } | { kind: 'revoke'; id: string; email: string };

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
  const currentMember = members.find((member) => member.user.id === currentUserId);
  const isCurrentOwner = currentMember?.role === 'owner';
  const canManageMembers = canAdminister(currentMember?.role ?? '');
  const [lastInvite, setLastInvite] = useState<{ email: string; link: string; role: AssignableMemberRole } | null>(null);
  const [memberAction, setMemberAction] = useState<MemberAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  /** Only the row whose remove/revoke is being confirmed spins. */
  const actionRunning = (kind: MemberAction['kind'], id: string) => actionPending && memberAction?.kind === kind && memberAction.id === id;
  const actionInFlight = useRef(false);

  const requestMemberAction = (action: MemberAction) => {
    if (actionInFlight.current || !canManageMembers) return;
    setActionError(null);
    setMemberAction(action);
  };

  const submitMemberAction = () => {
    if (!memberAction || actionInFlight.current || !canManageMembers) return;
    const action = memberAction;
    actionInFlight.current = true;
    setActionPending(true);
    setActionError(null);
    const options = {
      onSuccess: () => {
        toast.success(t(action.kind === 'remove' ? 'settings.members.toast.removed' : 'settings.members.toast.invitationRevoked'));
        if (action.kind === 'revoke') {
          setLastInvite((previous) => (previous?.email.toLowerCase() === action.email.toLowerCase() ? null : previous));
        }
        setMemberAction(null);
      },
      onError: (error: unknown) => {
        // A 409 here is "the last owner can't be removed": the action's own message, not "someone else changed this".
        const fallbackKey = action.kind === 'remove' ? 'settings.members.toast.removeError' : 'settings.members.toast.revokeError';
        setActionError(friendlyErrorMessage(t, error, fallbackKey, { 409: fallbackKey }));
      },
      onSettled: () => {
        actionInFlight.current = false;
        setActionPending(false);
      },
    };
    if (action.kind === 'remove') remove.mutate(action.id, options);
    else cancelInvite.mutate(action.id, options);
  };
  // RoleSelect never offers `owner`: invitations and role changes can never grant ownership.
  const form = useForm({
    defaultValues: { email: '', role: DEFAULT_INVITE_ROLE as AssignableMemberRole },
    onSubmit: async ({ value }) => {
      if (!canManageMembers) return;
      const invited = value.email.trim();
      await new Promise<void>((resolve) => {
        invite.mutate(
          { email: invited, role: value.role },
          {
            onSuccess: (created) => {
              setLastInvite({ email: invited, link: inviteAcceptUrl(created.id), role: value.role });
              toast.success(t('settings.members.inviteCreated', { email: invited }));
              form.reset();
              resolve();
            },
            onError: (error) => {
              toast.error(friendlyErrorMessage(t, error, 'settings.members.toast.inviteError', { 409: 'members.toast.alreadyMember' }));
              resolve();
            },
          },
        );
      });
    },
  });

  return (
    <div>
      <SectionHeader icon={<Users className="size-4" />} title={t('settings.members.title')} description={t('settings.members.description')} />

      {canManageMembers && (
        <form
          className="mb-5 flex flex-col items-stretch gap-2.5 rounded-xl bg-muted/30 p-3.5 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit();
          }}
        >
          <form.Subscribe selector={(state) => !state.isDefaultValue}>{(dirty) => <DirtyStateReporter dirty={dirty} />}</form.Subscribe>
          <form.Field name="email" validators={{ onChange: ({ value }) => validateEmail(value, t) }}>
            {(field) => (
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Label className="font-medium text-[13px]" htmlFor="project-member-email">
                  {t('settings.members.inviteByEmail')}
                </Label>
                <Input
                  className="bg-background"
                  id="project-member-email"
                  aria-invalid={field.state.meta.errors.length > 0}
                  aria-describedby={field.state.meta.errors.length ? 'project-member-email-error' : undefined}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="teammate@company.com"
                  type="email"
                  value={field.state.value}
                />
                <FieldError id="project-member-email-error" errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
          <div className="flex w-full items-end gap-2.5 sm:w-auto">
            <form.Field name="role">
              {(field) => (
                <RoleSelect
                  ariaLabel={t('settings.members.roleLabel')}
                  className="min-w-0 flex-1 bg-background sm:w-32"
                  onValueChange={field.handleChange}
                  value={field.state.value}
                />
              )}
            </form.Field>
            <form.Subscribe selector={(state) => [state.isSubmitting, state.values.email] as const}>
              {([isSubmitting, emailValue]) => (
                <Button className="flex-1 sm:flex-none" disabled={!emailValue.trim()} loading={isSubmitting} type="submit">
                  <Mail className="size-4" /> {t('settings.members.invite')}
                </Button>
              )}
            </form.Subscribe>
          </div>
        </form>
      )}

      {canManageMembers ? <p className="mb-4 text-muted-foreground text-sm">{t('settings.members.rolesHint')}</p> : null}
      {canManageMembers && lastInvite ? (
        <div className="mb-5 rounded-xl border border-primary/30 bg-primary/5 p-3.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-medium text-[13px]">{t('settings.members.inviteCreated', { email: lastInvite.email })}</span>
            <Button onClick={() => setLastInvite(null)} size="sm" variant="ghost">
              {t('settings.members.dismiss')}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Input
              aria-label={t('settings.members.copyLink')}
              className="flex-1 font-mono text-sm"
              onFocus={(event) => event.currentTarget.select()}
              readOnly
              dir="ltr"
              value={lastInvite.link}
            />
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
          <p className="mt-2 text-[12px] text-muted-foreground">{t('settings.members.invitedAs', { role: t(roleLabelKey(lastInvite.role)) })}</p>
          <p className="mt-2 text-[12px] text-muted-foreground">{t('settings.members.inviteLinkHint')}</p>
        </div>
      ) : null}

      <div className="mb-3 font-mono text-[12px] text-muted-foreground">
        {members.length === 1
          ? t('settings.members.count.one', { count: members.length })
          : t('settings.members.count.other', { count: members.length })}
      </div>

      {isPending ? (
        <div aria-busy="true">
          <p className="sr-only" role="status">
            {t('common.loading')}
          </p>
          <SkeletonListRow />
          <SkeletonListRow />
          <SkeletonListRow />
        </div>
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
                    {t('roles.owner')}
                  </span>
                ) : !canManageMembers ? (
                  <span className="text-muted-foreground text-sm">{t(roleLabelKey(member.role))}</span>
                ) : (
                  <>
                    {isCurrentOwner && member.role === 'admin' ? (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('settings.members.transferOwnership')}
                        title={t('settings.members.transferOwnership')}
                        loading={transfer.isPending && transfer.variables?.memberId === member.id}
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
                              onError: (error) =>
                                toast.error(
                                  friendlyErrorMessage(t, error, 'settings.members.toast.transferError', {
                                    409: 'settings.members.toast.transferError',
                                  }),
                                ),
                            },
                          );
                        }}
                      >
                        <Crown className="size-4" />
                      </Button>
                    ) : null}
                    <RoleSelect
                      ariaLabel={t('settings.members.roleLabel')}
                      className="w-28"
                      size="sm"
                      value={member.role as AssignableMemberRole}
                      onValueChange={(role) =>
                        updateRole.mutate(
                          { id: member.id, body: { role } },
                          {
                            onSuccess: () => toast.success(t('settings.members.toast.roleUpdated')),
                            onError: (error) =>
                              toast.error(
                                friendlyErrorMessage(t, error, 'settings.members.toast.roleError', { 409: 'settings.members.toast.roleError' }),
                              ),
                          },
                        )
                      }
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('settings.members.remove')}
                      title={t('settings.members.remove')}
                      loading={actionRunning('remove', member.id)}
                      onClick={() => requestMemberAction({ kind: 'remove', id: member.id, name: member.user.name || member.user.email })}
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
                        role: t(roleLabelKey(inv.role)),
                      })}
                    </div>
                  </div>
                  {canManageMembers && (
                    <div className="ms-auto flex items-center gap-1">
                      <CopyLinkButton label={t('settings.members.copyInviteLink')} link={inviteAcceptUrl(inv.id)} />
                      <Button
                        loading={actionRunning('revoke', inv.id)}
                        onClick={() => requestMemberAction({ kind: 'revoke', id: inv.id, email: inv.email })}
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('settings.members.revokeInvite')}
                        title={t('settings.members.revokeInvite')}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </>
          ) : null}
        </>
      )}

      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !actionInFlight.current) {
            setMemberAction(null);
            setActionError(null);
          }
        }}
        open={Boolean(memberAction)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(memberAction?.kind === 'revoke' ? 'settings.members.revokeInvite' : 'settings.members.remove')}</AlertDialogTitle>
            <AlertDialogDescription>
              {memberAction?.kind === 'remove'
                ? t('settings.members.removeConfirm', { name: memberAction.name })
                : memberAction?.kind === 'revoke'
                  ? t('settings.members.revokeConfirm', { email: memberAction.email })
                  : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {actionError ? (
            <p className="text-destructive text-sm" role="alert">
              {actionError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionPending}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction loading={actionPending} loadingText={t('common.loading')} onClick={submitMemberAction}>
              {t(memberAction?.kind === 'revoke' ? 'settings.members.revokeInvite' : 'settings.members.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
