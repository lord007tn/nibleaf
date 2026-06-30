import { Input } from '@midad/design-system/components/ui/input';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import { FIELD_INPUT, Field, SaveBar, SectionHeader, Segmented, saveConfigSection } from './shared';

type Hotkey = 'cmdk' | 'slash';

export function SearchSection({ project }: { project: Project }) {
  const t = useT();
  const update = useUpdateProjectConfig(project.id);
  const search = project.config?.search ?? {};
  const [hotkey, setHotkey] = useState<Hotkey>((search.hotkey as Hotkey) ?? 'cmdk');

  const form = useForm({
    defaultValues: { placeholder: search.placeholder ?? '', maxResults: String(search.maxResults ?? 6) },
    onSubmit: async ({ value }) => {
      const parsedMaxResults = Number.parseInt(value.maxResults, 10);
      await saveConfigSection(update, {
        search: {
          hotkey,
          placeholder: value.placeholder.trim() || undefined,
          maxResults: Number.isFinite(parsedMaxResults) ? Math.min(100, Math.max(1, parsedMaxResults)) : 6,
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
      <SectionHeader icon="⌕" title={t('settings.search.title')} />

      <form.Field name="placeholder">
        {(field) => (
          <Field hint={t('settings.search.placeholder.hint')} label={t('settings.search.placeholder.label')}>
            <Input
              className={FIELD_INPUT}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder={t('settings.search.placeholder.input')}
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="maxResults">
        {(field) => (
          <Field hint={t('settings.search.maxResults.hint')} label={t('settings.search.maxResults.label')}>
            <Input
              className={FIELD_INPUT}
              max={100}
              min={1}
              onChange={(e) => field.handleChange(e.target.value)}
              type="number"
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <Field hint={t('settings.search.hotkey.hint')} label={t('settings.search.hotkey.label')}>
        <Segmented
          className="max-w-[200px] font-mono"
          onChange={setHotkey}
          options={[
            { value: 'cmdk', label: '⌘K' },
            { value: 'slash', label: '/' },
          ]}
          value={hotkey}
        />
      </Field>

      <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
    </form>
  );
}
