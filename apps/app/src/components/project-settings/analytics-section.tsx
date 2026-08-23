import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { useT } from '@nibleaf/i18n/react';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
import { FIELD_MONO, Field, SaveBar, SectionHeader, saveConfigSection, ToggleRow } from './shared';

// Match the shapes the live-site injector accepts, so an invalid id is caught in
// the form instead of being silently dropped (and never emitting analytics).
const GA4_RE = /^G-[A-Z0-9]+$/i;
const PLAUSIBLE_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

export function AnalyticsSection({ project }: { project: Project }) {
  const t = useT();
  const update = useUpdateProjectConfig(project.id);
  const analytics = project.config?.analytics ?? {};
  const [cookieConsent, setCookieConsent] = useState<boolean>(analytics.cookieConsent ?? false);
  const [campaignDimensions, setCampaignDimensions] = useState<boolean>(analytics.campaignDimensions ?? false);
  const [storePublicSearchTerms, setStorePublicSearchTerms] = useState<boolean>(analytics.storePublicSearchTerms ?? false);

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
          campaignDimensions,
          storePublicSearchTerms,
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

      <form.Field
        name="ga4"
        validators={{ onChange: ({ value }) => (value.trim() && !GA4_RE.test(value.trim()) ? t('settings.analytics.ga4.error') : undefined) }}
      >
        {(field) => (
          <Field hint={t('settings.analytics.ga4.hint')} label={t('settings.analytics.ga4.label')}>
            <Input className={FIELD_MONO} onChange={(e) => field.handleChange(e.target.value)} placeholder="G-XXXXXXXXXX" value={field.state.value} />
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>

      <form.Field
        name="plausible"
        validators={{
          onChange: ({ value }) => (value.trim() && !PLAUSIBLE_RE.test(value.trim()) ? t('settings.analytics.plausible.error') : undefined),
        }}
      >
        {(field) => (
          <Field hint={t('settings.analytics.plausible.hint')} label={t('settings.analytics.plausible.label')}>
            <Input
              className={FIELD_MONO}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="docs.yoursite.com"
              value={field.state.value}
            />
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>

      <ToggleRow
        checked={cookieConsent}
        hint={t('settings.analytics.cookieConsent.hint')}
        onCheckedChange={setCookieConsent}
        title={t('settings.analytics.cookieConsent.title')}
      />

      <ToggleRow
        checked={campaignDimensions}
        hint={t('settings.analytics.campaignDimensions.hint')}
        onCheckedChange={setCampaignDimensions}
        title={t('settings.analytics.campaignDimensions.title')}
      />

      <ToggleRow
        checked={storePublicSearchTerms}
        hint={t('settings.analytics.searchTerms.hint')}
        onCheckedChange={setStorePublicSearchTerms}
        title={t('settings.analytics.searchTerms.title')}
      />

      <div className="mt-4">
        <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
      </div>
    </form>
  );
}
