import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { PageHeader } from '@nibleaf/design-system/components/ui/page-header';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { SettingsRow } from '@nibleaf/design-system/components/ui/settings-row';
import { SettingsSection } from '@nibleaf/design-system/components/ui/settings-section';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { useT } from '@nibleaf/i18n/react';
import { slugify } from '@nibleaf/shared/utils';
import { useStore } from '@tanstack/react-form';
import { Link } from '@tanstack/react-router';
import { Ban } from 'lucide-react';
import { type ReactNode, useCallback, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { LanguageOptionLabel, Segmented, SettingsFormSkeleton } from '@/components/project-settings/shared';
import { FormField } from '@/components/ui/form-field';
import { env } from '@/env';
import type { Language, Project } from '@/hooks/api';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { validateOnBlurThenChange, withServerError } from '@/lib/forms/field-errors';
import { focusFirstInvalid, SaveRegionProvider, useSaveRegionForm } from '@/lib/forms/save-region';
import { useServerDraftForm } from '@/lib/forms/use-server-draft';
import { useGeneralLanguages, useSaveGeneral } from '../api/hooks';
import {
  GENERAL_ICON_CHOICES,
  type GeneralValues,
  generalValues,
  isSlugTaken,
  nameProblem,
  normalizeBaseDomain,
  normalizeGeneral,
  orderLanguages,
  siteAddressPreview,
  slugProblem,
  translationChooser,
} from '../model/general';

const baseDomain = normalizeBaseDomain(env.VITE_SITE_BASE_DOMAIN);

/** The `dir` for text written in a content language, independent of the interface locale. */
const dirOf = (language: Pick<Language, 'direction'> | undefined) => (language ? (language.direction === 'RTL' ? 'rtl' : 'ltr') : 'auto');

/** Site settings → General. One explicit-save form for the site's name, icon, description, address and translations. */
export function GeneralSettings({ project }: { project: Project }) {
  const languages = useGeneralLanguages(project.id);
  if (languages.isPending) return <SettingsFormSkeleton />;
  return (
    <SaveRegionProvider>
      {/* A failed language list still lets the site's own fields be edited; translations need it. */}
      <GeneralForm languages={languages.data ?? []} project={project} />
    </SaveRegionProvider>
  );
}

function GeneralForm({ project, languages }: { project: Project; languages: Language[] }) {
  const t = useT();
  const { save } = useSaveGeneral(project.id);
  const ordered = orderLanguages(languages);
  const defaultLanguage = ordered.find((language) => language.isDefault);
  const extraLanguages = ordered.filter((language) => !language.isDefault);
  const source = useMemo(() => generalValues(project, languages), [project, languages]);
  const result = useRef<'saved' | 'invalid' | 'failed'>('invalid');
  const [selectedLanguageId, setSelectedLanguageId] = useState<string>();
  const selectedLanguage = extraLanguages.find((language) => language.id === selectedLanguageId) ?? extraLanguages[0];
  const formRef = useRef<HTMLFormElement>(null);

  const { form, ...draft } = useServerDraftForm<GeneralValues>({
    identity: [project.id, 'general'],
    source,
    onSubmit: async (value, outcome) => {
      try {
        await save(outcome.baseline, value);
        outcome.succeeded(normalizeGeneral(value));
        result.current = 'saved';
      } catch (error) {
        outcome.failed();
        // A save for a site this form no longer shows must not touch it.
        if (!outcome.isCurrent()) return;
        if (isSlugTaken(error)) {
          form.setFieldMeta('slug', (meta) => withServerError(meta, t('settings.general.url.taken')));
          result.current = 'invalid';
          return;
        }
        toast.error(friendlyErrorMessage(t, error, 'settings.saveError'));
        result.current = 'failed';
      }
    },
  });
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
  const defaultName = useStore(form.store, (state) => state.values.name);
  const defaultDescription = useStore(form.store, (state) => state.values.description);

  const submit = useCallback(async () => {
    result.current = 'invalid';
    await form.handleSubmit();
    return result.current;
  }, [form]);
  useSaveRegionForm('site-general', { isDirty: draft.isDirty, isSubmitting, submit, discard: draft.discard });

  const required = (value: string) => (nameProblem(value) ? t('validation.required', { label: t('settings.general.name.label') }) : undefined);
  const slugMessage = (value: string) => (slugProblem(value) ? t('settings.general.url.error') : undefined);

  return (
    <form
      className="me-auto flex w-full max-w-[47.5rem] flex-col gap-8"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!draft.isDirty) return;
        void submit().then((outcome) => outcome === 'invalid' && focusFirstInvalid(formRef.current));
      }}
      ref={formRef}
    >
      <PageHeader description={t('settings.general.summary')} title={t('settings.general.title')} />

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

      <SettingsSection title={t('settings.general.identity.title')}>
        <form.Field name="icon">{(field) => <IconRow onChange={(icon) => field.handleChange(icon)} value={field.state.value} />}</form.Field>
        <form.Field name="name" validators={validateOnBlurThenChange(required)}>
          {(field) => (
            <FormField<string> control="field" description={t('settings.general.name.hint')} field={field} label={t('settings.general.name.label')}>
              {({ controlProps, value, onValueChange }) => (
                <Input
                  {...controlProps}
                  dir={dirOf(defaultLanguage)}
                  lang={defaultLanguage?.code}
                  onChange={(event) => onValueChange(event.target.value)}
                  value={value}
                />
              )}
            </FormField>
          )}
        </form.Field>
        <form.Field name="description">
          {(field) => (
            <FormField<string>
              description={t('settings.general.description.hint')}
              field={field}
              label={t('settings.general.description.label')}
              layout="stacked"
            >
              {({ controlProps, value, onValueChange }) => (
                <Textarea
                  {...controlProps}
                  className="min-h-21"
                  dir={dirOf(defaultLanguage)}
                  lang={defaultLanguage?.code}
                  onChange={(event) => onValueChange(event.target.value)}
                  value={value}
                />
              )}
            </FormField>
          )}
        </form.Field>
      </SettingsSection>

      <SettingsSection
        footer={
          <p>
            {t('settings.general.customDomain.hint')}{' '}
            <Link
              className="font-medium text-primary underline-offset-4 hover:underline"
              params={{ projectId: project.id }}
              search={{ section: 'domain' }}
              to="/app/projects/$projectId/settings"
            >
              {t('settings.general.customDomain.link')}
            </Link>
          </p>
        }
        title={t('settings.general.address.title')}
      >
        <form.Field name="slug" validators={validateOnBlurThenChange(slugMessage)}>
          {(field) => (
            <FormField<string>
              description={t('settings.general.url.subdomainHint')}
              field={field}
              label={t('settings.general.url.label')}
              layout="stacked"
            >
              {({ controlProps, value, onValueChange }) => (
                <>
                  {/* Hostnames are always LTR, so the suffix trails the name in an RTL dashboard too. */}
                  <div
                    className="flex h-(--control-size-default) w-full rounded-md border border-input bg-transparent shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-aria-invalid:border-destructive dark:bg-input/30"
                    dir="ltr"
                  >
                    <Input
                      {...controlProps}
                      autoCapitalize="off"
                      autoComplete="off"
                      className="h-full min-h-0 min-w-0 flex-1 rounded-e-none border-0 bg-transparent font-mono shadow-none focus-visible:ring-0 dark:bg-transparent"
                      onChange={(event) => onValueChange(slugify(event.target.value))}
                      spellCheck={false}
                      value={value}
                    />
                    {baseDomain ? (
                      <span className="flex shrink-0 items-center rounded-e-md border-border border-s bg-muted/40 px-3 font-mono text-muted-foreground text-sm">
                        .{baseDomain}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1.5 font-mono text-muted-foreground text-xs rtl:text-end" dir="ltr">
                    {siteAddressPreview(value, baseDomain, project.id)}
                  </p>
                </>
              )}
            </FormField>
          )}
        </form.Field>
      </SettingsSection>

      {selectedLanguage ? (
        <TranslationsSection
          chooser={translationChooser(extraLanguages.length)}
          languages={extraLanguages}
          onSelect={setSelectedLanguageId}
          selected={selectedLanguage}
        >
          <form.Field key={`${selectedLanguage.id}-name`} name={`translations.${selectedLanguage.id}.name`}>
            {(field) => (
              <FormField<string>
                control="field"
                field={field}
                label={
                  <>
                    {t('settings.general.translations.name.label')} · <LanguageOptionLabel language={selectedLanguage} />
                  </>
                }
              >
                {({ controlProps, value, onValueChange }) => (
                  <Input
                    {...controlProps}
                    dir={dirOf(selectedLanguage)}
                    lang={selectedLanguage.code}
                    onChange={(event) => onValueChange(event.target.value)}
                    placeholder={defaultName}
                    value={value}
                  />
                )}
              </FormField>
            )}
          </form.Field>
          <form.Field key={`${selectedLanguage.id}-description`} name={`translations.${selectedLanguage.id}.description`}>
            {(field) => (
              <FormField<string>
                field={field}
                label={
                  <>
                    {t('settings.general.translations.description.label')} · <LanguageOptionLabel language={selectedLanguage} />
                  </>
                }
                layout="stacked"
              >
                {({ controlProps, value, onValueChange }) => (
                  <Textarea
                    {...controlProps}
                    className="min-h-21"
                    dir={dirOf(selectedLanguage)}
                    lang={selectedLanguage.code}
                    onChange={(event) => onValueChange(event.target.value)}
                    placeholder={defaultDescription || undefined}
                    value={value}
                  />
                )}
              </FormField>
            )}
          </form.Field>
        </TranslationsSection>
      ) : null}
    </form>
  );
}

