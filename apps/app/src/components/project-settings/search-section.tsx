import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
import { FIELD_INPUT, Field, SaveBar, SectionHeader, Segmented, saveConfigSection } from './shared';

type Provider = 'builtin' | 'algolia' | 'typesense';
type Hotkey = 'cmdk' | 'slash';

const PROVIDER_LABELS: Record<Provider, string> = {
  builtin: 'Built-in (Plume)',
  algolia: 'Algolia DocSearch',
  typesense: 'Typesense',
};

export function SearchSection({ project }: { project: Project }) {
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
      <SectionHeader icon="⌕" title="Search" />

      <Field hint="How site search is powered. Built-in needs no setup." label="Provider">
        <Select onValueChange={(v) => setProvider((v ?? 'builtin') as Provider)} value={provider}>
          <SelectTrigger className="h-[42px] w-full rounded-[10px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PROVIDER_LABELS) as Provider[]).map((key) => (
              <SelectItem key={key} value={key}>
                {PROVIDER_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <form.Field name="placeholder">
        {(field) => (
          <Field hint="Hint text shown inside the search field." label="Placeholder">
            <Input
              className={FIELD_INPUT}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="Search the docs…"
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <Field hint="Keyboard shortcut that opens search." label="Hotkey">
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
