import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { slugify } from '@nibleaf/shared/utils';
import { useForm } from '@tanstack/react-form';
import { CirclePlus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { env } from '@/env';
import type { Language, Project } from '@/hooks/api';
import { useLanguages, useUpdateLanguage, useUpdateProject } from '@/hooks/api';
import { required } from '@/lib/form';
import {
  FIELD_INPUT,
  FIELD_TEXTAREA,
  Field,
  GroupLabel,
  LanguageOptionLabel,
  SaveBar,
  SectionHeader,
  Segmented,
  sortLanguagesDefaultFirst,
} from './shared';

/** A small curated set of emoji icons the project can use as its avatar glyph. */
const ICON_CHOICES = ['📘', '📕', '📗', '🚀', '⚡', '🛠️', '🧩', '🔌', '📦', '🌐', '🔭', '✨'];

// Only present a `slug.<base>` preview when a base domain is actually configured
// for this deployment; otherwise the free-subdomain host would 404, so fall back
// to the working /sites/:id path.
const siteBaseDomain = env.VITE_SITE_BASE_DOMAIN?.replace(/^\*\./, '').replace(/\.$/, '') || undefined;
const deploymentNameError = (value: string, message: string) => {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)) {
    return message;
  }
};

/** The localized site name/description draft for one extra language. */
type TranslationDraft = { name: string; description: string };

const draftOf = (language: Language): TranslationDraft => ({
  name: language.translation?.name ?? '',
  description: language.translation?.description ?? '',
});

/** The `dir` for an input that holds text written in `language` — the CONTENT
 *  language, independent of the interface locale, so an Arabic site name edits
 *  RTL inside an English dashboard and vice versa. */
const dirOf = (language: Pick<Language, 'direction'> | undefined) => (language ? (language.direction === 'RTL' ? 'rtl' : 'ltr') : undefined);