/** The Translations section: which language to edit, then that language's fields (passed as children). */
function TranslationsSection({
  chooser,
  languages,
  selected,
  onSelect,
  children,
}: {
  chooser: ReturnType<typeof translationChooser>;
  languages: Language[];
  selected: Language;
  onSelect: (id: string) => void;
  children: ReactNode;
}) {
  const t = useT();
  const options = languages.map((language) => ({ value: language.id, label: <LanguageOptionLabel language={language} /> }));
  return (
    <SettingsSection description={t('settings.general.translations.hint')} title={t('settings.general.translations.title')}>
      {chooser === 'segmented' ? (
        <SettingsRow asGroup control="auto" label={t('settings.general.translations.language')}>
          {() => <Segmented onChange={onSelect} options={options} value={selected.id} />}
        </SettingsRow>
      ) : chooser === 'select' ? (
        <SettingsRow control="compact" label={t('settings.general.translations.language')}>
          {(ids) => (
            <Select items={options} onValueChange={(value) => onSelect((value as string) ?? selected.id)} value={selected.id}>
              <SelectTrigger aria-labelledby={ids.labelId} className="w-full" id={ids.controlId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {languages.map((language) => (
                  <SelectItem key={language.id} value={language.id}>
                    <LanguageOptionLabel language={language} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </SettingsRow>
      ) : null}
      {children}
    </SettingsSection>
  );
}

/** The site icon: a preview, then a group of native radios (arrow keys move between them) when opened. */
function IconRow({ value, onChange }: { value: string | null; onChange: (icon: string | null) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const groupId = useId();
  const choices: Array<string | null> = [null, ...GENERAL_ICON_CHOICES];
  return (
    <>
      <SettingsRow description={t('settings.general.icon.hint')} label={t('settings.general.icon.label')}>
        {(ids) => (
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary text-xl">
              {value ?? <Ban className="size-4 text-muted-foreground" />}
            </span>
            <Button
              aria-controls={groupId}
              aria-describedby={ids.describedBy}
              aria-expanded={open}
              id={ids.controlId}
              onClick={() => setOpen((current) => !current)}
              type="button"
              variant="outline"
            >
              {t('settings.general.changeIcon')}
            </Button>
          </div>
        )}
      </SettingsRow>
      {open ? (
        <fieldset className="m-0 flex min-w-0 flex-wrap gap-2 border-0 px-4 py-4 sm:px-5" id={groupId}>
          <legend className="sr-only">{t('settings.general.icon.label')}</legend>
          {choices.map((choice) => (
            <label
              className="grid size-10 cursor-pointer place-items-center rounded-lg border border-border bg-card text-lg transition-colors hover:bg-muted has-checked:border-primary has-checked:bg-primary/10 has-checked:text-primary has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
              key={choice ?? 'none'}
            >
              <input
                checked={choice === value}
                className="sr-only"
                name={`${groupId}-icon`}
                onChange={() => onChange(choice)}
                type="radio"
                value={choice ?? ''}
              />
              {choice ? <span aria-hidden>{choice}</span> : <Ban aria-hidden className="size-4 text-muted-foreground" />}
              <span className="sr-only">{choice ?? t('settings.general.noIcon')}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
    </>
  );
}
