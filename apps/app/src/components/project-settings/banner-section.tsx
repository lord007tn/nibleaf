import { Input } from '@midad/design-system/components/ui/input';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import { FIELD_INPUT, Field, SaveBar, SectionHeader, saveConfigSection, ToggleRow } from './shared';

export function BannerSection({ project }: { project: Project }) {
  const t = useT();
  const update = useUpdateProjectConfig(project.id);
  const banner = project.config?.banner ?? {};
  const [enabled, setEnabled] = useState<boolean>(banner.enabled ?? false);
  const [dismissible, setDismissible] = useState<boolean>(banner.dismissible ?? true);

  const form = useForm({
    defaultValues: {
      message: banner.message ?? '',
      linkLabel: banner.linkLabel ?? '',
      linkUrl: banner.linkUrl ?? '',
    },
    onSubmit: async ({ value }) => {
      await saveConfigSection(update, {
        banner: {
          enabled,
          dismissible,
          message: value.message.trim() || undefined,
          linkLabel: value.linkLabel.trim() || undefined,
          linkUrl: value.linkUrl.trim() || undefined,
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
      <SectionHeader icon="⚑" title={t('settings.banner.title')} />
      <p className="mb-1 text-[13.5px] text-muted-foreground leading-relaxed">{t('settings.banner.description')}</p>

      <ToggleRow checked={enabled} hint={t('settings.banner.enable.hint')} onCheckedChange={setEnabled} title={t('settings.banner.enable.title')} />

      <div className="mt-5">
        <form.Field name="message">
          {(field) => (
            <Field hint={t('settings.banner.message.hint')} label={t('settings.banner.message.label')}>
              <Input
                className={FIELD_INPUT}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder={t('settings.banner.message.placeholder')}
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
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder={t('settings.banner.linkLabel.placeholder')}
                value={field.state.value}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="linkUrl">
          {(field) => (
            <Field hint={t('settings.banner.linkUrl.hint')} label={t('settings.banner.linkUrl.label')}>
              <Input
                className={FIELD_INPUT}
                type="url"
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder={t('settings.banner.linkUrl.placeholder')}
                value={field.state.value}
              />
            </Field>
          )}
        </form.Field>
      </div>

      <ToggleRow
        checked={dismissible}
        hint={t('settings.banner.dismissible.hint')}
        onCheckedChange={setDismissible}
        title={t('settings.banner.dismissible.title')}
      />

      <div className="mt-4">
        <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
      </div>
    </form>
  );
}
