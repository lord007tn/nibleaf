import { ActionDialog } from '@nibleaf/design-system/components/ui/action-dialog';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@nibleaf/design-system/components/ui/collapsible';
import { CopyButton } from '@nibleaf/design-system/components/ui/copy-button';
import { DataList, DataListEmpty, DataListItem, DataListSkeleton, RowActions, RowActionsItem } from '@nibleaf/design-system/components/ui/data-list';
import { EmptyState } from '@nibleaf/design-system/components/ui/empty-state';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { PageHeader } from '@nibleaf/design-system/components/ui/page-header';
import { SettingsSection } from '@nibleaf/design-system/components/ui/settings-section';
import { StatusBadge } from '@nibleaf/design-system/components/ui/status-badge';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { useForm, useStore } from '@tanstack/react-form';
import { ChevronDown, ExternalLink, Globe2, RefreshCw } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { DirtyStateReporter } from '@/components/project-settings/shared';
import { QueryErrorState } from '@/components/query-error-state';
import { FormField } from '@/components/ui/form-field';
import { type Domain, demotedByError, domainErrorMessage, type Project } from '@/hooks/api';
import { useProjectAdminStatus } from '@/hooks/use-project-admin-status';
import { isolate } from '@/lib/bidi';
import { useFormatters } from '@/lib/format';
import { validateOnBlurThenChange, withServerError } from '@/lib/forms/field-errors';
import type { SiteAdminState } from '@/lib/project-settings-access';
import { useAddSiteDomain, useCheckSiteDomain, useRemoveSiteDomain, useSetPrimarySiteDomain, useSiteDomains } from '../api/hooks';
import {
  addDecision,
  addErrorTarget,
  checkFailureToasts,
  checkOutcome,
  cleanDomainInput,
  type Decision,
  type DomainToast,
  decisionProps,
  dnsRecordView,
  domainAccess,
  domainBadge,
  domainHref,
  domainInputProblem,
  domainRowActions,
  domainStage,
  STAGES,
  setupDetails,
} from '../model/domains';

/** Site settings → Custom domain: the site's domains, each with its setup state, DNS records and actions, and a field to add one. */
export function DomainSettings({ project }: { project: Project }) {
  const t = useT();
  const query = useSiteDomains(project.id);
  const { status } = useProjectAdminStatus(project.id);
  const access = domainAccess(status);
  const domains = query.data ?? [];
  const add = addDecision(status);

  const retry = <QueryErrorState onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  let body: ReactNode;
  if (query.isPending) {
    body = (
      <SettingsSection>
        <DataListSkeleton loadingLabel={t('common.loading')} rows={2} withLeading={false} />
      </SettingsSection>
    );
  } else if (query.isError && !query.data) {
    body = retry;
  } else {
    body = (
      <>
        {query.isError ? retry : null}
        <SettingsSection>
          {domains.length ? (
            <DomainList domains={domains} projectId={project.id} status={status} />
          ) : (
            <DataListEmpty>
              <EmptyState headingLevel={2} icon={<Globe2 />} title={t('settings.domain.empty')} />
            </DataListEmpty>
          )}
          {add ? <AddDomainForm decision={add} projectId={project.id} /> : null}
        </SettingsSection>
      </>
    );
  }

  return (
    <div className="me-auto flex w-full max-w-[47.5rem] flex-col gap-8">
      <PageHeader description={t('settings.domain.description')} title={t('settings.domain.title')} />
      {access.readOnly ? <Callout title={t('settings.permissions.title')}>{t('settings.permissions.body')}</Callout> : null}
      {body}
    </div>
  );
}

/** Shows the toasts a check produced, naming the domain where the message needs it. */
function useDomainToasts() {
  const t = useT();
  return (toasts: DomainToast[], host: string) => {
    for (const { kind, key, withDomain } of toasts) toast[kind](withDomain ? t(key, { domain: isolate(host) }) : t(key));
  };
}

