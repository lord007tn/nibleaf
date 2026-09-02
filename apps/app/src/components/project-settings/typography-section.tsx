import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { useForm } from '@tanstack/react-form';
import { Type } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useState } from 'react';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
import { Field, SaveBar, SectionHeader, Segmented, saveConfigSection } from './shared';

const HEADING_FONTS: [string, ...string[]] = ['Geist', 'Inter', 'Söhne', 'IBM Plex Sans', 'System UI'];
const BODY_FONTS: [string, ...string[]] = ['Geist', 'Inter', 'Source Sans 3', 'System UI'];
const CODE_FONTS: [string, ...string[]] = ['Geist Mono', 'JetBrains Mono', 'IBM Plex Mono', 'Fira Code'];

type BaseSize = '14' | '15' | '16' | '17' | '18';
type Leading = '1.5' | '1.6' | '1.75' | '1.9' | '2';
type Flow = '0.75' | '1' | '1.25' | '1.5' | '2';

/** One-click reading styles: each preset is just a (size, leading, flow) triple —
 *  the stored config always holds the resolved values, never the preset name. */
const PRESETS = {
  default: { baseSize: '16', leading: '1.75', flow: '1.25' },
  compact: { baseSize: '15', leading: '1.6', flow: '1' },
  relaxed: { baseSize: '16', leading: '1.9', flow: '1.5' },
  article: { baseSize: '17', leading: '2', flow: '1.5' },
} as const satisfies Record<string, { baseSize: BaseSize; leading: Leading; flow: Flow }>;
type PresetName = keyof typeof PRESETS;

function FontSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: [string, ...string[]];
  label: string;
}) {
  // Font names are their own label; `items` lets the trigger show it instead of the raw value.
  const items = options.map((option) => ({ value: option, label: option }));
  return (
    <Select items={items} onValueChange={(v) => onChange(v ?? options[0])} value={value}>
      <SelectTrigger aria-label={label} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Live sample rendered with the exact typeset variables the published site will
 *  use — same class, same CSS file, updated as the controls change. */
function RhythmPreview({
  baseSize,
  leading,
  flow,
  bodyFont,
  headingFont,
  codeFont,
}: {
  baseSize: BaseSize;
  leading: Leading;
  flow: Flow;
  bodyFont: string;
  headingFont: string;
  codeFont: string;
}) {
  const t = useT();
  const style = {
    fontSize: `${baseSize}px`,
    '--typeset-leading': leading,
    '--typeset-flow': `${flow}em`,
    '--typeset-font-body': `'${bodyFont}', var(--font-sans, system-ui, sans-serif)`,
    '--typeset-font-heading': `'${headingFont}', var(--font-sans, sans-serif)`,
    '--typeset-font-mono': `'${codeFont}', var(--font-mono, monospace)`,
  } as CSSProperties;
  return (
    <div className="typeset max-h-72 overflow-y-auto rounded-xl border border-border bg-background p-5" style={style}>
      <h2>{t('settings.typography.preview.heading')}</h2>
      <p>{t('settings.typography.preview.body')}</p>
      <ul>
        <li>{t('settings.typography.preview.item1')}</li>
        <li>
          {t('settings.typography.preview.item2')
            .split('`')
            .map((part, i) => (i % 2 === 1 ? <code key={part}>{part}</code> : part))}
        </li>
      </ul>
    </div>
  );
}

export function TypographySection({ project }: { project: Project }) {
  const t = useT();
  const update = useUpdateProjectConfig(project.id);
  const typography = project.config?.typography ?? {};
  const [baseSize, setBaseSize] = useState<BaseSize>((typography.baseSize as BaseSize) ?? '16');
  const [leading, setLeading] = useState<Leading>((typography.leading as Leading) ?? '1.75');
  const [flow, setFlow] = useState<Flow>((typography.flow as Flow) ?? '1.25');
  const rhythmDirty =
    baseSize !== ((typography.baseSize as BaseSize) ?? '16') ||
    leading !== ((typography.leading as Leading) ?? '1.75') ||
    flow !== ((typography.flow as Flow) ?? '1.25');

  // The preset row highlights whichever preset the current triple matches (if any).
  const activePreset = (Object.keys(PRESETS) as PresetName[]).find(
    (name) => PRESETS[name].baseSize === baseSize && PRESETS[name].leading === leading && PRESETS[name].flow === flow,
  );
  const applyPreset = (name: PresetName) => {
    setBaseSize(PRESETS[name].baseSize);
    setLeading(PRESETS[name].leading);
    setFlow(PRESETS[name].flow);
  };

  const form = useForm({
    defaultValues: {
      headingFont: typography.headingFont ?? 'Geist',
      bodyFont: typography.bodyFont ?? 'Geist',
      codeFont: typography.codeFont ?? 'Geist Mono',
    },
    onSubmit: async ({ value }) => {
      await saveConfigSection(update, {
        typography: { headingFont: value.headingFont, bodyFont: value.bodyFont, codeFont: value.codeFont, baseSize, leading, flow },
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
      <SectionHeader icon={<Type className="size-4" />} title={t('settings.typography.title')} />

      <Field hint={t('settings.typography.preset.hint')} label={t('settings.typography.preset.label')}>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PRESETS) as PresetName[]).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => applyPreset(name)}
              className={cn(
                'h-8 cursor-pointer rounded-full border px-3.5 font-medium text-[13px] outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
                activePreset === name
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
              )}
            >
              {t(`settings.typography.preset.${name}`)}
            </button>
          ))}
        </div>
      </Field>

      <form.Field name="headingFont">
        {(field) => (
          <Field hint={t('settings.typography.headingFont.hint')} label={t('settings.typography.headingFont.label')}>
            <FontSelect
              label={t('settings.typography.headingFont.label')}
              onChange={field.handleChange}
              options={HEADING_FONTS}
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="bodyFont">
        {(field) => (
          <Field hint={t('settings.typography.bodyFont.hint')} label={t('settings.typography.bodyFont.label')}>
            <FontSelect
              label={t('settings.typography.bodyFont.label')}
              onChange={field.handleChange}
              options={BODY_FONTS}
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="codeFont">
        {(field) => (
          <Field hint={t('settings.typography.codeFont.hint')} label={t('settings.typography.codeFont.label')}>
            <FontSelect
              label={t('settings.typography.codeFont.label')}
              onChange={field.handleChange}
              options={CODE_FONTS}
              value={field.state.value}
            />
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

      <Field hint={t('settings.typography.leading.hint')} label={t('settings.typography.leading.label')}>
        <Segmented
          className="max-w-[300px]"
          onChange={setLeading}
          options={[
            { value: '1.5', label: '1.5' },
            { value: '1.6', label: '1.6' },
            { value: '1.75', label: '1.75' },
            { value: '1.9', label: '1.9' },
            { value: '2', label: '2.0' },
          ]}
          value={leading}
        />
      </Field>

      <Field hint={t('settings.typography.flow.hint')} label={t('settings.typography.flow.label')}>
        <Segmented
          className="max-w-[420px]"
          onChange={setFlow}
          options={[
            { value: '0.75', label: t('settings.typography.flow.tight') },
            { value: '1', label: t('settings.typography.flow.snug') },
            { value: '1.25', label: t('settings.typography.flow.normal') },
            { value: '1.5', label: t('settings.typography.flow.roomy') },
            { value: '2', label: t('settings.typography.flow.airy') },
          ]}
          value={flow}
        />
      </Field>

      <form.Subscribe selector={(state) => [state.values.headingFont, state.values.bodyFont, state.values.codeFont] as const}>
        {([headingFont, bodyFont, codeFont]) => (
          <Field hint={t('settings.typography.preview.hint')} label={t('settings.typography.preview.label')}>
            <RhythmPreview baseSize={baseSize} bodyFont={bodyFont} codeFont={codeFont} flow={flow} headingFont={headingFont} leading={leading} />
          </Field>
        )}
      </form.Subscribe>

      <form.Subscribe selector={(state) => [state.isSubmitting, state.isDirty] as const}>
        {([isSubmitting, isDirty]) => <SaveBar disabled={!isDirty && !rhythmDirty} isSubmitting={isSubmitting} />}
      </form.Subscribe>
    </form>
  );
}