export function GeneralSection({ project }: { project: Project }) {
  const t = useT();
  const update = useUpdateProject(project.id);
  const updateLanguage = useUpdateLanguage(project.id);
  const { data: languages } = useLanguages(project.id);
  const [icon, setIcon] = useState<string>(project.icon ?? '📘');
  const [iconOpen, setIconOpen] = useState(false);
  // Localized site name/description per NON-default language (Translations
  // group below). Drafts are keyed by language id and survive switching the
  // selected language; untouched languages read straight from their stored config.
  const orderedLanguages = sortLanguagesDefaultFirst(languages ?? []);
  const defaultLanguage = orderedLanguages.find((language) => language.isDefault);
  const extraLanguages = orderedLanguages.filter((language) => !language.isDefault);
  const [selectedLanguageId, setSelectedLanguageId] = useState<string>();
  const selectedLanguage = extraLanguages.find((language) => language.id === selectedLanguageId) ?? extraLanguages[0];
  const [translations, setTranslations] = useState<Record<string, TranslationDraft>>({});
  const translationsDirty = extraLanguages.some((language) => {
    const draft = translations[language.id];
    if (!draft) return false;
    const stored = draftOf(language);
    return draft.name.trim() !== stored.name || draft.description.trim() !== stored.description;
  });
  const setTranslation = (language: Language, patch: Partial<TranslationDraft>) =>
    setTranslations((prev) => ({ ...prev, [language.id]: { ...(prev[language.id] ?? draftOf(language)), ...patch } }));

  /** Persist every edited translation. Empty inputs clear the override (the
   *  server merge spreads the patch over the stored config, so the SEO keys
   *  survive); when nothing is overridden anymore the config resets to null,
   *  matching the language-settings dialog. */
  const saveTranslations = async () => {
    for (const language of extraLanguages) {
      const draft = translations[language.id];
      if (!draft) {
        continue;
      }
      const stored = draftOf(language);
      const name = draft.name.trim();
      const description = draft.description.trim();
      if (name === stored.name && description === stored.description) {
        continue;
      }
      await updateLanguage.mutateAsync({ id: language.id, body: { translation: name || description ? { name, description } : null } });
    }
  };

  const form = useForm({
    defaultValues: { name: project.name, slug: project.slug, description: project.description ?? '' },
    onSubmit: async ({ value }) => {
      try {
        await new Promise<void>((resolve, reject) => {
          update.mutate(
            {
              name: value.name.trim(),
              slug: value.slug.trim(),
              description: value.description.trim() ? value.description.trim() : null,
              icon,
            },
            { onSuccess: () => resolve(), onError: (error) => reject(error) },
          );
        });
        await saveTranslations();
        toast.success(t('common.saved'));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('settings.saveError'));
      }
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <SectionHeader icon={<CirclePlus className="size-4" />} title={t('settings.general.title')} />

      <div className="mb-3.5 flex items-center gap-3.5">
        <span className="grid size-[46px] place-items-center rounded-xl bg-primary/10 text-2xl text-primary">{icon}</span>
        <button
          className="h-[34px] cursor-pointer rounded-[9px] border border-border bg-card px-3 text-[13px] hover:bg-muted"
          onClick={() => setIconOpen((open) => !open)}
          type="button"
        >
          {t('settings.general.changeIcon')}
        </button>
      </div>
      {iconOpen ? (
        <div className="mb-5 flex flex-wrap gap-2 rounded-xl bg-muted/30 p-3.5">
          {ICON_CHOICES.map((choice) => {
            const active = choice === icon;
            return (
              <button
                className={cn(
                  'grid size-[38px] cursor-pointer place-items-center rounded-[9px] border text-base',
                  active ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card hover:bg-muted',
                )}
                key={choice}
                onClick={() => {
                  setIcon(choice);
                  setIconOpen(false);
                }}
                type="button"
              >
                {choice}
              </button>
            );
          })}
        </div>
      ) : null}

      {selectedLanguage ? (
        <div className="mb-6 border-border border-t pt-5">
          <div className="mb-4">
            <GroupLabel>{t('settings.general.translations.title')}</GroupLabel>
            <p className="mt-1 text-[12.5px] text-muted-foreground leading-snug">{t('settings.general.translations.hint')}</p>
          </div>

          {/* Language chooser: a single extra language needs no control at all
              (a one-option segmented bar reads as a mystery button), a few get
              the segmented pills, many get a select. */}
          {extraLanguages.length === 1 ? (
            <div className="mb-4 flex items-center gap-2 text-[13px]">
              <span className="text-muted-foreground">{t('settings.general.translations.language')}</span>
              <span className="font-medium">
                <LanguageOptionLabel language={selectedLanguage} />
              </span>
            </div>
          ) : extraLanguages.length <= 3 ? (
            <Segmented
              className="mb-4"
              onChange={setSelectedLanguageId}
              options={extraLanguages.map((language) => ({ value: language.id, label: <LanguageOptionLabel language={language} /> }))}
              value={selectedLanguage.id}
            />
          ) : (
            <div className="mb-4">
              <Select
                items={extraLanguages.map((language) => ({ value: language.id, label: <LanguageOptionLabel language={language} /> }))}
                onValueChange={(value) => setSelectedLanguageId((value as string) ?? undefined)}
                value={selectedLanguage.id}
              >
                <SelectTrigger aria-label={t('settings.general.translations.language')} className="w-full bg-background sm:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {extraLanguages.map((language) => (
                    <SelectItem key={language.id} value={language.id}>
                      <LanguageOptionLabel language={language} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="grid grid-cols-1 border-border border-b bg-muted/35 sm:grid-cols-2 sm:divide-x sm:divide-border rtl:sm:divide-x-reverse">
              <div className="flex min-h-11 items-center gap-2 px-4 py-2.5">
                <span className="font-semibold text-[13px]" dir={dirOf(defaultLanguage)} lang={defaultLanguage?.code}>
                  {defaultLanguage?.label ?? t('settings.chrome.scope.default')}
                </span>
                <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-[10px] text-primary uppercase tracking-wide">
                  {t('settings.languages.defaultBadge')}
                </span>
              </div>
              <div className="flex min-h-11 items-center px-4 py-2.5 font-semibold text-[13px]">
                <LanguageOptionLabel language={selectedLanguage} />
              </div>
            </div>

            <form.Field name="name" validators={{ onChange: ({ value }) => required(t('settings.general.name.label'), t)(value) }}>
              {(field) => {
                const draft = translations[selectedLanguage.id] ?? draftOf(selectedLanguage);
                return (
                  <div className="grid grid-cols-1 gap-5 p-4 sm:grid-cols-2 sm:gap-6">
                    <Field className="mb-0" hint={t('settings.general.name.hint')} htmlFor="set-name" label={t('settings.general.name.label')}>
                      <Input
                        className={FIELD_INPUT}
                        dir={dirOf(defaultLanguage)}
                        id="set-name"
                        lang={defaultLanguage?.code}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        value={field.state.value}
                      />
                      <FieldError errors={field.state.meta.errors} />
                    </Field>
                    <Field className="mb-0" htmlFor="set-lang-name" label={t('settings.general.name.label')}>
                      <Input
                        className={FIELD_INPUT}
                        dir={dirOf(selectedLanguage)}
                        id="set-lang-name"
                        lang={selectedLanguage.code}
                        onChange={(e) => setTranslation(selectedLanguage, { name: e.target.value })}
                        placeholder={field.state.value}
                        value={draft.name}
                      />
                    </Field>
                  </div>
                );
              }}
            </form.Field>

            <div className="border-border border-t">
              <form.Field name="description">
                {(field) => {
                  const draft = translations[selectedLanguage.id] ?? draftOf(selectedLanguage);
                  return (
                    <div className="grid grid-cols-1 gap-5 p-4 sm:grid-cols-2 sm:gap-6">
                      <Field
                        className="mb-0"
                        hint={t('settings.general.description.hint')}
                        htmlFor="set-desc"
                        label={t('settings.general.description.label')}
                      >
                        <Textarea
                          className={FIELD_TEXTAREA}
                          dir={dirOf(defaultLanguage)}
                          id="set-desc"
                          lang={defaultLanguage?.code}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          value={field.state.value}
                        />
                      </Field>
                      <Field className="mb-0" htmlFor="set-lang-desc" label={t('settings.general.description.label')}>
                        <Textarea
                          className={FIELD_TEXTAREA}
                          dir={dirOf(selectedLanguage)}
                          id="set-lang-desc"
                          lang={selectedLanguage.code}
                          onChange={(e) => setTranslation(selectedLanguage, { description: e.target.value })}
                          placeholder={field.state.value || undefined}
                          value={draft.description}
                        />
                      </Field>
                    </div>
                  );
                }}
              </form.Field>
            </div>
          </div>
        </div>
      ) : (
        <>
          <form.Field name="name" validators={{ onChange: ({ value }) => required(t('settings.general.name.label'), t)(value) }}>
            {(field) => (
              <Field hint={t('settings.general.name.hint')} htmlFor="set-name" label={t('settings.general.name.label')}>
                <Input
                  className={FIELD_INPUT}
                  dir={dirOf(defaultLanguage)}
                  id="set-name"
                  lang={defaultLanguage?.code}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  value={field.state.value}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
          <form.Field name="description">
            {(field) => (
              <Field hint={t('settings.general.description.hint')} htmlFor="set-desc" label={t('settings.general.description.label')}>
                <Textarea
                  className={FIELD_TEXTAREA}
                  dir={dirOf(defaultLanguage)}
                  id="set-desc"
                  lang={defaultLanguage?.code}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  value={field.state.value}
                />
              </Field>
            )}
          </form.Field>
        </>
      )}

      <form.Field name="slug" validators={{ onChange: ({ value }) => deploymentNameError(value, t('settings.general.url.error')) }}>
        {(field) => (
          <Field hint={t('settings.general.url.hint')} htmlFor="set-slug" label={t('settings.general.url.label')}>
            {/* Hostnames are always LTR: pin the group so the ".<base>" suffix
                trails the name in an RTL dashboard too (the logical border-s
                then resolves against the group's own direction). */}
            <div
              className="flex h-9 overflow-hidden rounded-md border border-input bg-transparent shadow-xs dark:bg-input/30 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"
              dir="ltr"
            >
              <Input
                className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-2.5 font-mono text-[13px] focus-visible:ring-0"
                id="set-slug"
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(slugify(e.target.value))}
                value={field.state.value}
              />
              {siteBaseDomain ? (
                <span className="flex shrink-0 items-center border-border border-s bg-muted/40 px-3 font-mono text-[13px] text-muted-foreground">
                  .{siteBaseDomain}
                </span>
              ) : null}
            </div>
            <FieldError errors={field.state.meta.errors} />
            <div className="mt-1.5 font-mono text-[12px] text-muted-foreground rtl:text-end" dir="ltr">
              {siteBaseDomain ? (field.state.value ? `${field.state.value}.${siteBaseDomain}` : `.${siteBaseDomain}`) : `/sites/${project.id}`}
            </div>
          </Field>
        )}
      </form.Field>

      <form.Subscribe selector={(state) => [state.isSubmitting, state.isDirty] as const}>
        {([isSubmitting, isDirty]) => (
          <SaveBar disabled={!isDirty && icon === (project.icon ?? '📘') && !translationsDirty} isSubmitting={isSubmitting} />
        )}
      </form.Subscribe>
    </form>
  );
}
