import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { FIELD_INPUT, Field, SaveBar, SectionHeader, Segmented, saveConfigSection } from './shared';

type Provider = 'builtin' | 'algolia' | 'typesense';
type Hotkey = 'cmdk' | 'slash';

const PROVIDER_LABEL_KEYS: Record<Provider, MessageKey> = {
  builtin: 'settings.search.provider.builtin',
  algolia: 'settings.search.provider.algolia',
  typesense: 'settings.search.provider.typesense',
};

export function SearchSection({ project }: { project: Project }) {
  const t = useT();
  const update = useUpdateProjectConfig(project.id);
  const search = project.config?.search ?? {};
  const [provider, setProvider] = useState<Provider>((search.provider as Provider) ?? 'builtin');
  const [hotkey, setHotkey] = useState<Hotkey>((search.hotkey as Hotkey) ?? 'cmdk');

  const form = useForm({
    defaultValues: { placeholder: search.placeholder ?? '' },
    onSubmit: async ({ value }) => {
      await saveConfigSection(update, {
        search: { provider, hotkey, placeholder: value.placeholder.trim() || undefined },
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

      <Field hint={t('settings.search.provider.hint')} label={t('settings.search.provider.label')}>
        <Select onValueChange={(v) => setProvider((v ?? 'builtin') as Provider)} value={provider}>
          <SelectTrigger className="h-[42px] w-full rounded-[10px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PROVIDER_LABEL_KEYS) as Provider[]).map((key) => (
              <SelectItem key={key} value={key}>
                {t(PROVIDER_LABEL_KEYS[key])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

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
