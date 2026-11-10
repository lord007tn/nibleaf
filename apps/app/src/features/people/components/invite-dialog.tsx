import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { CopyButton } from '@nibleaf/design-system/components/ui/copy-button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { useT } from '@nibleaf/i18n/react';
import { CheckCircle2, Mail } from 'lucide-react';
import { useId, useState } from 'react';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { inviteAcceptUrl } from '@/lib/invitations';
import { type InviteResult, useInviteToOrganization } from '../api/mutations';
import { emailsError, fieldErrorVisible, parseEmails } from '../model/invitations';
import { type GrantSelection, grantsFromSelection } from '../model/members';
import { type AssignableOrgRole, DEFAULT_INVITE_SITE_ROLE, ORG_ROLE_OPTIONS } from '../model/roles';
import { RoleOptionList } from './role-options';
import { type ChecklistWebsite, WebsiteChecklist } from './website-checklist';

/**
 * Invite people to the organization (design §6.1): addresses, an org role and,
 * for Members, which websites they can open (none is fine). Errors show after
 * the field is left or on submit, never on an untouched form (defect 1). The
 * result step says whether an email went out and offers each link.
 */
export function InviteDialog({
  open,
  onOpenChange,
  organizationId,
  organizationName,
  websites,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  organizationName: string;
  websites: ChecklistWebsite[];
}) {
  const t = useT();
  const id = useId();
  const invite = useInviteToOrganization(organizationId);
  const [emails, setEmails] = useState('');
  const [orgRole, setOrgRole] = useState<AssignableOrgRole>('member');
  const [selection, setSelection] = useState<GrantSelection>({});
  const [blurred, setBlurred] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<(InviteResult & { orgRole: AssignableOrgRole }) | null>(null);

  const reset = () => {
    setEmails('');
    setOrgRole('member');
    setSelection({});
    setBlurred(false);
    setAttempts(0);
    setFailure(null);
    setResult(null);
  };
  const error = emailsError(emails);
  const showError = fieldErrorVisible(error, { isBlurred: blurred }, attempts);
  const count = parseEmails(emails).valid.length;

  const submit = async () => {
    setAttempts((n) => n + 1);
    setFailure(null);
    if (error) {
      document.getElementById(`${id}-emails`)?.focus();
      return;
    }
    try {
      const body = { emails: parseEmails(emails).valid, orgRole, grants: orgRole === 'member' ? grantsFromSelection(selection) : [] };
      setResult({ ...(await invite.mutateAsync(body)), orgRole });
    } catch (cause) {
      setFailure(friendlyErrorMessage(t, cause, 'people.invite.failed'));
    }
  };

  return (
    <Dialog
      onOpenChange={(next) => {
        if (invite.isPending) return;
        onOpenChange(next);
      }}
      onOpenChangeComplete={(next) => {
        // Reset only after the close animation, so the dialog never flips to an empty form while it fades (defect c).
        if (!next) reset();
      }}
      open={open}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {result ? (
          <InviteResultView onDone={() => onOpenChange(false)} onMore={reset} result={result} />
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
              <DialogTitle>{t('people.invite.title', { org: organizationName })}</DialogTitle>
              <DialogDescription>{t('people.invite.description')}</DialogDescription>
            </DialogHeader>
            <div className="grid min-w-0 gap-1.5">
              <Label htmlFor={`${id}-emails`}>{t('people.invite.emails')}</Label>
              <Textarea
                aria-describedby={`${id}-emails-hint${showError ? ` ${id}-emails-error` : ''}`}
                aria-invalid={showError || undefined}
                autoComplete="off"
                dir="ltr"
                id={`${id}-emails`}
                onBlur={() => setBlurred(emails.trim() !== '' || blurred)}
                onChange={(event) => setEmails(event.target.value)}
                placeholder="lina@example.com, omar@example.com"
                rows={3}
                value={emails}
              />
              <p className="text-muted-foreground text-xs" id={`${id}-emails-hint`}>
                {t('people.invite.emailsHint')}
              </p>
              {showError && error ? (
                <p className="text-destructive text-xs" id={`${id}-emails-error`}>
                  {t(error.key, error.values)}
                </p>
              ) : null}
            </div>
            <RoleOptionList legend={t('people.invite.orgRole')} onChange={setOrgRole} options={ORG_ROLE_OPTIONS} value={orgRole} />
            {orgRole === 'member' ? (
              <WebsiteChecklist
                defaultRole={DEFAULT_INVITE_SITE_ROLE}
                description={t('people.invite.websitesHint')}
                legend={t('people.invite.websites')}
                onChange={setSelection}
                value={selection}
                websites={websites}
              />
            ) : (
              <Callout tone="info">{t('people.invite.adminNote')}</Callout>
            )}
            {failure ? (
              <Callout tone="danger" urgent>
                {failure}
              </Callout>
            ) : null}
            <DialogFooter className="items-center gap-2 sm:justify-between">
              <p className="text-muted-foreground text-xs">{count ? t('people.invite.summary', { count }) : null}</p>
              <div className="flex gap-2">
                <Button disabled={invite.isPending} focusableWhenDisabled onClick={() => onOpenChange(false)} type="button" variant="outline">
                  {t('common.cancel')}
                </Button>
                <Button loading={invite.isPending} loadingText={t('people.invite.sending')} type="submit">
                  <Mail aria-hidden className="size-4" /> {t('people.invite.send')}
                </Button>
              </div>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InviteResultView({ result, onDone, onMore }: { result: InviteResult; onDone: () => void; onMore: () => void }) {
  const t = useT();
  return (
    <div className="grid min-w-0 gap-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CheckCircle2 aria-hidden className="size-5 text-success" />
          {result.invitations.length ? t('people.invite.doneTitle', { count: result.invitations.length }) : t('people.invite.doneExistingTitle')}
        </DialogTitle>
        <DialogDescription>{result.emailed ? t('people.invite.emailed') : t('people.invite.notEmailed')}</DialogDescription>
      </DialogHeader>
      {result.invitations.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {result.invitations.map((invitation) => (
            <li className="flex min-w-0 items-center gap-2 px-3 py-2" key={invitation.id}>
              <bdi className="min-w-0 flex-1 truncate text-sm" dir="ltr">
                {invitation.email}
              </bdi>
              <CopyButton
                copiedLabel={t('people.invitations.copied')}
                failedLabel={t('people.invitations.copyFailed')}
                label={t('people.invitations.copyLinkFor', { email: invitation.email })}
                size="sm"
                value={inviteAcceptUrl(invitation.id)}
                variant="outline"
              >
                {t('people.invitations.copyLink')}
              </CopyButton>
            </li>
          ))}
        </ul>
      ) : null}
      {result.existingMembers.length ? (
        <ul className="grid gap-1 text-sm">
          {result.existingMembers.map((member) => (
            <li key={member.userId}>
              {member.changed
                ? t('people.invite.existingUpdated', { email: member.email })
                : t('people.invite.existingUnchanged', { email: member.email })}
            </li>
          ))}
        </ul>
      ) : null}
      <DialogFooter>
        <Button onClick={onMore} type="button" variant="outline">
          {t('people.invite.more')}
        </Button>
        <Button onClick={onDone} type="button">
          {t('people.invite.done')}
        </Button>
      </DialogFooter>
    </div>
  );
}
