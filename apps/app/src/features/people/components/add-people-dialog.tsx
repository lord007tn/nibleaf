import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { CopyButton } from '@nibleaf/design-system/components/ui/copy-button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { useT } from '@nibleaf/i18n/react';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { fieldErrorsVisible } from '@/lib/forms/field-errors';
import { inviteAcceptUrl } from '@/lib/invitations';
import { useInviteToSite, useResendSiteInvitation } from '../api/mutations';
import { emailsError, type InvitationDelivery, parseEmails } from '../model/invitations';
import { DEFAULT_INVITE_SITE_ROLE, SITE_ROLE_OPTIONS, type SiteRole, siteRoleLabel } from '../model/roles';
import { InviteEmailField } from './invite-email-field';
import { RoleOptionList } from './role-options';

/**
 * Add someone to one website (design §5.3, §6.5): type an email (people the
 * Admin already works with are suggested), pick their role here. An existing
 * org member is added directly; anyone else gets an invitation to the
 * organization with access to this website only.
 */
export function AddPeopleDialog({
  open,
  onOpenChange,
  projectId,
  siteName,
  allowedRoles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  siteName: string;
  allowedRoles: SiteRole[];
}) {
  const t = useT();
  const id = useId();
  const invite = useInviteToSite(projectId);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<SiteRole>(allowedRoles.includes(DEFAULT_INVITE_SITE_ROLE) ? DEFAULT_INVITE_SITE_ROLE : 'viewer');
  const [blurred, setBlurred] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [invited, setInvited] = useState<{ id: string; email: string; delivery: InvitationDelivery } | null>(null);
  const resend = useResendSiteInvitation(projectId);
  const error = emailsError(email, { single: true });
  // The shared timing rule (lib/forms, ui-overhaul §6.4): after leaving the field or a submit attempt.
  const showError = fieldErrorsVisible({ errors: error ? [error.key] : [], isBlurred: blurred }, attempts);

  const reset = () => {
    setEmail('');
    setRole(allowedRoles.includes(DEFAULT_INVITE_SITE_ROLE) ? DEFAULT_INVITE_SITE_ROLE : 'viewer');
    setBlurred(false);
    setAttempts(0);
    setFailure(null);
    setInvited(null);
  };

  const submit = async () => {
    setAttempts((n) => n + 1);
    setFailure(null);
    if (error) {
      document.getElementById(`${id}-email`)?.focus();
      return;
    }
    const address = parseEmails(email).valid[0] ?? email.trim();
    try {
      const result = await invite.mutateAsync({ email: address, role });
      if (result.status === 'existing_member') {
        toast.success(
          result.changed === false
            ? t('people.site.alreadyHas', { email: address, site: siteName })
            : t('people.site.added', { email: address, site: siteName, role: t(siteRoleLabel(role)) }),
        );
        onOpenChange(false);
      } else setInvited({ id: result.id, email: address, delivery: result.delivery ?? 'disabled' });
    } catch (cause) {
      setFailure(friendlyErrorMessage(t, cause, 'people.site.addFailed', { 409: 'members.toast.alreadyMember' }));
    }
  };

  return (
    <Dialog onOpenChange={(next) => !invite.isPending && onOpenChange(next)} onOpenChangeComplete={(next) => !next && reset()} open={open}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        {invited ? (
          <div className="grid min-w-0 gap-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 aria-hidden className="size-5 text-success" />
                {t('people.site.invitedTitle')}
              </DialogTitle>
              <DialogDescription>
                {invited.delivery === 'queued'
                  ? t('people.site.invitedEmailed', { email: invited.email })
                  : invited.delivery === 'failed'
                    ? t('people.site.invitedFailed', { email: invited.email })
                    : t('people.site.invitedLink', { email: invited.email })}
              </DialogDescription>
            </DialogHeader>
            {invited.delivery === 'failed' ? (
              <Button
                loading={resend.isPending}
                onClick={() =>
                  resend.mutate(invited.id, {
                    onSuccess: ({ delivery }) => setInvited({ ...invited, delivery }),
                    onError: (error) => toast.error(friendlyErrorMessage(t, error, 'people.invitations.resendFailedDetail')),
                  })
                }
                type="button"
                variant="outline"
              >
                <RefreshCw aria-hidden className="size-4" /> {t('people.invite.retry')}
              </Button>
            ) : null}
            <CopyButton
              copiedLabel={t('people.invitations.copied')}
              failedLabel={t('people.invitations.copyFailed')}
              label={t('people.invitations.copyLinkFor', { email: invited.email })}
              size="default"
              value={inviteAcceptUrl(invited.id)}
              variant="outline"
            >
              {t('people.invitations.copyLink')}
            </CopyButton>
            <DialogFooter>
              <Button onClick={reset} type="button" variant="outline">
                {t('people.site.addAnother')}
              </Button>
              <Button onClick={() => onOpenChange(false)} type="button">
                {t('people.invite.done')}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="grid min-w-0 gap-5"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('people.site.addTitle', { site: siteName })}</DialogTitle>
              <DialogDescription>{t('people.site.addDescription')}</DialogDescription>
            </DialogHeader>
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor={`${id}-email`}>{t('people.site.email')}</Label>
              <InviteEmailField
                aria-describedby={showError ? `${id}-email-error` : `${id}-email-hint`}
                aria-invalid={showError || undefined}
                id={`${id}-email`}
                onBlur={() => setBlurred(email.trim() !== '' || blurred)}
                onChange={setEmail}
                placeholder="teammate@example.com"
                projectId={projectId}
                type="email"
                value={email}
              />
              {showError && error ? (
                <p className="text-destructive text-xs" id={`${id}-email-error`}>
                  {t(error.key, error.values)}
                </p>
              ) : (
                <p className="text-muted-foreground text-xs" id={`${id}-email-hint`}>
                  {t('people.site.emailHint')}
                </p>
              )}
            </div>
            <RoleOptionList
              legend={t('people.site.role', { site: siteName })}
              onChange={setRole}
              options={SITE_ROLE_OPTIONS}
              unavailableReason={(option) => (allowedRoles.includes(option) ? undefined : t('people.reason.roleAboveYours'))}
              value={role}
            />
            {failure ? (
              <Callout tone="danger" urgent>
                {failure}
              </Callout>
            ) : null}
            <DialogFooter>
              <Button disabled={invite.isPending} focusableWhenDisabled onClick={() => onOpenChange(false)} type="button" variant="outline">
                {t('common.cancel')}
              </Button>
              <Button loading={invite.isPending} loadingText={t('people.site.adding')} type="submit">
                {t('people.site.add')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
