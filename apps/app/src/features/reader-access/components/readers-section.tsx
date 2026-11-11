import { ActionDialog } from '@nibleaf/design-system/components/ui/action-dialog';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { CopyButton } from '@nibleaf/design-system/components/ui/copy-button';
import { DataList, DataListEmpty, DataListItem, RowActions, RowActionsItem } from '@nibleaf/design-system/components/ui/data-list';
import { EmptyState } from '@nibleaf/design-system/components/ui/empty-state';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { SettingsRow } from '@nibleaf/design-system/components/ui/settings-row';
import { SettingsSection, SettingsSectionBody } from '@nibleaf/design-system/components/ui/settings-section';
import { StatusBadge } from '@nibleaf/design-system/components/ui/status-badge';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { useT } from '@nibleaf/i18n/react';
import { useStore } from '@tanstack/react-form';
import { Mail, RefreshCw, Search, Users } from 'lucide-react';
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DirtyStateReporter } from '@/components/project-settings/shared';
import { FormField } from '@/components/ui/form-field';
import type { ReaderAccessData } from '@/hooks/api';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { isolate } from '@/lib/bidi';
import { useFormatters } from '@/lib/format';
import { focusFirstInvalid, useSaveRegionForm } from '@/lib/forms/save-region';
import { useServerDraftForm } from '@/lib/forms/use-server-draft';
import type { SiteAdminState } from '@/lib/project-settings-access';
import { useInviteManyReaders, useInviteOneReader, useResendInvitation, useRevokeReaderAccess, useSaveEmailDomains } from '../api/hooks';
import { decisionProps, manageDecision } from '../model/access';
import {
  emailDomainsProblem,
  emailDomainsValues,
  filterReaders,
  hasAccess,
  inviteProblem,
  inviteRequest,
  type Problem,
  pageGroups,
  parseDomainList,
  READER_SEARCH_THRESHOLD,
  readerActivity,
  readerGroupNames,
  readerName,
  readerStatus,
} from '../model/readers';
import { DraftConflicts } from './draft-conflicts';

type Reader = ReaderAccessData['readers'][number];
type Props = { projectId: string; data: ReaderAccessData; status: SiteAdminState };

/** Turns a model problem into the message shown under its field. */
function useProblemText() {
  const t = useT();
  return (problem: Problem | undefined) => (problem ? t(problem.key, problem.params) : undefined);
}

/**
 * Inviting readers: one or many people by email (to the whole site unless the
 * owner picks a page group), and the email domains whose people may sign in
 * without an invitation.
 */
export function ReadersSection(props: Props) {
  const t = useT();
  return (
    <SettingsSection description={t('settings.visibility.readersHeadingBody')} title={t('settings.visibility.readersHeading')}>
      <InviteForm {...props} />
      <EmailDomainsForm {...props} />
    </SettingsSection>
  );
}

/**
 * Invites people by email. An add form with its own button, on the form
 * lifecycle (operations/ui-overhaul.md §8.3): one invitation at a time (Enter
 * during a send does nothing), and what is typed while one is sent is kept
 * when it lands. The addresses are checked when it is sent.
 */
