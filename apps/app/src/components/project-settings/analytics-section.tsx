import { Input } from '@midad/design-system/components/ui/input';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import { FIELD_MONO, Field, SaveBar, SectionHeader, saveConfigSection, ToggleRow } from './shared';

export function AnalyticsSection({ project }: { project: Project }) {
  const t = useT();
  const update = useUpdateProjectConfig(project.id);
  const analytics = project.config?.analytics ?? {};
  const [cookieConsent, setCookieConsent] = useState<boolean>(analytics.cookieConsent ?? false);

  const form = useForm({
    defaultValues: {
      ga4: analytics.ga4 ?? '',
      plausible: analytics.plausible ?? '',
    },
    onSubmit: async ({ value }) => {
      await saveConfigSection(update, {
        analytics: {
          ga4: value.ga4.trim() || undefined,
          plausible: value.plausible.trim() || undefined,
          cookieConsent,
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
      <SectionHeader icon="◴" title={t('settings.analytics.title')} />

      <form.Field name="ga4">
        {(field) => (
          <Field hint={t('settings.analytics.ga4.hint')} label={t('settings.analytics.ga4.label')}>
            <Input className={FIELD_MONO} onChange={(e) => field.handleChange(e.target.value)} placeholder="G-XXXXXXXXXX" value={field.state.value} />
          </Field>
        )}
      </form.Field>

      <form.Field name="plausible">
        {(field) => (
          <Field hint={t('settings.analytics.plausible.hint')} label={t('settings.analytics.plausible.label')}>
            <Input
              className={FIELD_MONO}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="docs.yoursite.com"
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <ToggleRow
        checked={cookieConsent}
        hint={t('settings.analytics.cookieConsent.hint')}
        onCheckedChange={setCookieConsent}
        title={t('settings.analytics.cookieConsent.title')}
      />

      <div className="mt-4">
        <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
      </div>
    </form>
  );
}
