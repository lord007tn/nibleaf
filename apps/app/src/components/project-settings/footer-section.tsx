import { Input } from '@nibleaf/design-system/components/ui/input';
import type { ProjectConfig } from '@nibleaf/validators';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Language, Project } from '@/hooks/api';
import { useLanguages, useUpdateLanguage, useUpdateProjectConfig } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import {
  DirtyStateReporter,
  FIELD_INPUT,
  FIELD_MONO,
  Field,
  LanguageScopePicker,
  SaveBar,
  SectionHeader,
  saveConfigSection,
  ToggleRow,
  useScopeDirtyGuard,
} from './shared';

type FooterConfig = NonNullable<ProjectConfig['footer']>;

/** Footer with a per-language scope: "Default" edits `project.config.footer`
 *  exactly as before; a language scope localizes the copyright line only —
 *  social URLs and the badge stay global. */
export function FooterSection({ project }: { project: Project }) {
  const t = useT();
  const { data: languages } = useLanguages(project.id);
  const extraLanguages = (languages ?? []).filter((language) => !language.isDefault);
  const [scope, setScope] = useState<string>('default');
  const activeLanguage = extraLanguages.find((language) => language.id === scope);
  const { guard, setDirty } = useScopeDirtyGuard();

  return (
    <div>
      <SectionHeader icon="▭" title={t('settings.footer.title')} />
      <LanguageScopePicker guard={guard} hint={t('settings.footer.scope.hint')} languages={extraLanguages} onChange={setScope} value={scope} />
      {/* Keyed per scope so switching re-seeds the form from that scope's config. */}
      {activeLanguage ? (
        <LanguageFooterForm key={activeLanguage.id} language={activeLanguage} onDirtyChange={setDirty} project={project} />
      ) : (
        <ProjectFooterForm key="default" onDirtyChange={setDirty} project={project} />
      )}
    </div>
  );
}

/** Default scope: the project-level footer in `project.config.footer` (unchanged). */
function ProjectFooterForm({ project, onDirtyChange }: { project: Project; onDirtyChange?: (dirty: boolean) => void }) {
  const t = useT();
  const update = useUpdateProjectConfig(project.id);
  const footer = project.config?.footer ?? {};

  const form = useForm({
    defaultValues: {
      copyright: footer.copyright ?? '',
      github: footer.github ?? '',
      x: footer.x ?? '',
      linkedin: footer.linkedin ?? '',
      madeWithBadge: footer.madeWithBadge !== false,
    },
    onSubmit: async ({ value }) => {
      const payload: FooterConfig = {
        copyright: value.copyright.trim() || undefined,
        github: value.github.trim() || undefined,
        x: value.x.trim() || undefined,
        linkedin: value.linkedin.trim() || undefined,
        madeWithBadge: value.madeWithBadge,
      };
      await saveConfigSection(update, { footer: payload });
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <form.Field name="copyright">
        {(field) => (
          <Field hint={t('settings.footer.copyright.hint')} label={t('settings.footer.copyright.label')}>
            <Input
              className={FIELD_INPUT}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder={t('settings.footer.copyright.placeholder')}
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="github">
        {(field) => (
          <Field hint={t('settings.footer.github.hint')} label={t('settings.footer.github.label')}>
            <Input
              className={FIELD_MONO}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="https://github.com/acme"
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="x">
        {(field) => (
          <Field hint={t('settings.footer.x.hint')} label={t('settings.footer.x.label')}>
            <Input
              className={FIELD_MONO}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="https://x.com/acme"
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="linkedin">
        {(field) => (
          <Field hint={t('settings.footer.linkedin.hint')} label={t('settings.footer.linkedin.label')}>
            <Input
              className={FIELD_MONO}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="https://linkedin.com/company/acme"
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="madeWithBadge">
        {(field) => (
          <ToggleRow
            title={t('settings.footer.badge.title')}
            hint={t('settings.footer.badge.hint')}
            checked={field.state.value}
            onCheckedChange={(checked) => field.handleChange(checked)}
          />
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.isDirty}>
        {(isDirty) => <DirtyStateReporter dirty={isDirty} onDirtyChange={onDirtyChange} />}
      </form.Subscribe>

      <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
    </form>
  );
}

/** A language scope: that language's `config.footer` override (copyright only),
 *  saved via updateLanguage. An empty field clears the override (`null`) so the
 *  language falls back to the project footer; name/description/seo and the
 *  other chrome overrides are preserved by the server merge. */
function LanguageFooterForm({
  project,
  language,
  onDirtyChange,
}: {
  project: Project;
  language: Language;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useT();
  const update = useUpdateLanguage(project.id);

  const form = useForm({
    defaultValues: { copyright: language.config?.footer?.copyright ?? '' },
    onSubmit: async ({ value }) => {
      const copyright = value.copyright.trim();
      try {
        await update.mutateAsync({ id: language.id, body: { config: { footer: copyright ? { copyright } : null } } });
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
      <form.Field name="copyright">
        {(field) => (
          <Field hint={t('settings.footer.copyright.hint')} label={t('settings.footer.copyright.label')}>
            <Input
              className={FIELD_INPUT}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder={project.config?.footer?.copyright || t('settings.footer.copyright.placeholder')}
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.isDirty}>
        {(isDirty) => <DirtyStateReporter dirty={isDirty} onDirtyChange={onDirtyChange} />}
      </form.Subscribe>

      <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
    </form>
  );
}