function DomainList({ domains, projectId, status }: { domains: Domain[]; projectId: string; status: SiteAdminState }) {
  const t = useT();
  const showToasts = useDomainToasts();
  const check = useCheckSiteDomain(projectId);
  const setPrimary = useSetPrimarySiteDomain(projectId);
  const remove = useRemoveSiteDomain(projectId);
  // Opened or folded by the person (or by a check that found a record missing); otherwise the model's default.
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [removeTarget, setRemoveTarget] = useState<Domain | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);

  const setOpen = (id: string, open: boolean) => setOpened((current) => ({ ...current, [id]: open }));
  const checkingId = check.isPending ? check.variables : undefined;
  const primaryId = setPrimary.isPending ? setPrimary.variables : undefined;

  const runCheck = (domain: Domain) =>
    check.mutate(domain.id, {
      onSuccess: (result) => {
        const { toasts, revealRecords } = checkOutcome(result);
        showToasts(toasts, domain.domain);
        if (revealRecords) setOpen(domain.id, true);
      },
      // The reason is toasted by the mutation; losing the main address is said here.
      onError: (error) => showToasts(checkFailureToasts(demotedByError(error)), domain.domain),
    });
  const makePrimary = (domain: Domain) => setPrimary.mutate(domain.id, { onSuccess: () => toast.success(t('settings.domain.toast.primary')) });

  return (
    <>
      <DataList aria-label={t('settings.domain.title')}>
        {domains.map((domain) => (
          <DomainRow
            actions={domainRowActions(domain, status, { checkingId, primaryId })}
            checking={checkingId === domain.id}
            domain={domain}
            key={domain.id}
            onCheck={() => runCheck(domain)}
            onMakePrimary={() => makePrimary(domain)}
            onOpenChange={(open) => setOpen(domain.id, open)}
            onRemove={() => {
              setRemoveTarget(domain);
              setRemoveOpen(true);
            }}
            open={opened[domain.id]}
          />
        ))}
      </DataList>
      <ActionDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('settings.domain.remove')}
        description={removeTarget ? t('settings.domain.removeConfirm', { domain: isolate(removeTarget.domain) }) : undefined}
        destructive
        errorMessage={(error) => domainErrorMessage(t, error, 'settings.domain.toast.removeError')}
        fallbackErrorMessage={t('settings.domain.toast.removeError')}
        onConfirm={async () => {
          if (!removeTarget) return;
          await remove.mutateAsync(removeTarget.id);
          toast.success(t('settings.domain.toast.removed'));
        }}
        onOpenChange={setRemoveOpen}
        open={removeOpen}
        title={t('settings.domain.remove')}
      />
    </>
  );
}