function InviteForm({ projectId, data, status }: Props) {
  const t = useT();
  const problemText = useProblemText();
  const inviteOne = useInviteOneReader(projectId);
  const inviteMany = useInviteManyReaders(projectId);
  const [lastLink, setLastLink] = useState<{ email: string; link: string }>();
  const groups = useMemo(() => pageGroups(data.audiences), [data.audiences]);
  const scopeItems = useMemo(
    () => [
      { value: '', label: t('settings.visibility.invite.wholeSite') },
      ...groups.map((audience) => ({ value: audience.id, label: audience.name })),
    ],
    [groups, t],
  );
  const { disabled } = decisionProps(manageDecision(status));
  const empty = useMemo(() => ({ emails: '', audienceId: '' }), []);

  const { form, ...draft } = useServerDraftForm({
    identity: [projectId, 'invite-readers'],
    source: empty,
    onSubmit: async (value, outcome) => {
      const request = inviteRequest(value);
      try {
        if (request.kind === 'one') {
          const result = await inviteOne.mutateAsync({ email: request.email, audienceIds: request.audienceIds });
          toast.success(t('settings.visibility.invite.sentOne', { email: isolate(request.email) }));
          if (outcome.isCurrent()) setLastLink({ email: request.email, link: result.activationUrl });
        } else {
          const result = await inviteMany.mutateAsync({ emails: request.emails, audienceIds: request.audienceIds });
          toast.success(t('settings.visibility.invite.sentMany', { count: result.invited }));
          if (outcome.isCurrent()) setLastLink(undefined);
        }
        // Back to empty, except what was typed or chosen while it was sent.
        outcome.succeeded(empty);
        return 'saved';
      } catch (error) {
        outcome.failed();
        toast.error(friendlyErrorMessage(t, error, 'settings.visibility.invite.error'));
        return 'failed';
      }
    },
  });
  const typed = useStore(form.store, (state) => state.values.emails);

  return (
    <form
      className="divide-y divide-border"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void draft.submit();
      }}
    >
      <DirtyStateReporter dirty={Boolean(typed.trim()) || draft.isSaving} />
      <form.Field name="emails" validators={{ onSubmit: ({ value }) => problemText(inviteProblem(value)) }}>
        {(field) => (
          <FormField<string>
            description={t('settings.visibility.invite.hint')}
            field={field}
            label={t('settings.visibility.invite.label')}
            layout="stacked"
          >
            {({ controlProps, value, onValueChange }) => (
              <Textarea
                {...controlProps}
                autoComplete="off"
                className="min-h-20"
                dir="ltr"
                disabled={disabled}
                onChange={(event) => onValueChange(event.target.value)}
                placeholder="ana@example.com, sam@example.com"
                value={value}
              />
            )}
          </FormField>
        )}
      </form.Field>
      {groups.length > 0 ? (
        <form.Field name="audienceId">
          {(field) => (
            <SettingsRow control="compact" label={t('settings.visibility.invite.scope')}>
              {(ids) => (
                <Select items={scopeItems} onValueChange={(next) => field.handleChange((next as string | null) ?? '')} value={field.state.value}>
                  <SelectTrigger aria-labelledby={ids.labelId} className="w-full" disabled={disabled} id={ids.controlId}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {scopeItems.map((item) => (
                      <SelectItem key={item.value || 'site'} value={item.value}>
                        <span dir="auto">{item.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </SettingsRow>
          )}
        </form.Field>
      ) : null}
      <SettingsSectionBody className="flex flex-col gap-3">
        <div>
          <Button disabled={disabled} loading={draft.isSaving} type="submit">
            <Mail aria-hidden /> {t('settings.visibility.invite.submit')}
          </Button>
        </div>
        {lastLink ? (
          <div className="flex flex-col gap-2" role="status">
            <p className="text-muted-foreground text-sm">{t('settings.visibility.invite.shareLink', { email: isolate(lastLink.email) })}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={t('settings.members.copyLink')}
                className="min-w-0 flex-1 basis-56"
                dir="ltr"
                onFocus={(event) => event.currentTarget.select()}
                readOnly
                value={lastLink.link}
              />
              <CopyButton
                copiedLabel={t('settings.members.linkCopied')}
                failedLabel={t('settings.members.copyFailed')}
                label={t('settings.members.copyLink')}
                value={lastLink.link}
              />
            </div>
          </div>
        ) : null}
      </SettingsSectionBody>
    </form>
  );
}

/**
 * The email domains whose people may sign in without an invitation. An
 * explicit-save draft (`useServerDraftForm`, identity
 * `[projectId, 'reader-email-domains']`) saved by the page's save bar; the
 * domains are checked on save.
 */
function EmailDomainsForm({ projectId, data, status }: Props) {
  const t = useT();
  const problemText = useProblemText();
  const save = useSaveEmailDomains(projectId);
  const formRef = useRef<HTMLFormElement>(null);
  const { disabled } = decisionProps(manageDecision(status));
  const source = useMemo(() => emailDomainsValues(data.readerEmailDomains), [data.readerEmailDomains]);

  const { form, ...draft } = useServerDraftForm<{ domains: string }>({
    identity: [projectId, 'reader-email-domains'],
    source,
    onSubmit: async (value, outcome) => {
      try {
        const result = await save.mutateAsync({ domains: parseDomainList(value.domains) });
        outcome.succeeded(emailDomainsValues(result.domains));
        return 'saved';
      } catch (error) {
        outcome.failed();
        if (outcome.isCurrent()) toast.error(friendlyErrorMessage(t, error, 'settings.saveError'));
        return 'failed';
      }
    },
  });
  const { submit: submitDraft } = draft;
  // The page's save bar disables Save while saving, so 'busy' only means "nothing new to report".
  const submit = useCallback(async () => {
    const outcome = await submitDraft();
    return outcome === 'busy' ? 'failed' : outcome;
  }, [submitDraft]);
  useSaveRegionForm('reader-email-domains', { isDirty: draft.isDirty, isSubmitting: draft.isSaving, submit, discard: draft.discard });

  return (
    <form
      className="divide-y divide-border"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!draft.isDirty) return;
        void submit().then((outcome) => outcome === 'invalid' && focusFirstInvalid(formRef.current));
      }}
      ref={formRef}
    >
      {/* Also tells the page these reader settings hold an edit, so they stay on screen if visibility changes. */}
      <DirtyStateReporter dirty={draft.isDirty || draft.isSaving} />
      <DraftConflicts conflicts={draft.conflicts} resolve={draft.resolveConflict} />
      <form.Field name="domains" validators={{ onSubmit: ({ value }) => problemText(emailDomainsProblem(value)) }}>
        {(field) => (
          <FormField<string>
            description={t('settings.visibility.domains.body')}
            field={field}
            label={t('settings.visibility.domains.label')}
            layout="stacked"
          >
            {({ controlProps, value, onValueChange }) => (
              <Input
                {...controlProps}
                autoCapitalize="off"
                autoComplete="off"
                dir="ltr"
                disabled={disabled}
                onChange={(event) => onValueChange(event.target.value)}
                placeholder="example.com, partner.org"
                spellCheck={false}
                value={value}
              />
            )}
          </FormField>
        )}
      </form.Field>
    </form>
  );
}

/** Everyone with access, newest first, searchable once the list is long, with resend and remove per reader. */
export function ReaderListSection({ projectId, data, status }: Props) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [removeTarget, setRemoveTarget] = useState<Reader | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const resend = useResendInvitation(projectId);
  const revoke = useRevokeReaderAccess(projectId);
  const groups = useMemo(() => pageGroups(data.audiences), [data.audiences]);
  const readers = filterReaders(data.readers, query);
  const nameOf = (reader: Reader) => readerName(reader) ?? t('settings.authentication.reader.portalReader');

  const resendTo = (reader: Reader) =>
    resend.mutateAsync(reader.id).then(
      () => toast.success(t('settings.visibility.list.resent', { email: isolate(reader.email ?? '') })),
      (error: unknown) => toast.error(friendlyErrorMessage(t, error, 'settings.visibility.invite.error')),
    );

  let list: ReactNode;
  if (data.readers.length === 0) {
    list = (
      <DataListEmpty>
        <EmptyState headingLevel={3} icon={<Users />} title={t('settings.visibility.list.empty')} />
      </DataListEmpty>
    );
  } else if (readers.length === 0) {
    list = (
      <SettingsSectionBody>
        <p className="text-muted-foreground text-sm" role="status">
          {t('settings.visibility.list.noMatch', { query: isolate(query.trim()) })}
        </p>
      </SettingsSectionBody>
    );
  } else {
    list = (
      <DataList aria-label={t('settings.visibility.list.title')}>
        {readers.map((reader) => (
          <ReaderRow
            groups={readerGroupNames(reader, groups)}
            key={reader.id}
            name={nameOf(reader)}
            onRemove={() => {
              setRemoveTarget(reader);
              setRemoveOpen(true);
            }}
            onResend={() => void resendTo(reader)}
            reader={reader}
            resending={resend.isPending && resend.variables === reader.id}
            status={status}
          />
        ))}
      </DataList>
    );
  }

  return (
    <>
      <SettingsSection
        actions={
          data.readers.length > READER_SEARCH_THRESHOLD ? (
            <div className="relative w-full sm:w-64">
              <Search aria-hidden className="-translate-y-1/2 pointer-events-none absolute start-2.5 top-1/2 size-4 text-muted-foreground" />
              <Input
                aria-label={t('settings.visibility.list.search')}
                className="ps-8"
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('settings.visibility.list.search')}
                type="search"
                value={query}
              />
            </div>
          ) : undefined
        }
        title={t('settings.visibility.list.title')}
      >
        {list}
      </SettingsSection>
      <ActionDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('settings.authentication.reader.revoke')}
        destructive
        errorMessage={(error) => friendlyErrorMessage(t, error, 'settings.saveError')}
        fallbackErrorMessage={t('settings.saveError')}
        onConfirm={async () => {
          if (!removeTarget) return;
          await revoke.mutateAsync(removeTarget.id);
          toast.success(t('settings.visibility.list.revoked', { name: isolate(nameOf(removeTarget)) }));
        }}
        onOpenChange={setRemoveOpen}
        open={removeOpen}
        title={t('settings.authentication.reader.revokeConfirm', {
          name: isolate(removeTarget ? (readerName(removeTarget) ?? t('settings.authentication.reader.thisReader')) : ''),
        })}
      />
    </>
  );
}

