import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import type { MessageKey } from '@nibleaf/i18n';
import { useLocale } from '@nibleaf/i18n/react';
import { useForm } from '@tanstack/react-form';
import { Mail, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  friendlyErrorMessage,
  type ReaderAccessData,
  useInviteReader,
  useInviteReaders,
  useResendReaderInvitation,
  useRevokeReader,
  useUpdateReaderEmailDomains,
} from '@/hooks/api';
import { useFormatters } from '@/lib/format';
import { copyToClipboard } from '@/lib/invitations';
import { DirtyStateReporter } from '../shared';

const MAX_INVITES = 100;
const MAX_DOMAINS = 20;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Addresses from a comma, semicolon or newline separated field, lowercased and once each. */
export const parseEmailList = (value: string): string[] => [
  ...new Set(
    value
      .split(/[\s,;]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  ),
];
/** Domains from a comma or newline separated field, lowercased, without a leading @. */
export const parseDomainList = (value: string): string[] => [
  ...new Set(
    value
      .split(/[\s,;]+/)
      .map((item) => item.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean),
  ),
];

const STATUS: Record<string, { key: MessageKey; variant: 'secondary' | 'outline' | 'destructive' }> = {
  ACTIVE: { key: 'settings.authentication.reader.status.active', variant: 'secondary' },
  INVITED: { key: 'settings.visibility.status.invited', variant: 'outline' },
  REVOKED: { key: 'settings.authentication.reader.status.revoked', variant: 'destructive' },
};

type Reader = ReaderAccessData['readers'][number];

/**
 * Everyday reader management for an Invited readers site: invite one or many
 * people (to the whole site unless the owner picks a page group), let a whole
 * email domain in, and see who has access, when they were invited and when
 * they last read, with resend and revoke.
 */
export function ReadersPanel({ projectId, data, disabled }: { projectId: string; data: ReaderAccessData; disabled: boolean }) {
  const { t } = useLocale();
  const format = useFormatters();
  const confirm = useConfirm();
  const inviteOne = useInviteReader(projectId);
  const inviteMany = useInviteReaders(projectId);
  const resend = useResendReaderInvitation(projectId);
  const revoke = useRevokeReader(projectId);
  const saveDomains = useUpdateReaderEmailDomains(projectId);
  const [lastLink, setLastLink] = useState<{ email: string; link: string }>();
  const [query, setQuery] = useState('');

  // Page-limited groups appear only once an owner has made one under Advanced access.
  const pageGroups = useMemo(() => data.audiences.filter((audience) => !audience.grants.some((grant) => grant.pageId === null)), [data.audiences]);
  const scopeItems = useMemo(
    () => [
      { value: '', label: t('settings.visibility.invite.wholeSite') },
      ...pageGroups.map((audience) => ({ value: audience.id, label: audience.name })),
    ],
    [pageGroups, t],
  );

  const invite = useForm({
    defaultValues: { emails: '', audienceId: '' },
    onSubmit: async ({ value, formApi }) => {
      const emails = parseEmailList(value.emails);
      const audienceIds = value.audienceId ? [value.audienceId] : [];
      try {
        if (emails.length === 1 && emails[0]) {
          const result = await inviteOne.mutateAsync({ email: emails[0], audienceIds });
          setLastLink({ email: emails[0], link: result.activationUrl });
          toast.success(t('settings.visibility.invite.sentOne', { email: emails[0] }));
        } else {
          const result = await inviteMany.mutateAsync({ emails, audienceIds });
          setLastLink(undefined);
          toast.success(t('settings.visibility.invite.sentMany', { count: result.invited }));
        }
        formApi.reset();
      } catch (error) {
        toast.error(friendlyErrorMessage(t, error, 'settings.visibility.invite.error'));
      }
    },
  });
  const validateEmails = (value: string) => {
    const emails = parseEmailList(value);
    if (emails.length === 0) return t('settings.visibility.invite.empty');
    if (emails.length > MAX_INVITES) return t('settings.visibility.invite.tooMany');
    const invalid = emails.filter((email) => !EMAIL.test(email));
    return invalid.length ? t('settings.visibility.invite.invalid', { emails: invalid.slice(0, 5).join(', ') }) : undefined;
  };

  const domainsForm = useForm({
    defaultValues: { domains: data.readerEmailDomains.join(', ') },
    onSubmit: async ({ value, formApi }) => {
      try {
        const result = await saveDomains.mutateAsync({ domains: parseDomainList(value.domains) });
        formApi.reset({ domains: result.domains.join(', ') });
        toast.success(t('settings.visibility.domains.saved'));
      } catch (error) {
        toast.error(friendlyErrorMessage(t, error, 'settings.saveError'));
      }
    },
  });
  const validateDomains = (value: string) => {
    const domains = parseDomainList(value);
    const invalid = domains.filter((domain) => !DOMAIN.test(domain));
    if (domains.length > MAX_DOMAINS || invalid.length) {
      return t('settings.visibility.domains.invalid', { domains: invalid.slice(0, 5).join(', ') || domains.slice(MAX_DOMAINS).join(', ') });
    }
  };

  const readers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? data.readers.filter((reader) => `${reader.name ?? ''} ${reader.email ?? ''}`.toLowerCase().includes(needle)) : data.readers;
  }, [data.readers, query]);

  const removeReader = async (reader: Reader) => {
    const ok = await confirm({
      title: t('settings.authentication.reader.revokeConfirm', {
        name: reader.name || reader.email || t('settings.authentication.reader.thisReader'),
      }),
      confirmLabel: t('settings.authentication.reader.revoke'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await revoke.mutateAsync(reader.id);
    } catch (error) {
      toast.error(friendlyErrorMessage(t, error, 'settings.saveError'));
    }
  };
  const resendTo = async (reader: Reader) => {
    try {
      await resend.mutateAsync(reader.id);
      toast.success(t('settings.visibility.list.resent', { email: reader.email ?? '' }));
    } catch (error) {
      toast.error(friendlyErrorMessage(t, error, 'settings.visibility.invite.error'));
    }
  };

  return (
    <div className="mt-8 flex flex-col gap-6">
      <section>
        <h3 className="font-semibold text-base">{t('settings.visibility.readersHeading')}</h3>
        <p className="mt-1 text-muted-foreground text-sm">{t('settings.visibility.readersHeadingBody')}</p>

        <form
          className="mt-4 flex flex-col gap-3 rounded-xl bg-muted/30 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void invite.handleSubmit();
          }}
        >
          <invite.Subscribe selector={(state) => !state.isDefaultValue}>{(dirty) => <DirtyStateReporter dirty={dirty} />}</invite.Subscribe>
          <invite.Field name="emails" validators={{ onSubmit: ({ value }) => validateEmails(value) }}>
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <Label className="font-medium text-[13px]" htmlFor="reader-invite-emails">
                  {t('settings.visibility.invite.label')}
                </Label>
                <Textarea
                  aria-describedby={field.state.meta.errors.length ? 'reader-invite-emails-error' : 'reader-invite-emails-hint'}
                  aria-invalid={field.state.meta.errors.length > 0}
                  autoComplete="off"
                  className="min-h-20 bg-background text-sm"
                  dir="ltr"
                  disabled={disabled}
                  id="reader-invite-emails"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="ana@example.com, sam@example.com"
                  value={field.state.value}
                />
                <p className="text-muted-foreground text-xs" id="reader-invite-emails-hint">
                  {t('settings.visibility.invite.hint')}
                </p>
                <FieldError errors={field.state.meta.errors} id="reader-invite-emails-error" />
              </div>
            )}
          </invite.Field>
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-end">
            {pageGroups.length > 0 ? (
              <invite.Field name="audienceId">
                {(field) => (
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <Label className="font-medium text-[13px]" id="reader-invite-scope-label">
                      {t('settings.visibility.invite.scope')}
                    </Label>
                    <Select items={scopeItems} onValueChange={(next) => field.handleChange(next ?? '')} value={field.state.value}>
                      <SelectTrigger aria-labelledby="reader-invite-scope-label" className="w-full bg-background" disabled={disabled}>
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
                  </div>
                )}
              </invite.Field>
            ) : null}
            <invite.Subscribe selector={(state) => [state.isSubmitting, state.values.emails] as const}>
              {([isSubmitting, emails]) => (
                <Button className="sm:ms-auto" disabled={disabled || !emails.trim()} loading={isSubmitting} type="submit">
                  <Mail aria-hidden className="size-4" /> {t('settings.visibility.invite.submit')}
                </Button>
              )}
            </invite.Subscribe>
          </div>
          {lastLink ? (
            <div className="flex flex-col gap-2 border-border border-t pt-3" role="status">
              <p className="text-muted-foreground text-xs">{t('settings.visibility.invite.shareLink', { email: lastLink.email })}</p>
              <div className="flex flex-wrap gap-2">
                <Input
                  aria-label={t('settings.members.copyLink')}
                  className="min-w-0 flex-1 bg-background"
                  dir="ltr"
                  onFocus={(event) => event.currentTarget.select()}
                  readOnly
                  value={lastLink.link}
                />
                <Button
                  onClick={async () => {
                    const ok = await copyToClipboard(lastLink.link);
                    toast[ok ? 'success' : 'error'](t(ok ? 'settings.members.linkCopied' : 'settings.members.copyFailed'));
                  }}
                  type="button"
                  variant="outline"
                >
                  {t('settings.members.copyLink')}
                </Button>
              </div>
            </div>
          ) : null}
        </form>
      </section>

      <section>
        <h3 className="font-semibold text-sm">{t('settings.visibility.domains.title')}</h3>
        <p className="mt-1 text-muted-foreground text-xs">{t('settings.visibility.domains.body')}</p>
        <form
          className="mt-3 flex flex-col gap-2.5 sm:flex-row sm:items-start"
          onSubmit={(event) => {
            event.preventDefault();
            void domainsForm.handleSubmit();
          }}
        >
          <domainsForm.Subscribe selector={(state) => !state.isDefaultValue}>{(dirty) => <DirtyStateReporter dirty={dirty} />}</domainsForm.Subscribe>
          <domainsForm.Field name="domains" validators={{ onSubmit: ({ value }) => validateDomains(value) }}>
            {(field) => (
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Label className="sr-only" htmlFor="reader-email-domains">
                  {t('settings.visibility.domains.label')}
                </Label>
                <Input
                  aria-describedby={field.state.meta.errors.length ? 'reader-email-domains-error' : undefined}
                  aria-invalid={field.state.meta.errors.length > 0}
                  className="bg-background text-sm"
                  dir="ltr"
                  disabled={disabled}
                  id="reader-email-domains"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="example.com, partner.org"
                  value={field.state.value}
                />
                <FieldError errors={field.state.meta.errors} id="reader-email-domains-error" />
              </div>
            )}
          </domainsForm.Field>
          <domainsForm.Subscribe selector={(state) => [state.isSubmitting, state.isDefaultValue] as const}>
            {([isSubmitting, unchanged]) => (
              <Button disabled={disabled || unchanged} loading={isSubmitting} type="submit" variant="outline">
                {t('settings.visibility.domains.save')}
              </Button>
            )}
          </domainsForm.Subscribe>
        </form>
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-sm">{t('settings.visibility.list.title')}</h3>
          {data.readers.length > 8 ? (
            <div className="relative w-full sm:w-64">
              <Search aria-hidden className="-translate-y-1/2 pointer-events-none absolute start-2.5 top-1/2 size-4 text-muted-foreground" />
              <Input
                aria-label={t('settings.visibility.list.search')}
                className="ps-8 text-sm"
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('settings.visibility.list.search')}
                type="search"
                value={query}
              />
            </div>
          ) : null}
        </div>
        {data.readers.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed p-6 text-center text-muted-foreground text-sm">{t('settings.visibility.list.empty')}</p>
        ) : readers.length === 0 ? (
          <p className="mt-3 text-muted-foreground text-sm">{t('settings.visibility.list.noMatch', { query: query.trim() })}</p>
        ) : (
          <ul className="mt-3 divide-y rounded-xl border">
            {readers.map((reader) => {
              const status = STATUS[reader.status] ?? STATUS.INVITED;
              const revoked = reader.status === 'REVOKED';
              const groups = reader.audiences.map((item) => item.audience).filter((audience) => pageGroups.some((group) => group.id === audience.id));
              return (
                <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between" key={reader.id}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-sm" dir="auto">
                        {reader.name || reader.email || t('settings.authentication.reader.portalReader')}
                      </span>
                      {status ? <Badge variant={status.variant}>{t(status.key)}</Badge> : null}
                    </div>
                    {reader.name && reader.email ? (
                      <div className="truncate text-muted-foreground text-xs" dir="ltr">
                        {reader.email}
                      </div>
                    ) : null}
                    <div className="mt-0.5 text-muted-foreground text-xs">
                      {revoked && reader.revokedAt
                        ? t('settings.visibility.list.revokedOn', { date: format.date(reader.revokedAt) })
                        : `${t('settings.visibility.list.invitedOn', { date: format.date(reader.createdAt) })} · ${
                            reader.lastSeenAt
                              ? t('settings.visibility.list.lastSeen', { date: format.relativeTime(reader.lastSeenAt) })
                              : reader.activatedAt
                                ? t('settings.visibility.list.lastSeen', { date: format.relativeTime(reader.activatedAt) })
                                : t('settings.visibility.list.neverSeen')
                          }`}
                      {groups.length ? <span dir="auto"> · {groups.map((group) => group.name).join(', ')}</span> : null}
                    </div>
                  </div>
                  {revoked ? null : (
                    <div className="flex shrink-0 gap-2">
                      {reader.email ? (
                        <Button
                          disabled={disabled}
                          loading={resend.isPending && resend.variables === reader.id}
                          onClick={() => void resendTo(reader)}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          {t('settings.visibility.list.resend')}
                        </Button>
                      ) : null}
                      <Button
                        disabled={disabled}
                        loading={revoke.isPending && revoke.variables === reader.id}
                        onClick={() => void removeReader(reader)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {t('settings.authentication.reader.revoke')}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
