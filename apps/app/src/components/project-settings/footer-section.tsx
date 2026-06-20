import { useForm } from '@tanstack/react-form';
import { Input } from '@/components/ui/input';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
import { FIELD_INPUT, FIELD_MONO, Field, SaveBar, SectionHeader, saveConfigSection } from './shared';

export function FooterSection({ project }: { project: Project }) {
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
      <SectionHeader icon="▭" title="Footer" />

      <form.Field name="copyright">
        {(field) => (
          <Field hint="Shown at the bottom of every page." label="Copyright">
            <Input
              className={FIELD_INPUT}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="© 2026 Acme. All rights reserved."
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="github">
        {(field) => (
          <Field hint="Link to your organisation or repository." label="GitHub">
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
          <Field hint="Link to your profile." label="X (Twitter)">
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
          <Field hint="Link to your company page." label="LinkedIn">
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
