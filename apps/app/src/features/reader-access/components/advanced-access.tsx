import { ActionDialog } from '@nibleaf/design-system/components/ui/action-dialog';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@nibleaf/design-system/components/ui/collapsible';
import { DataList, DataListItem, RowActions, RowActionsItem } from '@nibleaf/design-system/components/ui/data-list';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { SettingsRow } from '@nibleaf/design-system/components/ui/settings-row';
import { SettingsSection, SettingsSectionBody } from '@nibleaf/design-system/components/ui/settings-section';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { useStore } from '@tanstack/react-form';
import { ChevronDown } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { toast } from 'sonner';
import { DirtyStateReporter } from '@/components/project-settings/shared';
import { SecretInput } from '@/components/secret-input';
import { FormField } from '@/components/ui/form-field';
import type { ReaderAccessData } from '@/hooks/api';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { isolate } from '@/lib/bidi';
import { useFormatters } from '@/lib/format';
import { validateOnBlurThenChange, withServerError } from '@/lib/forms/field-errors';
import { focusFirstInvalid, useSaveRegionForm } from '@/lib/forms/save-region';
import { useServerDraftForm } from '@/lib/forms/use-server-draft';
import type { SiteAdminState } from '@/lib/project-settings-access';
import { useAudiencePages, useCreateAudience, useDeleteAudience, useEmergencyRevoke, useSaveJwtConfig, useTestJwt } from '../api/hooks';
import { decisionProps, manageDecision } from '../model/access';
import {
  audienceNameProblem,
  audienceRequest,
  audienceScope,
  auditActionLabel,
  grantablePages,
  JWT_IMPACT_TEXT,
  JWT_PROBLEM_TEXT,
  type JwtField,
  type JwtImpact,
  type JwtProblem,
  type JwtValues,
  jwtChangeImpacts,
  jwtFieldProblem,
  jwtImpactKeepsSessions,
  jwtSavedValues,
  jwtSaveRequest,
  jwtValues,
} from '../model/advanced';
import { DraftConflicts } from './draft-conflicts';

type Props = { projectId: string; data: ReaderAccessData; status: SiteAdminState };

/**
 * Controls most owners never need: page-limited audiences, the JWT handoff
 * from a customer portal, and the access log with emergency revocation. Folded
 * under "Advanced access" so the everyday choices stay simple. The folded
 * part stays mounted, so an unsaved JWT edit survives folding, and a save
 * that finds a JWT field to fix unfolds it to show the field.
 */
