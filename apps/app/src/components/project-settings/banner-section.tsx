import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
import { FIELD_INPUT, Field, SaveBar, SectionHeader, saveConfigSection, ToggleRow } from './shared';

export function BannerSection({ project }: { project: Project }) {
  const update = useUpdateProjectConfig(project.id);
  const banner = project.config?.banner ?? {};
  const [enabled, setEnabled] = useState<boolean>(banner.enabled ?? false);
  const [dismissible, setDismissible] = useState<boolean>(banner.dismissible ?? true);

  const form = useForm({
    defaultValues: {
      message: banner.message ?? '',
      linkLabel: banner.linkLabel ?? '',
    },
    onSubmit: async ({ value }) => {
      await saveConfigSection(update, {
        banner: {
          enabled,
          dismissible,
          message: value.message.trim() || undefined,
          linkLabel: value.linkLabel.trim() || undefined,
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
      <SectionHeader icon="⚑" title="Banner" />
      <p className="mb-1 text-[13.5px] text-muted-foreground leading-relaxed">
        A dismissible strip shown above the navbar — great for announcements.
      </p>

      <ToggleRow checked={enabled} hint="Show the announcement banner on every page." onCheckedChange={setEnabled} title="Enable banner" />

      <div className="mt-5">
        <form.Field name="message">
          {(field) => (
            <Field hint="Supports a single line of text and one inline link." label="Message">
              <Input
                className={FIELD_INPUT}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="🎉 v3 is here — faster and better."
                value={field.state.value}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="linkLabel">
          {(field) => (
            <Field hint="Optional call-to-action shown at the end of the banner." label="Link label">
              <Input
                className={FIELD_INPUT}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="Read the changelog →"
                value={field.state.value}
              />
            </Field>
          )}
        </form.Field>
      </div>

      <ToggleRow
        checked={dismissible}
        hint="Let readers close the banner and remember their choice."
        onCheckedChange={setDismissible}
        title="Dismissible"
      />

      <div className="mt-4">
        <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
      </div>
    </form>
  );
}
