import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import { Field, SaveBar, SectionHeader, Segmented, saveConfigSection } from './shared';

type Visibility = 'public' | 'private';

export function AuthenticationSection({ project }: { project: Project }) {
  const t = useT();
  const update = useUpdateProjectConfig(project.id);
  const [visibility, setVisibility] = useState<Visibility>(project.config?.visibility ?? 'public');

  const form = useForm({
    defaultValues: {},
    onSubmit: async () => {
      await saveConfigSection(update, { visibility });
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <SectionHeader description={t('settings.authentication.description')} icon="◉" title={t('settings.authentication.title')} />

      <Field hint={t('settings.authentication.mode.hint')} label={t('settings.authentication.mode.label')}>
        <Segmented
          className="max-w-[320px]"
          onChange={setVisibility}
          options={[
            { value: 'public', label: t('settings.authentication.mode.public') },
            { value: 'private', label: t('settings.authentication.mode.private') },
          ]}
          value={visibility}
        />
      </Field>

      <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
    </form>
  );
}