export function AdvancedAccess(props: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const reveal = useCallback(() => flushSync(() => setOpen(true)), []);
  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <h2 className="font-semibold text-base">
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 rounded-md text-start outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          {t('settings.visibility.advanced.title')}
          <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180" />
        </CollapsibleTrigger>
      </h2>
      <p className="mt-1 max-w-prose text-muted-foreground text-sm">{t('settings.visibility.advanced.body')}</p>
      <CollapsibleContent className="mt-6 flex flex-col gap-10" keepMounted>
        <AudiencesSection {...props} />
        <JwtSection {...props} onInvalid={reveal} />
        <AuditSection {...props} />
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Audiences ──────────────────────────────────────────────────────────────

function AudiencesSection({ projectId, data, status }: Props) {
  const t = useT();
  const format = useFormatters();
  const pages = useAudiencePages(projectId);
  const create = useCreateAudience(projectId);
  const remove = useDeleteAudience(projectId);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const manage = decisionProps(manageDecision(status));
  const pageOptions = useMemo(
    () =>
      grantablePages(pages.data ?? []).map((page) => ({
        value: page.id,
        label: (
          <>
            <span dir="auto">{page.title}</span> · <span dir="ltr">/{page.path}</span>
          </>
        ),
      })),
    [pages.data],
  );
  const required = (value: string) =>
    audienceNameProblem(value) ? t('validation.required', { label: t('settings.visibility.audiences.name') }) : undefined;

  // An add form on the form lifecycle (operations/ui-overhaul.md §8.3): one
  // create at a time, and a name typed while one is created is kept.
  const empty = useMemo(() => ({ name: '', pageIds: [] as string[] }), []);
  const { form, ...draft } = useServerDraftForm({
    identity: [projectId, 'create-audience'],
    source: empty,
    onSubmit: async (value, outcome) => {
      try {
        await create.mutateAsync(audienceRequest(value));
        toast.success(t('settings.authentication.reader.audienceCreated'));
        outcome.succeeded(empty);
        return 'saved';
      } catch (error) {
        outcome.failed();
        toast.error(friendlyErrorMessage(t, error, 'settings.saveError'));
        return 'failed';
      }
    },
  });
  const dirty = useStore(form.store, (state) => Boolean(state.values.name.trim()) || state.values.pageIds.length > 0);

  return (
    <SettingsSection
      description={t('settings.authentication.reader.audiencesDescription')}
      headingLevel={3}
      title={t('settings.authentication.reader.audiencesTitle')}
    >
      <form
        className="divide-y divide-border"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void draft.submit();
        }}
      >
        <DirtyStateReporter dirty={dirty || draft.isSaving} />
        <form.Field name="name" validators={validateOnBlurThenChange(required)}>
          {(field) => (
            <FormField<string> control="field" field={field} label={t('settings.visibility.audiences.name')}>
              {({ controlProps, value, onValueChange }) => (
                <Input
                  {...controlProps}
                  dir="auto"
                  disabled={manage.disabled}
                  onChange={(event) => onValueChange(event.target.value)}
                  placeholder={t('settings.authentication.reader.audiencePlaceholder')}
                  value={value}
                />
              )}
            </FormField>
          )}
        </form.Field>
        {pages.isError && !pages.data ? (
          <SettingsSectionBody>
            <Callout
              action={
                <Button loading={pages.isFetching} onClick={() => void pages.refetch()} size="sm" type="button" variant="outline">
                  {t('common.retry')}
                </Button>
              }
              tone="warning"
            >
              {t('settings.visibility.audiences.pagesError')}
            </Callout>
          </SettingsSectionBody>
        ) : (
          <form.Field name="pageIds">
            {(field) => (
              <SettingsRow
                control="field"
                description={t('settings.authentication.reader.audienceAllPages')}
                label={t('settings.visibility.audiences.pages')}
              >
                {(ids) => (
                  <Select
                    items={pageOptions}
                    multiple
                    onValueChange={(next) => field.handleChange((next as string[] | null) ?? [])}
                    value={field.state.value}
                  >
                    <SelectTrigger
                      aria-describedby={ids.describedBy}
                      aria-labelledby={ids.labelId}
                      className="w-full"
                      disabled={manage.disabled || pages.isPending}
                      id={ids.controlId}
                    >
                      <SelectValue placeholder={t('settings.authentication.reader.entireSite')} />
                    </SelectTrigger>
                    <SelectContent>
                      {pageOptions.map((page) => (
                        <SelectItem key={page.value} value={page.value}>
                          {page.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </SettingsRow>
            )}
          </form.Field>
        )}
        <SettingsSectionBody>
          <Button disabled={manage.disabled} loading={draft.isSaving} type="submit">
            {t('settings.authentication.reader.createAudience')}
          </Button>
        </SettingsSectionBody>
      </form>
      {data.audiences.length > 0 ? (
        <DataList aria-label={t('settings.authentication.reader.audiencesTitle')}>
          {data.audiences.map((audience) => {
            const scope = audienceScope(audience);
            return (
              <DataListItem
                key={audience.id}
                meta={
                  <>
                    <span>
                      {scope.kind === 'site'
                        ? t('settings.authentication.reader.entireSite')
                        : t('settings.authentication.reader.pageCount', format.count(scope.count))}
                    </span>
                    <span>{t('settings.authentication.reader.readerCount', { count: audience._count.readers })}</span>
                  </>
                }
                title={<span dir="auto">{audience.name}</span>}
                trailing={
                  <RowActions label={t('settings.visibility.actionsFor', { name: isolate(audience.name) })}>
                    <RowActionsItem
                      destructive
                      disabled={manage.disabled}
                      onSelect={() => {
                        setRemoveTarget(audience);
                        setRemoveOpen(true);
                      }}
                    >
                      {t('common.delete')}
                    </RowActionsItem>
                  </RowActions>
                }
              />
            );
          })}
        </DataList>
      ) : null}
      <ActionDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.delete')}
        destructive
        errorMessage={(error) => friendlyErrorMessage(t, error, 'settings.saveError')}
        fallbackErrorMessage={t('settings.saveError')}
        onConfirm={async () => {
          if (removeTarget) await remove.mutateAsync(removeTarget.id);
        }}
        onOpenChange={setRemoveOpen}
        open={removeOpen}
        title={t('settings.authentication.reader.deleteAudienceConfirm', { name: isolate(removeTarget?.name ?? '') })}
      />
    </SettingsSection>
  );
}

// ─── JWT portal handoff ─────────────────────────────────────────────────────

/** Each JWT text field: its label, an example in the field, and whether it is a multi-line JSON box. */
const JWT_FIELDS: ReadonlyArray<{
  name: JwtField;
  label: MessageKey;
  description?: MessageKey;
  placeholder: string;
  multiline?: boolean;
}> = [
  { name: 'issuer', label: 'settings.visibility.jwt.issuer', placeholder: 'https://portal.example.com' },
  { name: 'audience', label: 'settings.visibility.jwt.audience', placeholder: 'nibleaf-docs' },
  { name: 'jwksUrl', label: 'settings.visibility.jwt.jwksUrl', placeholder: 'https://portal.example.com/.well-known/jwks.json' },
  {
    name: 'publicJwks',
    label: 'settings.visibility.jwt.publicJwks',
    description: 'settings.authentication.reader.jwksPlaceholder',
    placeholder: '{"keys": [ … ]}',
    multiline: true,
  },
  { name: 'groupsClaim', label: 'settings.visibility.jwt.groupsClaim', placeholder: 'groups' },
  { name: 'claimMapping', label: 'settings.visibility.jwt.claimMapping', placeholder: '{"customer": "audience_id"}', multiline: true },
];

/**
 * The JWT handoff settings: an explicit-save draft (`useServerDraftForm`,
 * identity `[projectId, 'reader-jwt']`) saved by the page's save bar. It is
 * kept in step with the server without ever dropping an edit, so creating an
 * audience (which refetches reader access) leaves a half-typed issuer alone.
 *
 * A save that changes who can sign in (turning the handoff on or off, a new
 * issuer, audience or key set) first asks, saying what changes; the save bar
 * waits for that answer, and the save runs from the dialog.
 */
function JwtSection({ projectId, data, status, onInvalid }: Props & { onInvalid: () => void }) {
  const t = useT();
  const saveJwt = useSaveJwtConfig(projectId);
  const formRef = useRef<HTMLFormElement>(null);
  const manage = decisionProps(manageDecision(status));
  const source = useMemo(() => jwtValues(data.jwt), [data.jwt]);
  // Set while the confirmation runs the save, so a failure shows in the dialog rather than a toast.
  const confirming = useRef<{ failure: unknown } | null>(null);
  const [confirmation, setConfirmation] = useState<{ impacts: JwtImpact[] }>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const problemText = (field: JwtField, problem: JwtProblem | undefined) => {
    if (!problem) return;
    if (problem !== 'required') return t(JWT_PROBLEM_TEXT[problem]);
    const label = JWT_FIELDS.find((item) => item.name === field)?.label;
    return t('validation.required', { label: label ? t(label) : '' });
  };

  const { form, ...draft } = useServerDraftForm<JwtValues>({
    identity: [projectId, 'reader-jwt'],
    source,
    onSubmit: async (value, outcome) => {
      const request = jwtSaveRequest(value);
      if (!request.ok) {
        // What the server schema would refuse goes on the field it is about; it clears when that field changes.
        for (const [field, problem] of Object.entries(request.problems) as Array<[JwtField, JwtProblem]>) {
          const message = problemText(field, problem);
          if (message) form.setFieldMeta(field, (meta) => withServerError(meta, message));
        }
        return 'invalid';
      }
      try {
        await saveJwt.mutateAsync(request.body);
        outcome.succeeded(jwtSavedValues(request.body));
        return 'saved';
      } catch (error) {
        outcome.failed();
        if (confirming.current) confirming.current.failure = error;
        else if (outcome.isCurrent()) toast.error(friendlyErrorMessage(t, error, 'settings.saveError'));
        return 'failed';
      }
    },
  });

  const { submit: submitDraft, baseline } = draft;
  // The page's save bar disables Save while saving, so 'busy' only means "nothing new to report".
  const save = useCallback(async () => {
    const outcome = await submitDraft();
    if (outcome === 'invalid') onInvalid();
    return outcome === 'busy' ? 'failed' : outcome;
  }, [onInvalid, submitDraft]);
  const submit = useCallback(async (): Promise<'saved' | 'invalid' | 'failed' | 'deferred'> => {
    const values = form.state.values;
    const impacts = jwtChangeImpacts(baseline, values);
    // Nothing that changes who can sign in, or a value to fix first: save (or show the problems) now.
    if (impacts.length === 0 || !jwtSaveRequest(values).ok) return save();
    // Ask first. The save bar moves on idle (it shows "Saving…" only once the
    // save really runs, from the dialog), and the dialog reports the outcome.
    setConfirmation({ impacts });
    setConfirmOpen(true);
    return 'deferred';
  }, [baseline, form, save]);
  useSaveRegionForm('reader-jwt', { isDirty: draft.isDirty, isSubmitting: draft.isSaving, submit, discard: draft.discard });

  return (
    <SettingsSection
      description={t('settings.authentication.reader.jwtDescription')}
      headingLevel={3}
      title={t('settings.authentication.reader.jwtTitle')}
    >
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
        <form.Field name="enabled">
          {(field) => (
            <SettingsRow control="switch" label={t('settings.authentication.reader.jwtEnable')}>
              {(ids) => (
                <Switch
                  {...ids.controlProps}
                  aria-labelledby={ids.labelId}
                  checked={field.state.value}
                  disabled={manage.disabled}
                  onCheckedChange={(checked) => field.handleChange(checked)}
                />
              )}
            </SettingsRow>
          )}
        </form.Field>
        {JWT_FIELDS.map((item) => (
          <form.Field
            key={item.name}
            name={item.name}
            validators={validateOnBlurThenChange((value: string) => problemText(item.name, jwtFieldProblem(item.name, value)))}
          >
            {(field) => (
              <FormField<string>
                control="field"
                description={item.description ? t(item.description) : undefined}
                field={field}
                label={t(item.label)}
                layout={item.multiline ? 'stacked' : 'inline'}
              >
                {({ controlProps, value, onValueChange }) =>
                  item.multiline ? (
                    <Textarea
                      {...controlProps}
                      className="min-h-24 font-mono text-xs"
                      dir="ltr"
                      disabled={manage.disabled}
                      onChange={(event) => onValueChange(event.target.value)}
                      placeholder={item.placeholder}
                      spellCheck={false}
                      value={value}
                    />
                  ) : (
                    <Input
                      {...controlProps}
                      autoCapitalize="off"
                      autoComplete="off"
                      dir="ltr"
                      disabled={manage.disabled}
                      onChange={(event) => onValueChange(event.target.value)}
                      placeholder={item.placeholder}
                      spellCheck={false}
                      value={value}
                    />
                  )
                }
              </FormField>
            )}
          </form.Field>
        ))}
      </form>
      <JwtTester disabled={manage.disabled} projectId={projectId} />
      <ActionDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.save')}
        description={t('settings.visibility.jwt.confirm.body')}
        destructive={confirmation?.impacts.includes('disable')}
        errorMessage={(error) => friendlyErrorMessage(t, error, 'settings.saveError')}
        fallbackErrorMessage={t('settings.saveError')}
        onConfirm={async () => {
          confirming.current = { failure: null };
          try {
            const outcome = await save();
            if (outcome === 'failed') throw confirming.current.failure ?? new Error('The JWT settings were not saved.');
            if (outcome === 'saved') toast.success(t('settings.authentication.reader.jwtSaved'));
          } finally {
            confirming.current = null;
          }
        }}
        onOpenChange={setConfirmOpen}
        open={confirmOpen}
        title={t('settings.visibility.jwt.confirm.title')}
      >
        {confirmation ? (
          <ul className="flex list-disc flex-col gap-1.5 ps-5 text-sm">
            {confirmation.impacts.map((impact) => (
              <li key={impact}>{t(JWT_IMPACT_TEXT[impact])}</li>
            ))}
            {jwtImpactKeepsSessions(confirmation.impacts) ? <li>{t('settings.visibility.jwt.impact.sessions')}</li> : null}
          </ul>
        ) : null}
      </ActionDialog>
    </SettingsSection>
  );
}

/** Checks a pasted JWT against the saved configuration. The token is validated, never stored, and isn't part of any save. */
function JwtTester({ projectId, disabled }: { projectId: string; disabled: boolean }) {
  const t = useT();
  const test = useTestJwt(projectId);
  const [token, setToken] = useState('');
  return (
    <SettingsRow label={t('settings.authentication.reader.jwtTest')} layout="stacked">
      {(ids) => (
        <div className="flex flex-col items-start gap-2">
          {/* A signed token is a credential while it is valid: masked, and never filled or saved by the browser. */}
          <SecretInput
            {...ids.controlProps}
            className="text-xs"
            disabled={disabled}
            name="reader-jwt-test-token"
            onChange={(event) => setToken(event.target.value)}
            placeholder={t('settings.authentication.reader.jwtTestPlaceholder')}
            value={token}
          />
          <Button
            disabled={disabled || !token.trim()}
            loading={test.isPending}
            onClick={() =>
              void test.mutateAsync(token).then(
                (result) => toast.success(`${t('settings.authentication.reader.jwtValid')}: ${JSON.stringify(result)}`),
                (error: unknown) => toast.error(friendlyErrorMessage(t, error, 'settings.saveError')),
              )
            }
            type="button"
            variant="outline"
          >
            {t('settings.authentication.reader.jwtTest')}
          </Button>
        </div>
      )}
    </SettingsRow>
  );
}

// ─── Access log ─────────────────────────────────────────────────────────────

function AuditSection({ projectId, data, status }: Props) {
  const t = useT();
  const format = useFormatters();
  const emergency = useEmergencyRevoke(projectId);
  const [confirming, setConfirming] = useState(false);
  const manage = decisionProps(manageDecision(status));
  return (
    <SettingsSection
      description={t('settings.authentication.reader.auditDescription')}
      headingLevel={3}
      title={t('settings.authentication.reader.auditTitle')}
    >
      <SettingsSectionBody>
        <Button disabled={manage.disabled} onClick={() => setConfirming(true)} type="button" variant="destructive">
          {t('settings.authentication.reader.emergencyAction')}
        </Button>
      </SettingsSectionBody>
      {data.audit.length > 0 ? (
        <DataList aria-label={t('settings.authentication.reader.auditTitle')} className="max-h-72 overflow-y-auto">
          {data.audit.map((event) => {
            const label = auditActionLabel(event.action);
            return (
              <DataListItem
                key={event.id}
                meta={<time dateTime={event.createdAt}>{format.dateTime(event.createdAt)}</time>}
                title={'key' in label ? t(label.key) : <span dir="ltr">{label.raw}</span>}
              />
            );
          })}
        </DataList>
      ) : null}
      <ActionDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('settings.authentication.reader.emergencyAction')}
        description={t('settings.authentication.reader.emergencyConfirm')}
        destructive
        errorMessage={(error) => friendlyErrorMessage(t, error, 'settings.saveError')}
        fallbackErrorMessage={t('settings.saveError')}
        onConfirm={async () => {
          await emergency.mutateAsync(undefined);
          toast.success(t('settings.authentication.reader.emergencySuccess'));
        }}
        onOpenChange={setConfirming}
        open={confirming}
        title={t('settings.authentication.reader.emergencyAction')}
      />
    </SettingsSection>
  );
}
