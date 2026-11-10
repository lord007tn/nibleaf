import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { SettingsSectionBody } from '@nibleaf/design-system/components/ui/settings-section';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { type ReactNode, useCallback, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { FormField, type FormFieldControl } from '@/components/ui/form-field';
import type { ProjectAddon } from '@/hooks/api';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { validateOnBlurThenChange } from '@/lib/forms/field-errors';
import { focusFirstInvalid, useSaveRegionForm } from '@/lib/forms/save-region';
import type { DraftValues } from '@/lib/forms/server-draft';
import { useServerDraftForm } from '@/lib/forms/use-server-draft';
import { useSaveAddonSettings } from '../api/hooks';
import {
  ADDON_TEXT,
  type AdminStatus,
  addonSettingsKind,
  CONSENT_BUTTON_LAYOUTS,
  CONSENT_PLACEMENTS,
  CONSENT_PRESENTATIONS,
  consentConfig,
  consentValues,
  FEEDBACK_PLACEMENTS,
  FEEDBACK_PRESENTATIONS,
  feedbackConfig,
  feedbackValues,
  isUrlTemplateAddon,
  privacyUrlProblem,
  settingsDecision,
  URL_PROBLEM_TEXT,
  URL_TEMPLATE_TEXT,
  type UrlTemplateAddonId,
  urlTemplateConfig,
  urlTemplateProblem,
  urlTemplateValues,
} from '../model/addons';
import type { AddonWrites } from './addons-settings';

type Props = { addon: ProjectAddon; projectId: string; status: AdminStatus; writes: AddonWrites };

/** The add-on's settings, when it has any: one explicit-save form registered with the page's save bar. */
export function AddonSettingsForm(props: Props) {
  const kind = addonSettingsKind(props.addon.id);
  if (kind === 'feedback') return <FeedbackForm {...props} />;
  if (kind === 'consent') return <ConsentForm {...props} />;
  if (kind === 'urlTemplate' && isUrlTemplateAddon(props.addon.id)) return <UrlTemplateForm {...props} addonId={props.addon.id} />;
  return null;
}

/**
 * One add-on's settings as a form kept in step with the server
 * (`useServerDraftForm`, identity `[projectId, 'addon', addonId]`) and
 * registered with the page's SaveRegion, so the bar shows only while
 * something changed and the leave guard sees it.
 */
function useAddonDraft<T extends DraftValues>(
  { addon, projectId, writes }: Props,
  toValues: (config: Record<string, unknown>) => T,
  toConfig: (values: T) => Record<string, unknown>,
) {
  const t = useT();
  const { save } = useSaveAddonSettings(projectId);
  const source = useMemo(() => toValues(addon.config), [addon.config, toValues]);

  const { form, ...draft } = useServerDraftForm<T>({
    identity: [projectId, 'addon', addon.id],
    source,
    onSubmit: async (value, outcome) => {
      writes.setSaving(true);
      try {
        // A switch flip in flight bumps the revision: wait for it, then send the latest.
        await writes.switchSettled();
        const saved = await save(addon.id, toConfig(value), writes.revision());
        writes.recordRevision(saved.revision);
        outcome.succeeded(toValues(saved.config));
        return 'saved';
      } catch (error) {
        outcome.failed();
        if (outcome.isCurrent()) toast.error(friendlyErrorMessage(t, error, 'settings.saveError'));
        return 'failed';
      } finally {
        writes.setSaving(false);
      }
    },
  });
  const { submit: submitDraft } = draft;
  // The page's save bar disables Save while saving, so 'busy' only means "nothing new to report".
  const submit = useCallback(async () => {
    const outcome = await submitDraft();
    return outcome === 'busy' ? 'failed' : outcome;
  }, [submitDraft]);
  useSaveRegionForm(`addon-${addon.id}`, { isDirty: draft.isDirty, isSubmitting: draft.isSaving, submit, discard: draft.discard });
  return { form, draft, submit };
}

/**
 * The add-on's settings rows, grouped under its name (one panel with the
 * switch row above, no inner card), as a `<form>` so Enter in a field saves.
 */
function AddonFormFrame({
  addon,
  draft,
  submit,
  reason,
  children,
}: {
  addon: ProjectAddon;
  /** Why the settings can't be changed, shown once above them. */
  reason?: string;
  draft: { isDirty: boolean; conflicts: string[]; resolveConflict: (key: never, choice: 'theirs' | 'mine') => void };
  submit: () => Promise<'saved' | 'invalid' | 'failed'>;
  children: ReactNode;
}) {
  const t = useT();
  const formRef = useRef<HTMLFormElement>(null);
  const resolveAll = (choice: 'theirs' | 'mine') => {
    for (const key of draft.conflicts) draft.resolveConflict(key as never, choice);
  };
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!draft.isDirty) return;
        void submit().then((outcome) => outcome === 'invalid' && focusFirstInvalid(formRef.current));
      }}
      ref={formRef}
    >
      <fieldset className="m-0 min-w-0 divide-y divide-border border-0 p-0 ps-4 sm:ps-5">
        <legend className="sr-only">{t(ADDON_TEXT[addon.id].title)}</legend>
        {reason ? <p className="px-4 py-3 text-muted-foreground text-sm sm:px-5">{reason}</p> : null}
        {draft.conflicts.length > 0 ? (
          <SettingsSectionBody>
            <Callout
              action={
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => resolveAll('theirs')} size="sm" type="button" variant="outline">
                    {t('forms.useTheirs')}
                  </Button>
                  <Button onClick={() => resolveAll('mine')} size="sm" type="button" variant="ghost">
                    {t('forms.keepMine')}
                  </Button>
                </div>
              }
              tone="warning"
            >
              {t('forms.changedElsewhere')}
            </Callout>
          </SettingsSectionBody>
        ) : null}
        {children}
      </fieldset>
    </form>
  );
}

