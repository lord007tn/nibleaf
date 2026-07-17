import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { cn } from '@nibleaf/design-system/lib/utils';
import { slugify } from '@nibleaf/shared/utils';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Language, LanguageConfig, Project } from '@/hooks/api';
import { useLanguages, useUpdateLanguage, useUpdateProject } from '@/hooks/api';
import { required } from '@/lib/form';
import { useT } from '@/lib/i18n';
import { FIELD_INPUT, FIELD_TEXTAREA, Field, GroupLabel, SaveBar, SectionHeader } from './shared';

/** A small curated set of emoji icons the project can use as its avatar glyph. */
const ICON_CHOICES = ['📘', '📕', '📗', '🚀', '⚡', '🛠️', '🧩', '🔌', '📦', '🌐', '🔭', '✨'];

// Only present a `slug.<base>` preview when a base domain is actually configured
// for this deployment; otherwise the free-subdomain host would 404, so fall back
// to the working /sites/:id path.
const siteBaseDomain = (import.meta.env.VITE_SITE_BASE_DOMAIN as string | undefined)?.replace(/^\*\./, '').replace(/\.$/, '') || undefined;
const deploymentNameError = (value: string, message: string) => {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)) {
    return message;
  }
  return undefined;
};

/** The localized site name/description draft for one extra language. */
type TranslationDraft = { name: string; description: string };

const draftOf = (language: Language): TranslationDraft => ({
  name: language.config?.name ?? '',
  description: language.config?.description ?? '',
});

/** True when the language's stored SEO carries an actual override (mirrors the
 *  language-settings dialog: empty strings and allowIndex:true are defaults). */
const hasSeoOverride = (config: LanguageConfig | null | undefined): boolean => {
  const seo = config?.seo;
  return Boolean(seo && ([seo.metaTitle, seo.metaDescription, seo.socialImage].some((v) => (v ?? '').trim() !== '') || seo.allowIndex === false));
};

export function GeneralSection({ project }: { project: Project }) {
  const t = useT();
  const update = useUpdateProject(project.id);
  const updateLanguage = useUpdateLanguage(project.id);
  const { data: languages } = useLanguages(project.id);
  const [icon, setIcon] = useState<string>(project.icon ?? '📘');
  const [iconOpen, setIconOpen] = useState(false);
  // Localized site name/description per NON-default language (Translations
  // group below). Drafts are keyed by language id; untouched languages read
  // straight from their stored config.
  const extraLanguages = (languages ?? []).filter((language) => !language.isDefault);
  const [translations, setTranslations] = useState<Record<string, TranslationDraft>>({});
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
      const config = !name && !description && !hasSeoOverride(language.config) ? null : { name, description };
      await updateLanguage.mutateAsync({ id: language.id, body: { config } });
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
      <SectionHeader icon="⊕" title={t('settings.general.title')} />

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
        <div className="mb-5 flex flex-wrap gap-2 rounded-xl border border-border bg-muted/40 p-3.5">
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

      <form.Field name="name" validators={{ onChange: ({ value }) => required(t('settings.general.name.label'))(value) }}>
        {(field) => (
          <Field hint={t('settings.general.name.hint')} htmlFor="set-name" label={t('settings.general.name.label')}>
            <Input
              className={FIELD_INPUT}
              id="set-name"
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              value={field.state.value}
            />
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>

      <form.Field name="slug" validators={{ onChange: ({ value }) => deploymentNameError(value, t('settings.general.url.error')) }}>
        {(field) => (
          <Field hint={t('settings.general.url.hint')} htmlFor="set-slug" label={t('settings.general.url.label')}>
            <div className="flex h-9 overflow-hidden rounded-md border border-input bg-transparent shadow-xs dark:bg-input/30 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
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
            <div className="mt-1.5 font-mono text-[12px] text-muted-foreground">
              {siteBaseDomain ? (field.state.value ? `${field.state.value}.${siteBaseDomain}` : `.${siteBaseDomain}`) : `/sites/${project.id}`}
            </div>
          </Field>
        )}
      </form.Field>

      <form.Field name="description">
        {(field) => (
          <Field hint={t('settings.general.description.hint')} htmlFor="set-desc" label={t('settings.general.description.label')}>
            <Textarea
              className={FIELD_TEXTAREA}
              id="set-desc"
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      {extraLanguages.length > 0 ? (
        <div className="mb-6 border-border border-t pt-5">
          <GroupLabel>{t('settings.general.translations.title')}</GroupLabel>
          <p className="mt-1 mb-4 text-[12.5px] text-muted-foreground leading-snug">{t('settings.general.translations.hint')}</p>
          <div className="flex flex-col gap-4">
            {extraLanguages.map((language) => {
              const draft = translations[language.id] ?? draftOf(language);
              return (
                <div className="rounded-xl border border-border bg-muted/20 p-4" key={language.id}>
                  <div className="mb-3 font-medium text-[13px]">{language.label}</div>
                  <Field className="mb-4" htmlFor={`set-lang-name-${language.id}`} label={t('settings.general.translations.name.label')}>
                    <Input
                      className={FIELD_INPUT}
                      id={`set-lang-name-${language.id}`}
                      onChange={(e) => setTranslation(language, { name: e.target.value })}
                      placeholder={project.name}
                      value={draft.name}
                    />
                  </Field>
                  <Field className="mb-0" htmlFor={`set-lang-desc-${language.id}`} label={t('settings.general.translations.description.label')}>
                    <Textarea
                      className={FIELD_TEXTAREA}
                      id={`set-lang-desc-${language.id}`}
                      onChange={(e) => setTranslation(language, { description: e.target.value })}
                      placeholder={project.description ?? undefined}
                      value={draft.description}
                    />
                  </Field>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
    </form>
  );
}