function DomainRow({
  domain,
  actions,
  checking,
  open,
  onOpenChange,
  onCheck,
  onMakePrimary,
  onRemove,
}: {
  domain: Domain;
  actions: ReturnType<typeof domainRowActions>;
  checking: boolean;
  open: boolean | undefined;
  onOpenChange: (open: boolean) => void;
  onCheck: () => void;
  onMakePrimary: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const format = useFormatters();
  const stage = domainStage(domain);
  const badge = domainBadge(stage, checking);
  const help = STAGES[stage].help;
  const href = domainHref(domain);
  const details = setupDetails(domain);
  const host = domain.domain;
  const reason = (decision: Decision | null) => {
    const props = decision ? decisionProps(decision) : { disabled: false };
    return { disabled: props.disabled, disabledReason: props.reason ? t(props.reason) : undefined };
  };
  const hasActions = actions.check || actions.setPrimary || actions.remove;

  return (
    <DataListItem
      badges={
        <>
          <StatusBadge tone={badge.tone}>{t(badge.label)}</StatusBadge>
          {domain.isPrimary ? <StatusBadge tone="neutral">{t('settings.domain.status.primary')}</StatusBadge> : null}
        </>
      }
      description={help ? <span className={cn(STAGES[stage].tone === 'danger' && 'text-destructive')}>{t(help)}</span> : undefined}
      meta={
        domain.lastCheckedAt || domain.isPrimary ? (
          <>
            {domain.lastCheckedAt ? <span>{t('settings.domain.lastChecked', { date: format.dateTime(domain.lastCheckedAt) })}</span> : null}
            {domain.isPrimary ? <span>{t('settings.domain.primaryHint')}</span> : null}
          </>
        ) : undefined
      }
      title={
        href ? (
          <a
            className="inline-flex items-center gap-1.5 break-all font-mono hover:text-primary"
            dir="ltr"
            href={href}
            rel="noreferrer"
            target="_blank"
          >
            {host} <ExternalLink aria-hidden className="size-3" />
          </a>
        ) : (
          <span className="break-all font-mono" dir="ltr">
            {host}
          </span>
        )
      }
      trailing={
        hasActions ? (
          <RowActions label={t('settings.domain.actionsFor', { domain: isolate(host) })}>
            {actions.check ? (
              <RowActionsItem icon={<RefreshCw aria-hidden />} onSelect={onCheck} {...reason(actions.check)}>
                {t('settings.domain.retry')}
              </RowActionsItem>
            ) : null}
            {actions.setPrimary ? (
              <RowActionsItem onSelect={onMakePrimary} {...reason(actions.setPrimary)}>
                {t('settings.domain.makePrimary')}
              </RowActionsItem>
            ) : null}
            {actions.remove ? (
              <RowActionsItem destructive onSelect={onRemove} {...reason(actions.remove)}>
                {t('settings.domain.remove')}
              </RowActionsItem>
            ) : null}
          </RowActions>
        ) : undefined
      }
    >
      {details.hasDetails ? (
        <Collapsible className="mt-2" onOpenChange={onOpenChange} open={open ?? details.openByDefault}>
          <CollapsibleTrigger render={<Button className="group/trigger -ms-2 text-muted-foreground" size="sm" type="button" variant="ghost" />}>
            {t('settings.domain.configuration')}
            <span className="sr-only"> {host}</span>
            <ChevronDown aria-hidden className="size-3.5 transition-transform group-data-[panel-open]/trigger:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 flex flex-col gap-3 text-sm">
              {details.showSteps ? (
                <ol className="list-decimal space-y-1 ps-5 text-muted-foreground">
                  {(['settings.domain.guide.step1', 'settings.domain.guide.step2', 'settings.domain.guide.step3'] as const).map((key) => (
                    <li key={key}>{t(key)}</li>
                  ))}
                </ol>
              ) : null}
              {details.apexHint ? <p className="text-muted-foreground">{t('settings.domain.apexHint', { domain: isolate(host) })}</p> : null}
              {details.hasRecords ? <DnsRecords domain={domain} /> : null}
              {details.showSteps && actions.check ? (
                <div>
                  <Button loading={checking} onClick={onCheck} size="sm" type="button" variant="outline" {...reason(actions.check)}>
                    <RefreshCw aria-hidden />
                    {t('settings.domain.retry')}
                    <span className="sr-only"> {host}</span>
                  </Button>
                </div>
              ) : null}
              {details.technicalError ? (
                <details className="text-muted-foreground text-xs">
                  <summary className="cursor-pointer select-none">{t('settings.domain.technicalDetails')}</summary>
                  <code className="mt-1.5 block break-all" dir="ltr">
                    {details.technicalError}
                  </code>
                </details>
              ) : null}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </DataListItem>
  );
}

/** The records to create at the DNS provider, one per hairline-divided block, each value copyable. */
function DnsRecords({ domain }: { domain: Domain }) {
  const t = useT();
  const records = (domain.records ?? []).map((record) => dnsRecordView(record, domain.domain));
  const copy = (field: string, type: string, value: string) => (
    <CopyButton
      copiedLabel={t('settings.domain.dns.copied')}
      failedLabel={t('settings.domain.dns.copyFailed')}
      label={t('settings.domain.dns.copyField', { field, type, domain: isolate(domain.domain) })}
      value={value}
    />
  );
  return (
    <div>
      <p className="font-medium text-sm">{t('settings.domain.dns.heading')}</p>
      <ul className="mt-1 divide-y divide-border">
        {records.map((record) => (
          <li className="py-3" key={record.key}>
            <p className="text-muted-foreground text-xs">{t(record.purpose)}</p>
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
              <dt className="text-muted-foreground text-xs">{t('settings.domain.dns.type')}</dt>
              <dd className="col-span-2 min-h-8 content-center">
                <code dir="ltr">{record.type}</code>
              </dd>
              <dt className="text-muted-foreground text-xs">{t('settings.domain.dns.name')}</dt>
              <dd className="min-w-0">
                <code className="select-all break-all" dir="ltr">
                  {record.host}
                </code>
              </dd>
              <dd>{copy(t('settings.domain.dns.name'), record.type, record.host)}</dd>
              <dt className="text-muted-foreground text-xs">{t('settings.domain.dns.value')}</dt>
              <dd className="min-w-0">
                <code className="select-all break-all" dir="ltr">
                  {record.value}
                </code>
              </dd>
              <dd>{copy(t('settings.domain.dns.value'), record.type, record.value)}</dd>
            </dl>
            {record.host === record.fullName ? null : (
              <p className="mt-2 text-muted-foreground text-xs">
                {t('settings.domain.dns.fullName')}{' '}
                <code className="select-all break-all" dir="ltr">
                  {record.fullName}
                </code>
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The field that adds a domain. One field with its own button, so no save bar:
 * a plain TanStack form whose error shows once the field is left or submitted.
 */
function AddDomainForm({ projectId, decision }: { projectId: string; decision: Decision }) {
  const t = useT();
  const add = useAddSiteDomain(projectId);
  const locked = decisionProps(decision).disabled;
  const invalid = t('settings.domain.error.invalid');
  const form = useForm({
    defaultValues: { domain: '' },
    onSubmit: async ({ value }) => {
      const { cleaned } = cleanDomainInput(value.domain);
      form.setFieldValue('domain', cleaned);
      try {
        await add.mutateAsync({ domain: cleaned });
        toast.success(t('settings.domain.toast.added'));
        form.reset();
      } catch (error) {
        const message = domainErrorMessage(t, error, 'settings.domain.toast.addError');
        // A refusal about the host goes under the field, where the fix happens; anything else is a toast.
        if (addErrorTarget(error) === 'field') form.setFieldMeta('domain', (meta) => withServerError(meta, message));
        else toast.error(message);
      }
    },
  });
  const typed = useStore(form.store, (state) => state.values.domain);
  const { apex, cleaned } = cleanDomainInput(typed);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <DirtyStateReporter dirty={Boolean(typed.trim())} />
      <form.Field
        name="domain"
        validators={{
          ...validateOnBlurThenChange((value: string) => (domainInputProblem(value, 'edit') ? invalid : undefined)),
          onSubmit: ({ value }: { value: string }) => (domainInputProblem(value, 'submit') ? invalid : undefined),
        }}
      >
        {(field) => (
          <FormField<string>
            description={apex ? t('settings.domain.apexHint', { domain: isolate(cleaned) }) : undefined}
            field={field}
            label={t('settings.domain.add')}
            layout="stacked"
          >
            {({ controlProps, value, onValueChange }) => (
              <div className="flex flex-wrap gap-2">
                <Input
                  {...controlProps}
                  autoCapitalize="none"
                  autoComplete="off"
                  className="min-w-0 flex-1 basis-56 font-mono"
                  dir="ltr"
                  disabled={locked}
                  inputMode="url"
                  onBlur={() => {
                    controlProps.onBlur();
                    // Show what will be connected once the person moves on.
                    const next = cleanDomainInput(value);
                    if (next.valid && next.cleaned !== value) onValueChange(next.cleaned);
                  }}
                  onChange={(event) => onValueChange(event.target.value)}
                  placeholder="docs.yoursite.com"
                  spellCheck={false}
                  value={value}
                />
                <Button disabled={locked} loading={add.isPending} type="submit">
                  {t('settings.domain.add')}
                </Button>
              </div>
            )}
          </FormField>
        )}
      </form.Field>
    </form>
  );
}
