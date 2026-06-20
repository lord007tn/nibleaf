import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
import { FIELD_MONO, Field, SaveBar, SectionHeader, saveConfigSection, ToggleRow } from './shared';

export function AnalyticsSection({ project }: { project: Project }) {
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
      <SectionHeader icon="◴" title="Analytics" />

      <form.Field name="ga4">
        {(field) => (
          <Field hint="Send reader pageviews to a GA4 measurement ID." label="Google Analytics 4">
            <Input className={FIELD_MONO} onChange={(e) => field.handleChange(e.target.value)} placeholder="G-XXXXXXXXXX" value={field.state.value} />
          </Field>
        )}
      </form.Field>

      <form.Field name="plausible">
        {(field) => (
          <Field hint="Privacy-friendly analytics. Leave blank to disable." label="Plausible domain">
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
        hint="Ask EU visitors for consent before loading analytics."
        onCheckedChange={setCookieConsent}
        title="Cookie consent banner"
      />

      <div className="mt-4">
        <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
      </div>
    </form>
  );
}
