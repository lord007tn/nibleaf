import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@midad/design-system/components/ui/select';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import { Field, SaveBar, SectionHeader, Segmented, saveConfigSection } from './shared';

const HEADING_FONTS: [string, ...string[]] = ['Geist', 'Inter', 'Söhne', 'IBM Plex Sans', 'System UI'];
const BODY_FONTS: [string, ...string[]] = ['Geist', 'Inter', 'Source Sans 3', 'System UI'];
const CODE_FONTS: [string, ...string[]] = ['Geist Mono', 'JetBrains Mono', 'IBM Plex Mono', 'Fira Code'];

type BaseSize = '14' | '15' | '16' | '17' | '18';

function FontSelect({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: [string, ...string[]] }) {
  return (
    <Select onValueChange={(v) => onChange(v ?? options[0])} value={value}>
      <SelectTrigger className="h-[42px] w-full rounded-[10px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function TypographySection({ project }: { project: Project }) {
  const t = useT();
  const update = useUpdateProjectConfig(project.id);
  const typography = project.config?.typography ?? {};
  const [baseSize, setBaseSize] = useState<BaseSize>((typography.baseSize as BaseSize) ?? '16');

  const form = useForm({
    defaultValues: {
      headingFont: typography.headingFont ?? 'Geist',
      bodyFont: typography.bodyFont ?? 'Geist',
      codeFont: typography.codeFont ?? 'Geist Mono',
    },
    onSubmit: async ({ value }) => {
      await saveConfigSection(update, {
        typography: { headingFont: value.headingFont, bodyFont: value.bodyFont, codeFont: value.codeFont, baseSize },
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
      <SectionHeader icon="T" title={t('settings.typography.title')} />

      <form.Field name="headingFont">
        {(field) => (
          <Field hint={t('settings.typography.headingFont.hint')} label={t('settings.typography.headingFont.label')}>
            <FontSelect onChange={field.handleChange} options={HEADING_FONTS} value={field.state.value} />
          </Field>
        )}
      </form.Field>

      <form.Field name="bodyFont">
        {(field) => (
          <Field hint={t('settings.typography.bodyFont.hint')} label={t('settings.typography.bodyFont.label')}>
            <FontSelect onChange={field.handleChange} options={BODY_FONTS} value={field.state.value} />
          </Field>
        )}
      </form.Field>

      <form.Field name="codeFont">
        {(field) => (
          <Field hint={t('settings.typography.codeFont.hint')} label={t('settings.typography.codeFont.label')}>
            <FontSelect onChange={field.handleChange} options={CODE_FONTS} value={field.state.value} />
          </Field>
        )}
      </form.Field>

      <Field hint={t('settings.typography.baseSize.hint')} label={t('settings.typography.baseSize.label')}>
        <Segmented
          className="max-w-[240px]"
          onChange={setBaseSize}
          options={[
            { value: '14', label: '14' },
            { value: '15', label: '15' },
            { value: '16', label: '16' },
            { value: '17', label: '17' },
            { value: '18', label: '18' },
          ]}
          value={baseSize}
        />
      </Field>

      <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
    </form>
  );
}
