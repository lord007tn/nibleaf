import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { SettingsSection, SettingsSectionBody } from '@nibleaf/design-system/components/ui/settings-section';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { useT } from '@nibleaf/i18n/react';
import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/ui/form-field';
import type { Project } from '@/hooks/api';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { validateOnBlurThenChange } from '@/lib/forms/field-errors';
import { SaveRegionProvider, SaveRegionSubmit, useSaveRegionForm } from '@/lib/forms/save-region';
import { useServerDraftForm } from '@/lib/forms/use-server-draft';
import { useSaveAnalytics } from '../api/hooks';
import { type AnalyticsValues, analyticsValues, ga4Problem, plausibleProblem } from '../model/analytics';

/**
 * Site settings → Integrations → Analytics: the site's GA4 and Plausible ids
 * and its two analytics opt-ins, in one explicit-save form.
 */
export function AnalyticsSettings({ project }: { project: Project }) {
  return (
    <SaveRegionProvider>
      <AnalyticsForm project={project} />
    </SaveRegionProvider>
  );
}

/** Identifiers are Latin and read left to right in every locale. */
const identifierProps = {
  autoCapitalize: 'off',
  autoComplete: 'off',
  className: 'font-mono text-sm',
  dir: 'ltr',
  spellCheck: false,
} as const;

function AnalyticsForm({ project }: { project: Project }) {
  const t = useT();
  const { save } = useSaveAnalytics(project.id);
  const source = useMemo(() => analyticsValues(project.config), [project.config]);

  const { form, ...draft } = useServerDraftForm<AnalyticsValues>({
    identity: [project.id, 'analytics'],
    source,
    onSubmit: async (value, outcome) => {
      try {
        outcome.succeeded(await save(outcome.baseline, value));
        return 'saved';
      } catch (error) {
        outcome.failed();
        // A save for a site this form no longer shows says nothing.
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
  const formProps = useSaveRegionForm('site-analytics', {
    isDirty: draft.isDirty,
    isSubmitting: draft.isSaving,
    submit,
    discard: draft.discard,
    settlement: draft.settlement,
  });

  const ga4Message = (value: string) => (ga4Problem(value) ? t('settings.analytics.ga4.error') : undefined);
  const plausibleMessage = (value: string) => (plausibleProblem(value) ? t('settings.analytics.plausible.error') : undefined);

  return (
    <form className="flex flex-col gap-6" noValidate {...formProps}>
      <SaveRegionSubmit />
      {draft.conflicts.length > 0 ? (
        <Callout
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  for (const key of draft.conflicts) draft.resolveConflict(key, 'theirs');
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {t('forms.useTheirs')}
              </Button>
              <Button
                onClick={() => {
                  for (const key of draft.conflicts) draft.resolveConflict(key, 'mine');
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t('forms.keepMine')}
              </Button>
            </div>
          }
          tone="warning"
        >
          {t('forms.changedElsewhere')}
        </Callout>
      ) : null}

      {/* Named by the page's own heading (Integrations → Analytics). */}
      <SettingsSection>
        <form.Field name="ga4" validators={validateOnBlurThenChange(ga4Message)}>
          {(field) => (
            <FormField<string> control="field" description={t('settings.analytics.ga4.hint')} field={field} label={t('settings.analytics.ga4.label')}>
              {({ controlProps, value, onValueChange }) => (
                <Input
                  {...controlProps}
                  {...identifierProps}
                  onChange={(event) => onValueChange(event.target.value)}
                  placeholder="G-XXXXXXXXXX"
                  value={value}
                />
              )}
            </FormField>
          )}
        </form.Field>
        <form.Field name="plausible" validators={validateOnBlurThenChange(plausibleMessage)}>
          {(field) => (
            <FormField<string>
              control="field"
              description={t('settings.analytics.plausible.hint')}
              field={field}
              label={t('settings.analytics.plausible.label')}
            >
              {({ controlProps, value, onValueChange }) => (
                <Input
                  {...controlProps}
                  {...identifierProps}
                  onChange={(event) => onValueChange(event.target.value)}
                  placeholder="docs.yoursite.com"
                  value={value}
                />
              )}
            </FormField>
          )}
        </form.Field>
        <SettingsSectionBody className="text-muted-foreground text-sm">{t('settings.analytics.cookieConsent.managed')}</SettingsSectionBody>
        <form.Field name="campaignDimensions">
          {(field) => (
            <FormField<boolean>
              control="switch"
              description={t('settings.analytics.campaignDimensions.hint')}
              field={field}
              label={t('settings.analytics.campaignDimensions.title')}
            >
              {({ controlProps, ids, value, onValueChange }) => (
                <Switch {...controlProps} aria-labelledby={ids.labelId} checked={value} onCheckedChange={onValueChange} />
              )}
            </FormField>
          )}
        </form.Field>
        <form.Field name="storePublicSearchTerms">
          {(field) => (
            <FormField<boolean>
              control="switch"
              description={t('settings.analytics.searchTerms.hint')}
              field={field}
              label={t('settings.analytics.searchTerms.title')}
            >
              {({ controlProps, ids, value, onValueChange }) => (
                <Switch {...controlProps} aria-labelledby={ids.labelId} checked={value} onCheckedChange={onValueChange} />
              )}
            </FormField>
          )}
        </form.Field>
      </SettingsSection>
    </form>
  );
}
