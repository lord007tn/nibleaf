import { Input } from '@nibleaf/design-system/components/ui/input';
import type { ProjectConfig } from '@nibleaf/validators';
import { useForm } from '@tanstack/react-form';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import { FIELD_INPUT, FIELD_MONO, Field, SaveBar, SectionHeader, saveConfigSection, ToggleRow } from './shared';

/** Footer config incl. the "Made with Nibleaf" toggle — the key ships ahead of
 *  the validator (projectConfigSchema.footer gains `madeWithBadge` separately),
 *  so it is layered on here instead of coming from @nibleaf/validators. */
type FooterConfig = NonNullable<ProjectConfig['footer']> & { madeWithBadge?: boolean };

export function FooterSection({ project }: { project: Project }) {
  const t = useT();
  const update = useUpdateProjectConfig(project.id);
  const footer = (project.config?.footer ?? {}) as FooterConfig;

  const form = useForm({
    defaultValues: {
      copyright: footer.copyright ?? '',
      github: footer.github ?? '',
      x: footer.x ?? '',
      linkedin: footer.linkedin ?? '',
      // Badge default ON — only an explicit `false` hides it on the live site.
      madeWithBadge: footer.madeWithBadge !== false,
    },
    onSubmit: async ({ value }) => {
      const payload: FooterConfig = {
        copyright: value.copyright.trim() || undefined,
        github: value.github.trim() || undefined,
        x: value.x.trim() || undefined,
        linkedin: value.linkedin.trim() || undefined,
      };
      // Only send the badge key when it deviates from (or reverts to) the
      // default, so untouched footer saves stay valid on servers whose
      // validator doesn't know the key yet.
      if (!value.madeWithBadge || footer.madeWithBadge === false) {
        payload.madeWithBadge = value.madeWithBadge;
      }
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

      <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
    </form>
  );
}
