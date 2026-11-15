import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { useT } from '@nibleaf/i18n/react';
import { useStore } from '@tanstack/react-form';
import { Megaphone } from 'lucide-react';
import { useCallback, useId, useLayoutEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  FIELD_INPUT,
  Field,
  LanguageScopePicker,
  SectionHeader,
  sortLanguagesDefaultFirst,
  ToggleRow,
  useScopeDirtyGuard,
} from '@/components/project-settings/shared';
import type { Language, Project } from '@/hooks/api';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { errorMessages, fieldErrorsVisible, validateOnBlurThenChange, withoutStaleErrors } from '@/lib/forms/field-errors';
import { SaveRegionProvider, SaveRegionSubmit, useSaveRegionForm } from '@/lib/forms/save-region';
import { useServerDraftForm } from '@/lib/forms/use-server-draft';
import { useBannerLanguages, useSaveBanner } from '../api/hooks';
import { type BannerValues, inheritedPlaceholders, languageBannerValues, linkUrlProblem, PROJECT_SCOPE, projectBannerValues } from '../model/banner';

/** The `dir` for text written in a content language, independent of the interface locale. */
const dirOf = (language: Pick<Language, 'direction'> | undefined) => (language ? (language.direction === 'RTL' ? 'rtl' : 'ltr') : 'auto');

/**
 * Site configuration → Banner, in Settings → Appearance and the editor's
 * Configuration tab. One explicit-save form edits the active scope: "Default"
 * edits the project banner, a language scope edits that language's override.
 */
export function BannerSettings({ project }: { project: Project }) {
  return (
    <SaveRegionProvider>
      <BannerForm project={project} />
    </SaveRegionProvider>
  );
}

function BannerForm({ project }: { project: Project }) {
  const t = useT();
  const { data: languages } = useBannerLanguages(project.id);
  const { saveProject, saveLanguage } = useSaveBanner(project.id);
  const ordered = sortLanguagesDefaultFirst(languages ?? []);
  const defaultLanguage = ordered.find((language) => language.isDefault);
  const extraLanguages = ordered.filter((language) => !language.isDefault);
  const [scope, setScope] = useState<string>(PROJECT_SCOPE);
  const activeLanguage = extraLanguages.find((language) => language.id === scope);
  const projectBanner = project.config?.banner;
  const override = activeLanguage?.config?.banner;
  const source = useMemo(
    () => (activeLanguage ? languageBannerValues(override, projectBanner) : projectBannerValues(projectBanner)),
    [activeLanguage, override, projectBanner],
  );

  const { form, ...draft } = useServerDraftForm<BannerValues>({
    identity: [project.id, 'banner', activeLanguage?.id ?? PROJECT_SCOPE],
    source,
    onSubmit: async (value, save) => {
      try {
        const confirmed = activeLanguage ? await saveLanguage(activeLanguage.id, value, projectBanner) : await saveProject(value);
        save.succeeded(confirmed);
        return 'saved';
      } catch (error) {
        save.failed();
        // A save for a scope this form has since left says nothing here.
        if (save.isCurrent()) toast.error(friendlyErrorMessage(t, error, 'settings.saveError'));
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
  // Enter in a single-line field saves this form through the bar's own run: same lock, status and focus.
  const formProps = useSaveRegionForm('site-banner', { isDirty: draft.isDirty, isSubmitting: draft.isSaving, submit, discard: draft.discard });

  // Switching scope asks first while there are edits, or a save that can still change them.
  const { guard, setDirty } = useScopeDirtyGuard();
  const unsettled = draft.isDirty || draft.isSaving;
  useLayoutEffect(() => setDirty(unsettled), [setDirty, unsettled]);

  const enabled = useStore(form.store, (state) => state.values.enabled);
  const submissionAttempts = useStore(form.store, (state) => state.submissionAttempts);
  const linkUrlId = useId();
  const linkUrlMessage = (value: string) => (linkUrlProblem(value) ? t('settings.addons.url.invalid') : undefined);
  const placeholders = activeLanguage ? inheritedPlaceholders(projectBanner) : {};
  const contentLanguage = activeLanguage ?? defaultLanguage;
  const contentDir = dirOf(contentLanguage);

  return (
    <form noValidate {...formProps}>
      <SaveRegionSubmit />
      <SectionHeader icon={<Megaphone className="size-4" />} title={t('settings.banner.title')} />
      <p className="mb-4 text-[13.5px] text-muted-foreground leading-relaxed">{t('settings.banner.description')}</p>
      <LanguageScopePicker
        defaultLanguage={defaultLanguage}
        guard={guard}
        hint={t('settings.banner.scope.hint')}
        languages={extraLanguages}
        onChange={setScope}
        value={scope}
      />

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
          className="mb-4"
          tone="warning"
        >
          {t('forms.changedElsewhere')}
        </Callout>
      ) : null}

      <form.Field name="enabled">
        {(field) => (
          <ToggleRow
            checked={field.state.value}
            hint={t('settings.banner.enable.hint')}
            onCheckedChange={field.handleChange}
            title={t('settings.banner.enable.title')}
          />
        )}
      </form.Field>

      {enabled ? (
        <>
          <div className="mt-5">
            <form.Field name="message">
              {(field) => (
                <Field hint={t('settings.banner.message.hint')} label={t('settings.banner.message.label')}>
                  <Input
                    className={FIELD_INPUT}
                    dir={contentDir}
                    lang={contentLanguage?.code}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder={placeholders.message ?? t('settings.banner.message.placeholder')}
                    value={field.state.value}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="linkLabel">
              {(field) => (
                <Field hint={t('settings.banner.linkLabel.hint')} label={t('settings.banner.linkLabel.label')}>
                  <Input
                    className={FIELD_INPUT}
                    dir={contentDir}
                    lang={contentLanguage?.code}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder={placeholders.linkLabel ?? t('settings.banner.linkLabel.placeholder')}
                    value={field.state.value}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="linkUrl" validators={validateOnBlurThenChange(linkUrlMessage)}>
              {(field) => {
                // Shown once the field was left or a save was tried (operations/ui-overhaul.md §6.4).
                const errors = fieldErrorsVisible(field.state.meta, submissionAttempts) ? errorMessages(field.state.meta.errors) : [];
                return (
                  <Field hint={t('settings.banner.linkUrl.hint')} htmlFor={linkUrlId} label={t('settings.banner.linkUrl.label')}>
                    <Input
                      aria-describedby={errors.length > 0 ? `${linkUrlId}-error` : undefined}
                      aria-invalid={errors.length > 0 || undefined}
                      className={FIELD_INPUT}
                      dir="ltr"
                      id={linkUrlId}
                      onBlur={field.handleBlur}
                      onChange={(event) => {
                        field.setMeta((meta) => withoutStaleErrors(meta));
                        field.handleChange(event.target.value);
                      }}
                      placeholder={placeholders.linkUrl ?? t('settings.banner.linkUrl.placeholder')}
                      type="url"
                      value={field.state.value}
                    />
                    <FieldError className="mt-1.5 text-destructive text-xs" errors={errors} id={`${linkUrlId}-error`} />
                  </Field>
                );
              }}
            </form.Field>
          </div>
          <form.Field name="dismissible">
            {(field) => (
              <ToggleRow
                checked={field.state.value}
                hint={t('settings.banner.dismissible.hint')}
                onCheckedChange={field.handleChange}
                title={t('settings.banner.dismissible.title')}
              />
            )}
          </form.Field>
        </>
      ) : null}
    </form>
  );
}
