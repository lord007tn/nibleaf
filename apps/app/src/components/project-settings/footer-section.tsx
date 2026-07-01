import { Input } from '@midad/design-system/components/ui/input';
import { useForm } from '@tanstack/react-form';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import { FIELD_INPUT, FIELD_MONO, Field, SaveBar, SectionHeader, saveConfigSection } from './shared';

export function FooterSection({ project }: { project: Project }) {
  const t = useT();
  const update = useUpdateProjectConfig(project.id);
  const footer = project.config?.footer ?? {};

  const form = useForm({
    defaultValues: {
      copyright: footer.copyright ?? '',
      github: footer.github ?? '',
      x: footer.x ?? '',
      linkedin: footer.linkedin ?? '',
    },
    onSubmit: async ({ value }) => {
      await saveConfigSection(update, {
        footer: {
          copyright: value.copyright.trim() || undefined,
          github: value.github.trim() || undefined,
          x: value.x.trim() || undefined,
          linkedin: value.linkedin.trim() || undefined,
        },
      });
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <SectionHeader icon="▭" title={t('settings.footer.title')} />

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

      <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
    </form>
  );
}