/** The visible reason when the settings are closed for a reason (not merely locked while access loads). */
function settingsReason(t: ReturnType<typeof useT>, props: Props): string | undefined {
  const decision = settingsDecision(props.addon, props.status);
  return decision.kind === 'denied' ? t(decision.reason) : undefined;
}

/** A select over fixed options, labelled by its row, showing each option's words rather than its stored token. */
function OptionSelect({
  control,
  options,
  disabled,
}: {
  control: FormFieldControl<string>;
  options: ReadonlyArray<{ value: string; label: MessageKey }>;
  disabled: boolean;
}) {
  const t = useT();
  const items = options.map((option) => ({ value: option.value, label: t(option.label) }));
  return (
    <Select
      disabled={disabled}
      items={items}
      onValueChange={(next) => control.onValueChange((next as string | null) ?? control.value)}
      value={control.value}
    >
      <SelectTrigger {...control.controlProps} aria-labelledby={control.ids.labelId} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FeedbackForm(props: Props) {
  const t = useT();
  const { form, draft, submit } = useAddonDraft(props, feedbackValues, feedbackConfig);
  const disabled = settingsDecision(props.addon, props.status).kind !== 'allowed';
  return (
    <AddonFormFrame addon={props.addon} draft={draft} reason={settingsReason(t, props)} submit={submit}>
      <form.Field name="placement">
        {(field) => (
          <FormField<string> control="compact" field={field} label={t('settings.addons.feedback.placement')}>
            {(control) => <OptionSelect control={control} disabled={disabled} options={FEEDBACK_PLACEMENTS} />}
          </FormField>
        )}
      </form.Field>
      <form.Field name="presentation">
        {(field) => (
          <FormField<string> control="compact" field={field} label={t('settings.addons.feedback.presentation')}>
            {(control) => <OptionSelect control={control} disabled={disabled} options={FEEDBACK_PRESENTATIONS} />}
          </FormField>
        )}
      </form.Field>
    </AddonFormFrame>
  );
}

function UrlTemplateForm({ addonId, ...props }: Props & { addonId: UrlTemplateAddonId }) {
  const t = useT();
  const { form, draft, submit } = useAddonDraft(props, urlTemplateValues, urlTemplateConfig);
  const disabled = settingsDecision(props.addon, props.status).kind !== 'allowed';
  const text = URL_TEMPLATE_TEXT[addonId];
  const check = (value: string) => {
    const problem = urlTemplateProblem(addonId, value);
    return problem ? t(URL_PROBLEM_TEXT[problem]) : undefined;
  };
  return (
    <AddonFormFrame addon={props.addon} draft={draft} reason={settingsReason(t, props)} submit={submit}>
      <form.Field name="urlTemplate" validators={validateOnBlurThenChange(check)}>
        {(field) => (
          <FormField<string> description={t(text.hint, text.params)} field={field} label={t(text.label)} layout="stacked">
            {({ controlProps, value, onValueChange }) => (
              <Input
                {...controlProps}
                autoCapitalize="off"
                autoComplete="off"
                className="font-mono"
                dir="ltr"
                disabled={disabled}
                inputMode="url"
                onChange={(event) => onValueChange(event.target.value)}
                placeholder={t(text.example, text.params)}
                spellCheck={false}
                value={value}
              />
            )}
          </FormField>
        )}
      </form.Field>
    </AddonFormFrame>
  );
}

function ConsentForm(props: Props) {
  const t = useT();
  const { form, draft, submit } = useAddonDraft(props, consentValues, consentConfig);
  const disabled = settingsDecision(props.addon, props.status).kind !== 'allowed';
  const check = (value: string) => (privacyUrlProblem(value) ? t(URL_PROBLEM_TEXT.invalid) : undefined);
  return (
    <AddonFormFrame addon={props.addon} draft={draft} reason={settingsReason(t, props)} submit={submit}>
      <form.Field name="placement">
        {(field) => (
          <FormField<string> control="compact" field={field} label={t('settings.addons.consent.placement')}>
            {(control) => <OptionSelect control={control} disabled={disabled} options={CONSENT_PLACEMENTS} />}
          </FormField>
        )}
      </form.Field>
      <form.Field name="presentation">
        {(field) => (
          <FormField<string> control="compact" field={field} label={t('settings.addons.consent.presentation')}>
            {(control) => <OptionSelect control={control} disabled={disabled} options={CONSENT_PRESENTATIONS} />}
          </FormField>
        )}
      </form.Field>
      <form.Field name="buttonLayout">
        {(field) => (
          <FormField<string> control="compact" field={field} label={t('settings.addons.consent.buttons')}>
            {(control) => <OptionSelect control={control} disabled={disabled} options={CONSENT_BUTTON_LAYOUTS} />}
          </FormField>
        )}
      </form.Field>
      <form.Field name="privacyPolicyUrl" validators={validateOnBlurThenChange(check)}>
        {(field) => (
          <FormField<string> control="field" field={field} label={t('site.analyticsConsentPrivacy')}>
            {({ controlProps, value, onValueChange }) => (
              <Input
                {...controlProps}
                autoCapitalize="off"
                autoComplete="url"
                dir="ltr"
                disabled={disabled}
                onChange={(event) => onValueChange(event.target.value)}
                spellCheck={false}
                type="url"
                value={value}
              />
            )}
          </FormField>
        )}
      </form.Field>
      <SettingsSectionBody>
        <Callout role="note" title={t('settings.addons.consent.preview')}>
          {t('settings.addons.consent.previewDescription')}
        </Callout>
      </SettingsSectionBody>
    </AddonFormFrame>
  );
}