function ReaderRow({
  reader,
  name,
  groups,
  status,
  resending,
  onResend,
  onRemove,
}: {
  reader: Reader;
  name: string;
  groups: string[];
  status: SiteAdminState;
  resending: boolean;
  onResend: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const format = useFormatters();
  const badge = readerStatus(reader);
  const activity = readerActivity(reader);
  const manage = decisionProps(manageDecision(status));
  const resendState = decisionProps(manageDecision(status, resending));

  return (
    <DataListItem
      badges={<StatusBadge tone={badge.tone}>{t(badge.label)}</StatusBadge>}
      meta={
        <>
          {reader.name && reader.email ? <span dir="ltr">{reader.email}</span> : null}
          {activity.kind === 'revoked' ? (
            <span>{t('settings.visibility.list.revokedOn', { date: format.date(activity.at) })}</span>
          ) : (
            <span>
              {t('settings.visibility.list.invitedOn', { date: format.date(activity.invitedAt) })} ·{' '}
              {activity.lastSeenAt
                ? t('settings.visibility.list.lastSeen', { date: format.relativeTime(activity.lastSeenAt) })
                : t('settings.visibility.list.neverSeen')}
            </span>
          )}
          {groups.length ? <span dir="auto">{groups.join(', ')}</span> : null}
        </>
      }
      title={<span dir="auto">{name}</span>}
      trailing={
        hasAccess(reader) ? (
          <RowActions label={t('settings.visibility.actionsFor', { name: isolate(name) })}>
            {reader.email ? (
              <RowActionsItem
                disabled={manage.disabled || resendState.disabled}
                disabledReason={resendState.reason ? t(resendState.reason) : undefined}
                icon={<RefreshCw aria-hidden />}
                onSelect={onResend}
              >
                {t('settings.visibility.list.resend')}
              </RowActionsItem>
            ) : null}
            <RowActionsItem destructive disabled={manage.disabled} onSelect={onRemove}>
              {t('settings.authentication.reader.revoke')}
            </RowActionsItem>
          </RowActions>
        ) : undefined
      }
    />
  );
}
