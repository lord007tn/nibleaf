import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
import { Field, SaveBar, SectionHeader, Segmented, saveConfigSection } from './shared';

const HEADING_FONTS: [string, ...string[]] = ['Geist', 'Inter', 'Söhne', 'IBM Plex Sans', 'System UI'];
const BODY_FONTS: [string, ...string[]] = ['Geist', 'Inter', 'Source Sans 3', 'System UI'];
const CODE_FONTS: [string, ...string[]] = ['Geist Mono', 'JetBrains Mono', 'IBM Plex Mono', 'Fira Code'];

type BaseSize = '14' | '16' | '18';

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
      <SectionHeader icon="T" title="Typography" />

      <form.Field name="headingFont">
        {(field) => (
          <Field hint="Used for page titles and section headings." label="Heading font">
            <FontSelect onChange={field.handleChange} options={HEADING_FONTS} value={field.state.value} />
          </Field>
        )}
      </form.Field>

      <form.Field name="bodyFont">
        {(field) => (
          <Field hint="Used for paragraphs, lists, and most reading text." label="Body font">
            <FontSelect onChange={field.handleChange} options={BODY_FONTS} value={field.state.value} />
          </Field>
        )}
      </form.Field>

      <form.Field name="codeFont">
        {(field) => (
          <Field hint="Used in code blocks and inline code." label="Code font">
            <FontSelect onChange={field.handleChange} options={CODE_FONTS} value={field.state.value} />
          </Field>
        )}
      </form.Field>

      <Field hint="Reading size for body text on your published site." label="Base size">
        <Segmented
          className="max-w-[240px]"
          onChange={setBaseSize}
          options={[
            { value: '14', label: '14px' },
            { value: '16', label: '16px' },
            { value: '18', label: '18px' },
          ]}
          value={baseSize}
        />
      </Field>

      <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
    </form>
  );
}
